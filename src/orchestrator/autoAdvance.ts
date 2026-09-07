/**
 * The campaign-level gates on AUTOMATIC stage advancement.
 *
 * Both of these used to live in `advance()` in `router.ts`. When the workflow
 * rewrite moved chaining into the workers themselves — each one now enqueues
 * its own continuation through `commitWorkflow` — the build-policy gate came
 * along (it lives in `readiness.ts`), but these two did not, and `router.ts`
 * was left orphaned. The result was two controls the UI still presented as
 * working while nothing in `src/` read them: «Зупинити» wrote
 * `campaigns.status = 'paused'` for no reader, and the stop-point ladder had
 * zero callers.
 *
 * THIS GATES THE AUTOMATIC PATH ONLY. An operator command — «Будувати демо»,
 * «Зібрати дані» — is Roman speaking for himself and must still work on a
 * paused campaign; those go through the command services, not through here.
 * Putting the check in `processJob` instead would have been simpler and wrong
 * for exactly that reason: it would have silently cancelled his own clicks.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import { autoStageAllows, normalizeAutoStage } from './campaignFlow.js';
import { log } from '../lib/logger.js';

type AutoAdvanceDatabase = NodePgDatabase<typeof schema>;
type AutoAdvanceTransaction =
  Parameters<Parameters<AutoAdvanceDatabase['transaction']>[0]>[0];

export type AutoAdvanceBlock = 'campaign_paused' | 'stop_point' | null;

/**
 * Why this automatic continuation must not be enqueued, or null when it may.
 *
 * Reads the campaign inside the caller's transaction so the decision is taken
 * against the same snapshot as the stage transition it accompanies — a pause
 * landing mid-commit cannot be half-applied.
 */
export async function autoAdvanceBlock(
  tx: AutoAdvanceTransaction,
  campaignId: string | null | undefined,
  nextJob: string,
): Promise<AutoAdvanceBlock> {
  if (!campaignId) return null;

  const [campaign] = await tx.select({
    status: schema.campaigns.status,
    autoStage: schema.campaigns.autoStage,
  }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
  if (!campaign) return null;

  // A paused campaign starts no new work. Jobs already running finish and
  // their businesses simply rest where they are — the soft stop that matches
  // «падіння одного бізнесу не зупиняє кампанію»: nothing is cancelled, the
  // conveyor just stops feeding itself.
  if (campaign.status === 'paused') return 'campaign_paused';

  if (!autoStageAllows(normalizeAutoStage(campaign.autoStage), nextJob)) {
    return 'stop_point';
  }
  return null;
}

/**
 * `autoAdvanceBlock` with the logging every call site would otherwise repeat.
 * Returns true when the continuation may be enqueued.
 */
export async function mayAutoAdvance(
  tx: AutoAdvanceTransaction,
  input: { campaignId: string | null | undefined; businessId: string; nextJob: string },
): Promise<boolean> {
  const blocked = await autoAdvanceBlock(tx, input.campaignId, input.nextJob);
  if (!blocked) return true;
  log.info(
    blocked === 'campaign_paused'
      ? 'auto-advance halted: campaign paused'
      : 'auto-advance stopped by campaign stop-point',
    { businessId: input.businessId, campaignId: input.campaignId, next: input.nextJob },
  );
  return false;
}
