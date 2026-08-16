/**
 * Outreach sender. Runs ONLY after a recorded approval.
 * - email: SMTP, fully automated, followups scheduled.
 * - whatsapp: Cloud API if configured, else a manual wa.me card to Telegram.
 * - instagram_manual: prepared text card to Telegram (DM automation = account ban risk; never automated).
 * Separate idempotency key per message: a retry can NEVER double-send.
 * FACTORY_MODE=dry_run simulates sends end-to-end.
 */
import nodemailer from 'nodemailer';
import { and, eq, desc, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { config } from '../config.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { notifyTelegram } from '../telegram/notify.js';
import { log } from '../lib/logger.js';

function transporter() {
  return nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

async function dailySendCount(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db.select({ n: sql<number>`count(*)` }).from(schema.outreachMessages)
    .where(and(eq(schema.outreachMessages.state, 'sent'), gte(schema.outreachMessages.sentAt, since)));
  return Number(rows[0]?.n ?? 0);
}

export async function sendOutreachHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const kind = (payload.kind as string | undefined) ?? 'initial';

  // hard gate: approval must exist and be 'approved'
  const [approval] = await db.select().from(schema.approvals)
    .where(and(eq(schema.approvals.businessId, businessId), eq(schema.approvals.kind, 'outreach')))
    .orderBy(desc(schema.approvals.createdAt)).limit(1);
  if (!approval || approval.decision !== 'approved') {
    throw new Error(`no recorded approval for ${businessId}; refusing to send`);
  }
  const draft = (approval.payload as any)?.draft as { channel: string; toAddress: string; subject: string | null; body: string };
  if (!draft) throw new Error('approval has no draft payload');

  // dnc final check
  const dnc = await db.select().from(schema.doNotContact);
  if (dnc.some((d) => d.value === draft.toAddress || (d.matchType === 'business_id' && d.value === businessId))) {
    await transition(businessId, 'do_not_contact', 'outreach-worker', 'dnc match at send time');
    return;
  }

  // idempotency: one initial message per business per channel, ever
  const idempotencyKey = `outreach:${businessId}:${draft.channel}:${kind}`;
  const dupe = await db.select().from(schema.outreachMessages)
    .where(eq(schema.outreachMessages.idempotencyKey, idempotencyKey));
  if (dupe.length && dupe[0].state !== 'failed') {
    log.warn('outreach already sent/queued, refusing duplicate', { businessId, idempotencyKey });
    return;
  }

  if ((await dailySendCount()) >= config.outreachDailyLimit) {
    throw new Error('daily outreach limit reached; job will retry via manual re-enqueue tomorrow');
  }

  const [msg] = await db.insert(schema.outreachMessages).values({
    businessId, channel: draft.channel, toAddress: draft.toAddress,
    subject: draft.subject, body: draft.body, idempotencyKey, kind,
    state: 'queued',
  }).onConflictDoNothing().returning();
  if (!msg) { log.warn('message row already existed', { idempotencyKey }); return; }

  const isDry = config.mode === 'dry_run';
  let providerMessageId: string | null = null;
  let finalState = 'sent';

  try {
    if (isDry) {
      finalState = 'simulated';
      log.info('DRY RUN: outreach simulated', { businessId, channel: draft.channel, to: draft.toAddress });
    } else if (draft.channel === 'email') {
      const info = await transporter().sendMail({
        from: config.smtp.from, to: draft.toAddress,
        subject: draft.subject ?? `Ідея для ${businessId}`,
        text: draft.body,
      });
      providerMessageId = info.messageId ?? null;
    } else if (draft.channel === 'whatsapp' && config.whatsapp.token) {
      const res = await fetch(`https://graph.facebook.com/v20.0/${config.whatsapp.phoneId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.whatsapp.token}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: draft.toAddress.replace(/[^\d]/g, ''),
          type: 'text', text: { body: draft.body },
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(`whatsapp send failed: ${JSON.stringify(data).slice(0, 300)}`);
      providerMessageId = data.messages?.[0]?.id ?? null;
    } else {
      // manual channels: prepared card to Telegram, one-tap for Roman
      finalState = 'manual_pending';
      const link = draft.channel === 'whatsapp'
        ? `https://wa.me/${draft.toAddress.replace(/[^\d]/g, '')}?text=${encodeURIComponent(draft.body)}`
        : draft.toAddress;
      await notifyTelegram(
        `📨 Ручна відправка для <b>${businessId}</b> (${draft.channel})\n${link}\n\n<b>Текст:</b>\n${draft.body}`,
      );
    }
  } catch (err) {
    await db.update(schema.outreachMessages).set({ state: 'failed' }).where(eq(schema.outreachMessages.id, msg.id));
    throw err;
  }

  await db.update(schema.outreachMessages)
    .set({ state: finalState, providerMessageId, sentAt: new Date() })
    .where(eq(schema.outreachMessages.id, msg.id));
  await db.insert(schema.outreachEvents).values({ businessId, messageId: msg.id, event: 'sent', detail: { finalState } });

  if (kind === 'initial') {
    await transition(businessId, 'contacted', 'outreach-worker', `${draft.channel} ${finalState}`);
    await db.insert(schema.deals).values({ businessId, state: 'contacted' }).onConflictDoNothing();
    // schedule follow-ups (cancelled automatically on reply/opt-out by followup handler checks)
    for (let i = 0; i < config.followupDays.length; i++) {
      const b = await import('../orchestrator/queue.js').then((m) => m.getBoss());
      await b.send('send-followup',
        { businessId, followupIndex: i + 1, idempotencyKey: `followup:${businessId}:${i + 1}` },
        { startAfter: config.followupDays[i] * 24 * 3600, singletonKey: `followup:${businessId}:${i + 1}` });
    }
  }
  log.info('outreach done', { businessId, channel: draft.channel, state: finalState });
}

export async function sendFollowupHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const idx = payload.followupIndex as number;

  // stop conditions: reply, opt-out, dnc, deal moved on
  const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.businessId, businessId));
  if (deal && deal.state !== 'contacted') { log.info('followup skipped: deal advanced', { businessId, state: deal.state }); return; }
  const events = await db.select().from(schema.outreachEvents).where(eq(schema.outreachEvents.businessId, businessId));
  if (events.some((e) => ['replied', 'opted_out', 'bounced'].includes(e.event))) {
    log.info('followup skipped: reply/opt-out/bounce', { businessId }); return;
  }

  const [initial] = await db.select().from(schema.outreachMessages)
    .where(and(eq(schema.outreachMessages.businessId, businessId), eq(schema.outreachMessages.kind, 'initial')));
  if (!initial || !['sent', 'simulated'].includes(initial.state)) return;

  const followupBody = idx === 1
    ? `Просто нагадаю про демо, яке я зробив для вас 🙂 Якщо цікаво, гляньте, коли буде хвилинка.`
    : `Останнє нагадування: демо ще активне. Якщо неактуально, просто проігноруйте це повідомлення, більше не потурбую.`;

  const idempotencyKey = `outreach:${businessId}:${initial.channel}:followup_${idx}`;
  const dupe = await db.select().from(schema.outreachMessages).where(eq(schema.outreachMessages.idempotencyKey, idempotencyKey));
  if (dupe.length) return;

  const isDry = config.mode === 'dry_run';
  const [msg] = await db.insert(schema.outreachMessages).values({
    businessId, channel: initial.channel, toAddress: initial.toAddress,
    subject: initial.subject ? `Re: ${initial.subject}` : null,
    body: followupBody, idempotencyKey, kind: `followup_${idx}`,
    state: 'queued',
  }).returning();

  if (isDry) {
    await db.update(schema.outreachMessages).set({ state: 'simulated', sentAt: new Date() }).where(eq(schema.outreachMessages.id, msg.id));
  } else if (initial.channel === 'email') {
    const info = await transporter().sendMail({
      from: config.smtp.from, to: initial.toAddress,
      subject: initial.subject ? `Re: ${initial.subject}` : 'Нагадування',
      text: followupBody,
      inReplyTo: initial.providerMessageId ?? undefined,
    });
    await db.update(schema.outreachMessages)
      .set({ state: 'sent', providerMessageId: info.messageId ?? null, sentAt: new Date() })
      .where(eq(schema.outreachMessages.id, msg.id));
  } else {
    await db.update(schema.outreachMessages).set({ state: 'manual_pending' }).where(eq(schema.outreachMessages.id, msg.id));
    await notifyTelegram(`📨 Ручний follow-up #${idx} для <b>${businessId}</b>:\n${followupBody}`);
  }
  log.info('followup processed', { businessId, idx });
}
