/**
 * Reply poller (email via IMAP). Matches inbound mail to contacted businesses,
 * records the reply, stops follow-ups, moves the deal to 'replied' and pings Roman.
 * WhatsApp replies arrive via webhook (see api/server.ts /webhooks/whatsapp).
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { config } from '../config.js';
import { transition } from '../orchestrator/statuses.js';
import { notifyTelegram } from '../telegram/notify.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

export async function recordReply(businessId: string, channel: string, detail: Record<string, unknown>): Promise<void> {
  await db.insert(schema.outreachEvents).values({ businessId, event: 'replied', detail });
  await db.update(schema.deals).set({ state: 'replied', updatedAt: new Date() })
    .where(eq(schema.deals.businessId, businessId));
  await transition(businessId, 'replied', 'replies-worker', `reply via ${channel}`);
  await notifyTelegram(`💬 <b>ВІДПОВІДЬ</b> від ${businessId} (${channel})\n${String(detail.preview ?? '').slice(0, 400)}`);
}

export async function pollRepliesHandler(_payload: JobPayload): Promise<void> {
  if (!config.imap.host) { log.warn('IMAP not configured; reply polling skipped'); return; }

  const client = new ImapFlow({
    host: config.imap.host, port: config.imap.port, secure: true,
    auth: { user: config.imap.user, pass: config.imap.pass },
    logger: false,
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const unseen = await client.search({ seen: false });
    if (!unseen || !unseen.length) return;

    for (const uid of unseen) {
      const msg = await client.fetchOne(String(uid), { source: true });
      if (!msg || !('source' in msg) || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase();
      if (!fromAddr) continue;

      // opt-out detection
      const bodyText = (parsed.text ?? '').toLowerCase();
      const optOut = /unsubscribe|не пишіть|не пишите|remove me|διαγραφή/.test(bodyText);

      const contacted = await db.select().from(schema.outreachMessages)
        .where(eq(schema.outreachMessages.channel, 'email'));
      const match = contacted.find((m) => m.toAddress.toLowerCase() === fromAddr);
      if (!match) continue;

      if (optOut) {
        await db.insert(schema.doNotContact).values({ matchType: 'email', value: fromAddr, reason: 'opt-out reply' }).onConflictDoNothing();
        await db.insert(schema.outreachEvents).values({ businessId: match.businessId, messageId: match.id, event: 'opted_out' });
        await transition(match.businessId, 'do_not_contact', 'replies-worker', 'opt-out');
      } else {
        await recordReply(match.businessId, 'email', { preview: (parsed.text ?? '').slice(0, 500), subject: parsed.subject });
      }
      await client.messageFlagsAdd(String(uid), ['\\Seen']);
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
