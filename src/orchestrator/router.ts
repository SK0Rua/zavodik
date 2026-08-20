/**
 * Stage router: after each worker finishes it calls advance(), which decides
 * the next job for this business based on its current status.
 * Deterministic code decides WHERE the business goes; agents only do work INSIDE stages.
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { enqueue } from './queue.js';
import {
  buildJobPriority, isAutoBuildEligible, normalizeBuildPolicy,
} from './buildPolicy.js';
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

/**
 * Latest audit verdict for a business, or null when it was never audited.
 * "Never audited" is deliberately distinct from "has a site": the build policy
 * refuses to spend a build on an unknown.
 */
export async function latestAuditVerdict(businessId: string): Promise<string | null> {
  const [row] = await db.select({ verdict: schema.websiteAudits.verdict })
    .from(schema.websiteAudits)
    .where(eq(schema.websiteAudits.businessId, businessId))
    .orderBy(desc(schema.websiteAudits.auditedAt))
    .limit(1);
  return row?.verdict ?? null;
}

export async function advance(businessId: string): Promise<void> {
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) return;
  const next = NEXT_JOB[biz.status];
  if (!next) {
    log.info('no automatic next stage', { businessId, status: biz.status });
    return;
  }

  // ── build policy gate (SPEC §4 stage 9; Roman's rule) ────────────────────
  // Reaching `production_ready` means the evidence is good enough to build. It
  // does NOT by itself mean the factory should spend subscription time on this
  // lead: a business with a good modern site is a worse target than one with no
  // site at all. The campaign's `auto_build` policy decides; ineligible
  // businesses rest in `production_ready` until Roman presses "Будувати демо".
  if (next === 'content-and-design') {
    const [campaign] = await db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.id, biz.campaignId));
    const policy = normalizeBuildPolicy(campaign?.autoBuild);
    const verdict = await latestAuditVerdict(businessId);
    const decision = isAutoBuildEligible({ policy, latestVerdict: verdict });
    if (!decision.eligible) {
      log.info('auto-build skipped by campaign policy', {
        businessId, policy, verdict, reason: decision.reason,
      });
      return;
    }
    await enqueue(next, { businessId, campaignId: biz.campaignId }, {
      priority: buildJobPriority({ latestVerdict: verdict, score: biz.score }),
    });
    return;
  }

  await enqueue(next, { businessId, campaignId: biz.campaignId });
}
