/**
 * Outreach approval request: Telegram card with business, score, demo URL,
 * drafted first message and Approve/Reject/Needs-changes buttons.
 * NOTHING is ever sent without a recorded approval.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { config } from '../config.js';
import { runAgent, z } from '../agents/agent.js';
import { buildClientSnapshot } from './snapshot.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

const MessageSchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'instagram_manual']),
  toAddress: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  reasoning: z.string(),
});

export async function pickChannelAndDraft(businessId: string) {
  const snapshot = await buildClientSnapshot(businessId);
  const contacts = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));
  const verified = contacts.filter((c) => c.verified);
  const [project] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.businessId, businessId))
    .orderBy(desc(schema.siteProjects.createdAt)).limit(1);

  const email = verified.find((c) => c.channel === 'email');
  const whatsapp = verified.find((c) => c.channel === 'whatsapp')
    ?? (config.whatsapp.token ? verified.find((c) => c.channel === 'phone') : undefined);
  const instagram = verified.find((c) => c.channel === 'instagram');

  // channel priority: email (fully automated) > whatsapp > instagram (manual card)
  const available = [
    email && { channel: 'email' as const, to: email.value },
    whatsapp && { channel: 'whatsapp' as const, to: whatsapp.value },
    instagram && { channel: 'instagram_manual' as const, to: instagram.value },
  ].filter(Boolean) as Array<{ channel: 'email' | 'whatsapp' | 'instagram_manual'; to: string }>;

  if (!available.length) throw new Error('no verified outreach channel');

  const draft = await runAgent(
    'outreach-writer',
    `You write a short, personal first outreach message from Roman, a web developer, to a local business owner.
Language: the business's language (${snapshot.language}). Tone: warm, specific, zero spam clichés.
Structure: 1) one specific genuine observation about THEIR business (from snapshot facts),
2) that you built them a free personalized demo website, link included, 3) soft CTA (reply / take a look).
Max 120 words for email, max 80 for whatsapp/instagram. Never invent facts.
Preferred channel: ${available[0].channel} to ${available[0].to}. Demo URL: ${project?.deployUrl ?? 'MISSING'}.`,
    JSON.stringify({ snapshot, availableChannels: available }, null, 2),
    MessageSchema,
  );
  return { draft, snapshot, project };
}

export async function requestApprovalHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const { draft, snapshot, project } = await pickChannelAndDraft(businessId);
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));

  const [approval] = await db.insert(schema.approvals).values({
    businessId, kind: 'outreach',
    payload: { draft, demoUrl: project?.deployUrl },
  }).returning();

  if (!config.telegram.botToken || !config.telegram.chatId) {
    log.warn('telegram not configured; approval waits in dashboard', { businessId, approvalId: approval.id });
    return;
  }

  const text =
    `🚀 <b>${snapshot.name}</b> готовий до outreach\n` +
    `Ніша: ${snapshot.category ?? '-'} | Score: ${biz?.score ?? '-'}\n` +
    `Site verdict: ${snapshot.websiteVerdict}\n` +
    `Demo: ${project?.deployUrl ?? '-'}\n` +
    `Канал: <b>${draft.channel}</b> → ${draft.toAddress}\n\n` +
    `<b>Повідомлення:</b>\n${draft.subject ? `Subject: ${draft.subject}\n` : ''}${draft.body}`;

  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegram.chatId, text, parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `approve:${approval.id}` },
          { text: '❌ Reject', callback_data: `reject:${approval.id}` },
          { text: '✏️ Changes', callback_data: `changes:${approval.id}` },
        ]],
      },
    }),
  });
  const data = await res.json().catch(() => null) as any;
  if (data?.ok) {
    await db.update(schema.approvals)
      .set({ telegramMessageId: String(data.result.message_id) })
      .where(eq(schema.approvals.id, approval.id));
  }
  log.info('approval requested', { businessId, approvalId: approval.id, channel: draft.channel });
}
