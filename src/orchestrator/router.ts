/**
 * Stage router: after each worker finishes it calls advance(), which decides
 * the next job for this business based on its current status.
 * Deterministic code decides WHERE the business goes; agents only do work INSIDE stages.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { enqueue } from './queue.js';
import { log } from '../lib/logger.js';

const NEXT_JOB: Record<string, Parameters<typeof enqueue>[0] | null> = {
  discovered: 'fast-qualify',
  prequalified: 'enrich',
  enriching: null,           // enrich worker itself finishes and transitions
  qualified: 'readiness-gate',
  production_ready: 'content-and-design',
  site_in_progress: null,    // builder/QA drive this
  site_ready: 'request-approval',
  outreach_approved: 'send-outreach',
  needs_review: null,        // human decision in dashboard/telegram
  contacted: null,           // replies poller drives this
};

export async function advance(businessId: string): Promise<void> {
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) return;
  const next = NEXT_JOB[biz.status];
  if (!next) {
    log.info('no automatic next stage', { businessId, status: biz.status });
    return;
  }
  await enqueue(next, { businessId, campaignId: biz.campaignId });
}
