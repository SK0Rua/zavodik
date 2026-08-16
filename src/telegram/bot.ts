/**
 * Telegram bot: approval buttons + basic commands.
 * Approve -> records approval -> transitions business -> enqueues send-outreach.
 */
import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { config } from '../config.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

export function startTelegramBot(): void {
  if (!config.telegram.botToken) {
    log.warn('TELEGRAM_BOT_TOKEN not set; approval bot disabled (use dashboard API)');
    return;
  }
  const bot = new Bot(config.telegram.botToken);

  bot.on('callback_query:data', async (ctx) => {
    const [action, idStr] = (ctx.callbackQuery.data ?? '').split(':');
    const approvalId = Number(idStr);
    if (!approvalId) return ctx.answerCallbackQuery({ text: 'bad payload' });

    // only Roman's chat can approve
    if (String(ctx.chat?.id) !== String(config.telegram.chatId)) {
      return ctx.answerCallbackQuery({ text: 'not authorized' });
    }

    const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
    if (!approval) return ctx.answerCallbackQuery({ text: 'approval not found' });
    if (approval.decision) return ctx.answerCallbackQuery({ text: `already decided: ${approval.decision}` });

    const decisionMap: Record<string, string> = { approve: 'approved', reject: 'rejected', changes: 'needs_changes' };
    const decision = decisionMap[action];
    if (!decision) return ctx.answerCallbackQuery({ text: 'unknown action' });

    await db.update(schema.approvals)
      .set({ decision, decidedBy: 'roman', decidedAt: new Date() })
      .where(eq(schema.approvals.id, approvalId));

    if (decision === 'approved') {
      await transition(approval.businessId, 'outreach_approved', 'roman', `approval #${approvalId}`);
      await enqueue('send-outreach', {
        businessId: approval.businessId,
        idempotencyKey: `send-outreach:${approval.businessId}:initial`,
      });
      await ctx.answerCallbackQuery({ text: '✅ Approved, sending' });
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      await ctx.reply(`✅ Outreach для ${approval.businessId} затверджено і поставлено в чергу.`);
    } else if (decision === 'rejected') {
      await transition(approval.businessId, 'rejected', 'roman', `approval #${approvalId} rejected`);
      await ctx.answerCallbackQuery({ text: '❌ Rejected' });
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    } else {
      await transition(approval.businessId, 'needs_review', 'roman', 'needs changes to outreach/message', { force: true });
      await ctx.answerCallbackQuery({ text: '✏️ Marked needs_changes' });
      await ctx.reply(`✏️ ${approval.businessId}: познач у дашборді, що саме змінити, і перезапусти request-approval.`);
    }
  });

  bot.command('status', async (ctx) => {
    if (String(ctx.chat?.id) !== String(config.telegram.chatId)) return;
    const rows = await db.select().from(schema.businesses);
    const byStatus = new Map<string, number>();
    rows.forEach((b) => byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1));
    await ctx.reply([...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join('\n') || 'порожньо');
  });

  bot.start({ drop_pending_updates: true });
  log.info('telegram bot started');
}
