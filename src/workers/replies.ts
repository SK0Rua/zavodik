/**
 * Stage 15 — reply detection over IMAP (SPEC §4, decision #1).
 *
 * Runs on a schedule (`poll-replies`, every 10 min). Fetches mail newer than a
 * persisted UID cursor, matches each message to a contacted business by
 * threading headers or sender address, then hands it to the shared inbound
 * classifier (reply / opt-out / bounce).
 *
 * Why a UID cursor instead of \Seen flags: Roman reads this mailbox in Gmail
 * too. The moment he opens a reply, a \Seen-based poller would skip it forever.
 * UIDVALIDITY + UID is the protocol's own durable pointer and is immune to that.
 *
 * WhatsApp replies do NOT come through here — WAHA pushes them to
 * `/webhooks/waha` (src/api/server.ts).
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { config } from '../config.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';
import { getImapCursor, setImapCursor } from '../outreach/settings.js';
import { resolveReply } from '../outreach/replyMatch.js';
import { processInbound, type InboundOutcome } from '../outreach/inbound.js';
import { bouncedRecipient, detectBounce } from '../outreach/optout.js';

// Re-exported for the phase-D callers (api/server.ts) that imported it from here.
export { recordReply } from '../outreach/inbound.js';

export interface PollSummary {
  fetched: number;
  matched: number;
  outcomes: Record<InboundOutcome, number>;
  lastUid: number | null;
  skipped?: string;
}

/**
 * Classify and route one already-parsed message.
 * Exported so tests can drive it with a fixture .eml without an IMAP server.
 */
export async function handleParsedMail(parsed: ParsedMail): Promise<InboundOutcome> {
  const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
  const text = parsed.text ?? '';
  const subject = parsed.subject ?? '';

  const bounceReason = detectBounce({
    from: fromAddr,
    subject,
    contentType: String(parsed.headers.get('content-type') ?? ''),
    text,
  });

  // A DSN's envelope sender is mailer-daemon, so matching must use the address
  // that actually failed, recovered from the DSN body.
  const failedRecipient = bounceReason ? bouncedRecipient(text) : null;
  const matchAddress = failedRecipient ?? fromAddr;
  if (!matchAddress) return 'ignored';

  const match = await resolveReply({
    channel: 'email',
    fromAddress: matchAddress,
    inReplyTo: parsed.inReplyTo ?? null,
    references: (parsed.references as string | string[] | undefined) ?? null,
  });
  if (!match) {
    log.info('inbound mail did not match any outreach', { from: matchAddress, subject: subject.slice(0, 120) });
    return 'ignored';
  }

  return processInbound(match, {
    channel: 'email',
    fromAddress: matchAddress,
    subject,
    text,
    providerMessageId: parsed.messageId ?? null,
    bounceReason: bounceReason ?? null,
  });
}

/**
 * Poll the mailbox once. Returns a summary rather than throwing on an empty
 * mailbox, so the scheduled job is quiet when there is nothing to do.
 */
export async function pollReplies(): Promise<PollSummary> {
  const empty: PollSummary = {
    fetched: 0, matched: 0, lastUid: null,
    outcomes: { replied: 0, opted_out: 0, bounced: 0, ignored: 0 },
  };
  if (!config.imap.host) {
    log.warn('IMAP not configured; reply polling skipped');
    return { ...empty, skipped: 'IMAP_HOST is empty' };
  }

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.pass },
    tls: { rejectUnauthorized: config.imap.rejectUnauthorized },
    logger: false,
  });

  const summary: PollSummary = { ...empty, outcomes: { ...empty.outcomes } };
  await client.connect();
  try {
    const box = await client.mailboxOpen(config.imap.mailbox);
    const uidValidity = String(box.uidValidity);
    const cursor = await getImapCursor();

    // A changed UIDVALIDITY means the server renumbered everything: old UIDs are
    // meaningless. Start from "now" rather than re-processing the whole mailbox.
    const sameEpoch = cursor?.uidValidity === uidValidity;
    const startUid = sameEpoch ? cursor!.lastUid + 1 : Number(box.uidNext ?? 1);
    if (!sameEpoch && cursor) {
      log.warn('IMAP UIDVALIDITY changed; cursor reset', {
        was: cursor.uidValidity, now: uidValidity, startUid,
      });
    }

    const range = `${startUid}:*`;
    let processed = 0;
    let maxUid = sameEpoch ? cursor!.lastUid : startUid - 1;

    for await (const msg of client.fetch({ uid: range }, { uid: true, source: true }, { uid: true })) {
      // `n:*` always returns at least one message even when none are newer.
      if (!msg.uid || msg.uid < startUid) continue;
      if (processed >= config.imap.maxPerPoll) {
        log.warn('IMAP poll hit maxPerPoll; remaining mail waits for the next run', {
          maxPerPoll: config.imap.maxPerPoll,
        });
        break;
      }
      processed++;
      summary.fetched++;
      maxUid = Math.max(maxUid, msg.uid);

      if (!msg.source) continue;
      try {
        const parsed = await simpleParser(msg.source);
        const outcome = await handleParsedMail(parsed);
        summary.outcomes[outcome]++;
        if (outcome !== 'ignored') summary.matched++;
      } catch (err) {
        // One malformed message must not stop the poll (SPEC: one failure never
        // stops the campaign). The cursor still advances past it.
        log.error('failed to process inbound mail', { uid: msg.uid, err: String(err) });
      }
    }

    if (maxUid > 0) {
      await setImapCursor({ uidValidity, lastUid: maxUid });
      summary.lastUid = maxUid;
    }
  } finally {
    await client.logout().catch(() => {});
  }

  if (summary.fetched) log.info('reply poll done', summary as unknown as Record<string, unknown>);
  return summary;
}

export async function pollRepliesHandler(_payload: JobPayload): Promise<void> {
  await pollReplies();
}
