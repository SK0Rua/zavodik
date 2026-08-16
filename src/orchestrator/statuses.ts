import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';

export const BUSINESS_STATUSES = [
  'discovered', 'prequalified', 'enriching', 'needs_review', 'qualified',
  'production_ready', 'site_in_progress', 'site_ready', 'outreach_approved',
  'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost',
  // terminal/exception
  'rejected', 'duplicate', 'closed', 'do_not_contact',
] as const;

export type BusinessStatus = typeof BUSINESS_STATUSES[number];

/** Allowed transitions. Anything not listed requires a human (recorded as actor='roman'). */
const TRANSITIONS: Record<string, BusinessStatus[]> = {
  discovered: ['prequalified', 'rejected', 'duplicate', 'needs_review'],
  prequalified: ['enriching', 'rejected', 'needs_review'],
  enriching: ['needs_review', 'qualified', 'rejected'],
  needs_review: ['enriching', 'qualified', 'rejected', 'production_ready'],
  qualified: ['production_ready', 'enriching', 'needs_review', 'rejected'],
  production_ready: ['site_in_progress'],
  site_in_progress: ['site_ready', 'needs_review'],
  site_ready: ['outreach_approved', 'needs_review', 'rejected'],
  outreach_approved: ['contacted'],
  contacted: ['replied', 'closed', 'do_not_contact'],
  replied: ['meeting', 'proposal', 'won', 'lost', 'do_not_contact'],
  meeting: ['proposal', 'won', 'lost'],
  proposal: ['won', 'lost'],
};

export async function transition(
  businessId: string,
  to: BusinessStatus,
  actor: string,
  reason?: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);
  const from = biz.status as BusinessStatus;
  if (from === to) return;

  const allowed = TRANSITIONS[from] ?? [];
  const isHuman = actor === 'roman' || opts.force === true;
  if (!allowed.includes(to) && !isHuman) {
    throw new Error(`illegal transition ${from} -> ${to} by ${actor} for ${businessId}`);
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.businesses)
      .set({ status: to, statusReason: reason ?? null, updatedAt: new Date() })
      .where(eq(schema.businesses.id, businessId));
    await tx.insert(schema.statusHistory).values({
      businessId, fromStatus: from, toStatus: to, reason: reason ?? null, actor,
    });
  });
  log.info('status transition', { businessId, from, to, actor, reason });
}
