/**
 * WhatsApp adapter over WAHA (self-hosted WhatsApp HTTP API, decision #2) —
 * NOT the Meta Cloud API. Roman scans a QR once with the dedicated outreach
 * number; WAHA keeps the session and posts inbound messages to
 * `/webhooks/waha` for reply detection (see src/api/server.ts).
 *
 * Send semantics (SPEC §7): a send is NEVER auto-retried. Every failure here —
 * auth, rate limit, 5xx, unreachable WAHA — throws, the worker marks the
 * message `failed`, and the queue's retryLimit 0 for send-outreach guarantees
 * no second attempt. Auth failures additionally alert Roman, because they mean
 * the whole channel is down rather than this one business.
 */
import {
  type ChannelAdapter, type OutreachDraft, type SendResult, NotConfiguredError,
} from './types.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import {
  WahaError, checkNumberExists, sendText, sessionReady, toChatId,
} from './waha.js';
import { notifyTelegram } from '../telegram/notify.js';

/** Digits only — WAHA chat ids look like `30691234567@c.us`. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

/** Raised when the number simply is not on WhatsApp — a routing fact, not an outage. */
export class NotOnWhatsAppError extends Error {
  code = 'NOT_ON_WHATSAPP';
  constructor(phone: string) { super(`${phone} is not registered on WhatsApp`); }
}

/**
 * SPEC §7: credential/auth failures stop the channel and alert. Everything else
 * is this business's problem alone and must not stop the campaign.
 */
async function alertAuthFailure(err: WahaError, to: string): Promise<void> {
  log.error('WAHA auth failure — WhatsApp channel is down', { to, err: err.message });
  await notifyTelegram(
    `🔴 <b>WAHA: помилка авторизації</b>\n` +
    `WhatsApp-канал не працює — сендів не буде, поки не полагодиш.\n` +
    `Перевір WAHA_API_KEY і чи сесія <code>${config.waha.session}</code> у статусі WORKING.\n` +
    `Деталі: ${err.message.slice(0, 300)}`,
  ).catch(() => {});
}

export const whatsappAdapter: ChannelAdapter = {
  channel: 'whatsapp',

  async sendDryRun(draft: OutreachDraft): Promise<SendResult> {
    log.info('DRY RUN whatsapp send', { to: normalizePhone(draft.toAddress), chars: draft.body.length });
    return { state: 'simulated', providerMessageId: null, detail: { adapter: 'whatsapp', dryRun: true } };
  },

  /**
   * Live send through WAHA. Order matters:
   *  1. config present,
   *  2. session actually WORKING (SCAN_QR_CODE = Roman never paired the phone),
   *  3. the number is on WhatsApp at all (skippable via WAHA_CHECK_EXISTS=false),
   *  4. POST /api/sendText.
   */
  async sendLive(draft: OutreachDraft): Promise<SendResult> {
    if (!config.waha.url) throw new NotConfiguredError('whatsapp', 'WAHA_URL is empty');
    const phone = normalizePhone(draft.toAddress);
    if (!phone) throw new NotConfiguredError('whatsapp', `unusable phone "${draft.toAddress}"`);

    try {
      const session = await sessionReady();
      if (!session.ready) {
        throw new NotConfiguredError(
          'whatsapp',
          `WAHA session "${config.waha.session}" is ${session.status}, not WORKING — ` +
          `scan the QR (GET ${config.waha.url}/api/${config.waha.session}/auth/qr) before sending`,
        );
      }

      let chatId = toChatId(phone);
      if (config.waha.checkExists) {
        const exists = await checkNumberExists(phone);
        if (exists && exists.numberExists === false) throw new NotOnWhatsAppError(phone);
        // Newer WhatsApp may hand back a @lid id; prefer whatever WAHA resolved.
        if (exists?.chatId) chatId = exists.chatId;
      }

      const sent = await sendText({ chatId, text: draft.body });
      log.info('whatsapp sent via WAHA', { to: phone, chatId, providerMessageId: sent?.id });
      return {
        state: 'sent',
        providerMessageId: sent?.id ?? null,
        detail: { adapter: 'waha', chatId, session: config.waha.session, ack: sent?.ack ?? null },
      };
    } catch (err) {
      if (err instanceof WahaError && err.isAuth) await alertAuthFailure(err, phone);
      // Rate limits and 5xx do NOT become retries: sends are one-shot (SPEC §7).
      if (err instanceof WahaError && (err.kind === 'rate_limit' || err.kind === 'server')) {
        log.error('WAHA send failed, NOT retrying (sends are one-shot)', {
          to: phone, kind: err.kind, status: err.status, err: err.message,
        });
        await notifyTelegram(
          `⚠️ <b>WAHA: send не пройшов</b> (${err.kind}, HTTP ${err.status ?? '-'})\n` +
          `Кому: ${phone}\nПовтору НЕ буде — сенди не ретраяться. Перевір і відправ вручну за потреби.`,
        ).catch(() => {});
      }
      throw err;
    }
  },

  /** Fallback hand-off link if WAHA is down — Roman can still send by hand. */
  deepLink(draft: OutreachDraft): string {
    return `https://wa.me/${normalizePhone(draft.toAddress)}?text=${encodeURIComponent(draft.body)}`;
  },
};
