/**
 * Email adapter — Roman's Gmail over an SMTP app password (decision #1).
 * Fallback channel only: live messengers come first (decision #8).
 *
 * Two things here exist purely so replies can be matched later (src/outreach/replyMatch.ts):
 *  - a Message-ID we generate ourselves from the idempotency key, so an
 *    In-Reply-To/References header on the answer points straight back at the
 *    exact outreach_messages row;
 *  - `X-Factory-Idempotency`, the same key echoed as a header, which survives
 *    some mailers that rewrite Message-ID.
 *
 * Sends are never auto-retried (SPEC §7): a throw here marks the message failed
 * and stops, it does not schedule another attempt.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { type ChannelAdapter, type OutreachDraft, type SendResult, NotConfiguredError } from './types.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { notifyTelegram } from '../telegram/notify.js';

/**
 * Our own Message-ID, derived from the send's idempotency key.
 *
 * The encoding MUST be reversible: reply matching recovers the key from an
 * In-Reply-To header and looks it up in outreach_messages. A lossy slug (e.g.
 * mapping every non-alphanumeric to `-`) silently degrades every reply to
 * weaker address-based matching, so the key is base64url-encoded instead —
 * `:` is not legal in a Message-ID's local part, and keys contain them.
 *
 * Format: `<factory.<base64url(key)>.<ts>@domain>`.
 */
export function buildMessageId(idempotencyKey: string, domain = config.smtp.messageIdDomain): string {
  const encoded = Buffer.from(idempotencyKey, 'utf8').toString('base64url');
  return `<factory.${encoded}.${Date.now()}@${domain}>`;
}

/**
 * Recover the idempotency key from one of our Message-IDs.
 * Returns null for anything we did not generate.
 */
export function parseMessageId(messageId: string): string | null {
  const m = String(messageId).trim().replace(/^<|>$/g, '')
    .match(/^factory\.([A-Za-z0-9_-]+)\.(\d+)@/);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], 'base64url').toString('utf8');
    // Reject anything that did not survive the round trip (a foreign id that
    // happens to look base64url-ish).
    return Buffer.from(decoded, 'utf8').toString('base64url') === m[1] ? decoded : null;
  } catch {
    return null;
  }
}

/** Minimal HTML twin of the plain text: paragraphs + autolinked URLs, nothing else. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = (s: string) => esc(s).replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}">${u}</a>`,
  );
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;">${linked(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.55;color:#1a1a1a;">\n${body}\n</div>`;
}

let transporter: Transporter | null = null;

/** Lazily built so an unconfigured SMTP never breaks process start-up. */
export function getTransport(): Transporter {
  if (transporter) return transporter;
  if (!config.smtp.host) throw new NotConfiguredError('email', 'SMTP_HOST is empty');
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure, // 465 implicit TLS; 587 STARTTLS
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
  });
  return transporter;
}

/** Test seam: drop the memoized transport when env changes mid-process. */
export function resetTransport(): void {
  transporter?.close?.();
  transporter = null;
}

export interface EmailSendExtras {
  /** Send idempotency key — becomes the Message-ID and X-Factory-Idempotency. */
  idempotencyKey?: string;
  /** Message-ID of the thread's first message, for follow-ups. */
  inReplyTo?: string;
}

export const emailAdapter: ChannelAdapter = {
  channel: 'email',

  async sendDryRun(draft: OutreachDraft): Promise<SendResult> {
    log.info('DRY RUN email send', { to: draft.toAddress, subject: draft.subject });
    return { state: 'simulated', providerMessageId: null, detail: { adapter: 'email', dryRun: true } };
  },

  async sendLive(draft: OutreachDraft, extras?: EmailSendExtras): Promise<SendResult> {
    if (!config.smtp.host) throw new NotConfiguredError('email', 'SMTP_HOST is empty');
    if (!config.smtp.from) throw new NotConfiguredError('email', 'SMTP_FROM is empty');

    const key = extras?.idempotencyKey ?? `adhoc-${Date.now()}`;
    const messageId = buildMessageId(key);
    // Recipients can always opt out without replying; the address is also what
    // the IMAP poller watches for opt-out mail.
    const unsubscribeTo = config.smtp.unsubscribeTo || config.smtp.user || config.smtp.from;

    try {
      const info = await getTransport().sendMail({
        from: config.smtp.from,
        to: draft.toAddress,
        subject: draft.subject ?? '',
        text: draft.body,
        html: textToHtml(draft.body),
        messageId,
        ...(extras?.inReplyTo
          ? { inReplyTo: extras.inReplyTo, references: [extras.inReplyTo] }
          : {}),
        headers: {
          'X-Factory-Idempotency': key,
          'List-Unsubscribe': `<mailto:${String(unsubscribeTo).replace(/^.*<|>.*$/g, '')}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      log.info('email sent', { to: draft.toAddress, messageId: info.messageId ?? messageId });
      return {
        state: 'sent',
        // Prefer OUR id: some servers echo it, some rewrite it, and reply
        // matching keys off what we generated.
        providerMessageId: messageId,
        detail: {
          adapter: 'smtp',
          smtpMessageId: info.messageId ?? null,
          accepted: info.accepted ?? [],
          rejected: info.rejected ?? [],
          response: info.response ?? null,
        },
      };
    } catch (err: any) {
      // SPEC §7: auth problems mean the channel is down for everyone -> alert.
      const code = String(err?.code ?? err?.responseCode ?? '');
      const isAuth = code === 'EAUTH' || err?.responseCode === 535 || err?.responseCode === 534;
      log.error('email send failed, NOT retrying (sends are one-shot)', {
        to: draft.toAddress, code, err: String(err?.message ?? err),
      });
      if (isAuth) {
        await notifyTelegram(
          `🔴 <b>SMTP: помилка авторизації</b>\n` +
          `Email-канал не працює. Перевір SMTP_USER / SMTP_PASS (Gmail app password).\n` +
          `Деталі: ${String(err?.message ?? err).slice(0, 300)}`,
        ).catch(() => {});
      }
      throw err;
    }
  },
};
