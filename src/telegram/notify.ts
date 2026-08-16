import { config } from '../config.js';
import { log } from '../lib/logger.js';

/** Fire-and-forget Telegram notification. No-op if bot is not configured. */
export async function notifyTelegram(text: string, extra?: Record<string, unknown>): Promise<number | null> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    log.warn('telegram not configured, skipping notification', { text: text.slice(0, 120) });
    return null;
  }
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegram.chatId, text, parse_mode: 'HTML', ...extra }),
  });
  const data = await res.json().catch(() => null) as any;
  if (!data?.ok) {
    log.error('telegram send failed', { data });
    return null;
  }
  return data.result.message_id as number;
}

export async function sendTelegramPhoto(photoUrl: string, caption: string): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) return;
  await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegram.chatId, photo: photoUrl, caption, parse_mode: 'HTML' }),
  }).catch(() => {});
}
