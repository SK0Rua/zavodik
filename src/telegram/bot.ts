/**
 * Telegram is a NOTIFICATION CHANNEL ONLY (decision #9).
 *
 * All control — approvals, editing the message, changing the channel, manual
 * business/campaign actions — lives in the web UI. The approve/reject callback
 * handlers and the /status command that used to live here were removed in
 * phase D; sending is `notifyTelegram()` in ./notify.ts, which needs no bot
 * process at all.
 *
 * The only reason to run a bot process is the one-time chat-id discovery during
 * setup: start it, message the bot, copy the printed id into TELEGRAM_CHAT_ID.
 */
import { Bot } from 'grammy';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

/**
 * Chat-id discovery helper. Does NOT accept commands and never mutates factory
 * state — it only echoes the chat id so setup can be completed.
 * Not started by `src/main.ts`; run it explicitly via `pnpm telegram:setup`.
 */
export function startChatIdDiscovery(): void {
  if (!config.telegram.botToken) {
    log.warn('TELEGRAM_BOT_TOKEN not set; nothing to discover');
    return;
  }
  const bot = new Bot(config.telegram.botToken);
  bot.on('message', async (ctx) => {
    const id = ctx.chat.id;
    log.info('telegram chat id discovered', { chatId: id });
    await ctx.reply(
      `chat_id: ${id}\n\nВстав це у .env як TELEGRAM_CHAT_ID і перезапусти фабрику.\n` +
      'Керування фабрикою — тільки у веб-UI; тут будуть лише сповіщення.',
    );
  });
  bot.start({ drop_pending_updates: true });
  log.info('telegram chat-id discovery running; message the bot to get your chat id');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startChatIdDiscovery();
}
