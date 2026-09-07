/**
 * Archive and delete for businesses and campaigns.
 *
 * Two different operations with deliberately different weights:
 *
 *   ARCHIVE — reversible, cheap, the default answer. Sets `archived_at`, which
 *   every list view filters on. Nothing is destroyed, the workflow status is
 *   untouched, and un-archiving puts the row back exactly where it was. It does
 *   stop in-flight work (Roman's decision 2026-09-07): a shelved business must
 *   not keep spending agent concurrency on a build nobody will look at.
 *
 *   DELETE — irreversible, and REFUSED once outreach has happened. This is not
 *   squeamishness about data: `approvals` and `outreach_messages` ARE the proof
 *   that carries the project's core invariant («без записаного в БД approval
 *   жоден send неможливий; один send на idempotency key»). Delete that proof
 *   and the same business, rediscovered next month, is contactable again as if
 *   the first message never went out. So a contacted business can only ever be
 *   archived, and the UI says so instead of offering a button that fails.
 *
 * Campaigns follow the same rule one level up: archiving cascades to their
 * businesses, deletion is only allowed once no businesses remain.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';

type ArchiveDatabase = NodePgDatabase<typeof schema>;
type ArchiveTransaction = Parameters<Parameters<ArchiveDatabase['transaction']>[0]>[0];

/** Site-project states that still represent work in flight. */
const ACTIVE_PROJECT_STATES = [
  'pending', 'brief', 'building', 'qa', 'ready', 'needs_human_review',
] as const;

/**
 * Statuses an archive may close, for both attempts and logical runs.
 *
 * Wider than "in flight" on purpose: `failed` and `needs_human` are parked
 * rather than running, but they are exactly what sits in Roman's Inbox asking
 * for a decision. Shelving the business has to clear those too, or archiving
 * would hide the business everywhere except the one screen that nags about it.
 */
const CANCELLABLE_STATUSES = ['queued', 'running', 'retry_wait', 'failed', 'needs_human'] as const;

export type ArchiveConflict =
  | { kind: 'not_found'; entity: 'business' | 'campaign' }
  | { kind: 'blocked'; message: string };

export type ArchiveBusinessResult = ArchiveConflict | {
  kind: 'archived';
  businessId: string;
  cancelledJobs: number;
  cancelledProjects: number;
};

export type UnarchiveBusinessResult = ArchiveConflict | {
  kind: 'unarchived';
  businessId: string;
};

export type DeleteBusinessResult = ArchiveConflict | {
  kind: 'deleted';
  businessId: string;
};

export type ArchiveCampaignResult = ArchiveConflict | {
  kind: 'archived';
  campaignId: string;
  archivedBusinesses: number;
};

export type UnarchiveCampaignResult = ArchiveConflict | {
  kind: 'unarchived';
  campaignId: string;
  restoredBusinesses: number;
};

export type DeleteCampaignResult = ArchiveConflict | {
  kind: 'deleted';
  campaignId: string;
};

export interface BulkArchiveResult {
  /** How many rows this call actually moved (already-archived ones are not counted). */
  archived: number;
  cancelledJobs: number;
  cancelledProjects: number;
  /** Ids that were asked for but do not exist. */
  missing: number;
}

export interface BulkRestoreResult {
  restored: number;
}

export interface BulkDeleteResult {
  deleted: number;
  /** Businesses skipped because outreach exists — they can only be archived. */
  blocked: number;
  missing: number;
}

/**
 * Postgres takes at most 65535 bind parameters per statement, and a filter can
 * legitimately select thousands of businesses. Work in chunks so a large
 * «архівувати все за фільтром» is a few statements rather than one that the
 * driver refuses to send.
 */
const CHUNK = 500;

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Why a business may not be hard-deleted, in Roman's words, or null if it may. */
export async function outreachDeleteBlocker(
  tx: ArchiveTransaction,
  businessId: string,
): Promise<string | null> {
  const [approvals] = await tx.select({ n: sql<number>`count(*)` })
    .from(schema.approvals)
    .where(eq(schema.approvals.businessId, businessId));
  const [messages] = await tx.select({ n: sql<number>`count(*)` })
    .from(schema.outreachMessages)
    .where(eq(schema.outreachMessages.businessId, businessId));

  const approvalCount = Number(approvals?.n ?? 0);
  const messageCount = Number(messages?.n ?? 0);
  if (!approvalCount && !messageCount) return null;

  return 'Цьому бізнесу вже писали (або є записаний approval), '
    + 'тому видалити його не можна — інакше система зможе написати повторно. '
    + 'Заархівуй його: він зникне зі списків, а історія контакту збережеться.';
}

export class ArchiveService {
  constructor(
    private readonly db: ArchiveDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Shelve a business and stop whatever it still has running.
   *
   * Idempotent: archiving an already-archived business is a no-op success, so a
   * double-click or a retried request cannot produce a second cancel storm.
   */
  async archiveBusiness(businessId: string, reason?: string): Promise<ArchiveBusinessResult> {
    return this.db.transaction(async (tx) => {
      const [business] = await tx.select({
        id: schema.businesses.id,
        archivedAt: schema.businesses.archivedAt,
      }).from(schema.businesses).where(eq(schema.businesses.id, businessId));
      if (!business) return { kind: 'not_found', entity: 'business' } as const;
      if (business.archivedAt) {
        return { kind: 'archived', businessId, cancelledJobs: 0, cancelledProjects: 0 } as const;
      }

      const at = this.now();
      const cancelled = await this.cancelInFlightWork(tx, [businessId], reason);
      await tx.update(schema.businesses)
        .set({ archivedAt: at, archivedReason: reason ?? null, updatedAt: at })
        .where(eq(schema.businesses.id, businessId));

      return {
        kind: 'archived',
        businessId,
        cancelledJobs: cancelled.jobs,
        cancelledProjects: cancelled.projects,
      } as const;
    });
  }

  /**
   * Archive many businesses as ONE operation.
   *
   * Set-based rather than a loop over `archiveBusiness`: cancelling in-flight
   * work is already expressed as `where business_id in (…)`, so archiving 900
   * businesses costs a handful of statements instead of 900 round trips — and,
   * more importantly, it either all lands or none of it does. A client-side
   * loop would leave a half-archived filter behind on the first failure.
   *
   * Already-archived rows are skipped, not re-stamped: re-running the same
   * filter must not reset an earlier archive's timestamp, which is what
   * `unarchiveCampaign` matches on.
   */
  async archiveBusinesses(
    businessIds: readonly string[],
    reason?: string,
  ): Promise<BulkArchiveResult> {
    const unique = [...new Set(businessIds.filter(Boolean))];
    if (!unique.length) {
      return { archived: 0, cancelledJobs: 0, cancelledProjects: 0, missing: 0 };
    }

    return this.db.transaction(async (tx) => {
      const at = this.now();
      const found: string[] = [];
      const live: string[] = [];
      for (const batch of chunked(unique)) {
        const rows = await tx.select({
          id: schema.businesses.id,
          archivedAt: schema.businesses.archivedAt,
        }).from(schema.businesses).where(inArray(schema.businesses.id, batch));
        for (const row of rows) {
          found.push(row.id);
          if (!row.archivedAt) live.push(row.id);
        }
      }

      let cancelledJobs = 0;
      let cancelledProjects = 0;
      for (const batch of chunked(live)) {
        const cancelled = await this.cancelInFlightWork(tx, batch, reason);
        cancelledJobs += cancelled.jobs;
        cancelledProjects += cancelled.projects;
        await tx.update(schema.businesses)
          .set({ archivedAt: at, archivedReason: reason ?? null, updatedAt: at })
          .where(inArray(schema.businesses.id, batch));
      }

      return {
        archived: live.length,
        cancelledJobs,
        cancelledProjects,
        missing: unique.length - found.length,
      };
    });
  }

  /** Restore many businesses. Rows that are not archived are simply untouched. */
  async unarchiveBusinesses(businessIds: readonly string[]): Promise<BulkRestoreResult> {
    const unique = [...new Set(businessIds.filter(Boolean))];
    if (!unique.length) return { restored: 0 };

    return this.db.transaction(async (tx) => {
      const at = this.now();
      let restored = 0;
      for (const batch of chunked(unique)) {
        const rows = await tx.update(schema.businesses)
          .set({ archivedAt: null, archivedReason: null, updatedAt: at })
          .where(and(
            inArray(schema.businesses.id, batch),
            isNotNull(schema.businesses.archivedAt),
          ))
          .returning({ id: schema.businesses.id });
        restored += rows.length;
      }
      return { restored };
    });
  }

  /**
   * Delete many businesses, skipping every one that outreach protects.
   *
   * The blocked ones are counted and reported rather than aborting the batch:
   * «видалити 40 відфільтрованих» where 3 were contacted should delete 37 and
   * say so, not refuse all 40 or — far worse — destroy the 3 audit trails.
   */
  async deleteBusinesses(businessIds: readonly string[]): Promise<BulkDeleteResult> {
    const unique = [...new Set(businessIds.filter(Boolean))];
    if (!unique.length) return { deleted: 0, blocked: 0, missing: 0 };

    return this.db.transaction(async (tx) => {
      let deleted = 0;
      let blocked = 0;
      let found = 0;

      for (const batch of chunked(unique)) {
        const rows = await tx.select({ id: schema.businesses.id })
          .from(schema.businesses).where(inArray(schema.businesses.id, batch));
        found += rows.length;
        for (const row of rows) {
          if (await outreachDeleteBlocker(tx, row.id)) {
            blocked += 1;
            continue;
          }
          await this.deleteBusinessRows(tx, row.id);
          deleted += 1;
        }
      }

      return { deleted, blocked, missing: unique.length - found };
    });
  }

  async unarchiveBusiness(businessId: string): Promise<UnarchiveBusinessResult> {
    const updated = await this.db.update(schema.businesses)
      .set({ archivedAt: null, archivedReason: null, updatedAt: this.now() })
      .where(eq(schema.businesses.id, businessId))
      .returning({ id: schema.businesses.id });
    if (!updated.length) return { kind: 'not_found', entity: 'business' };
    return { kind: 'unarchived', businessId };
  }

  /**
   * Erase a business and everything hanging off it.
   *
   * Refuses when outreach exists (see the module docblock). Runs in one
   * transaction so a failure part-way cannot leave orphan evidence behind.
   */
  async deleteBusiness(businessId: string): Promise<DeleteBusinessResult> {
    return this.db.transaction(async (tx) => {
      const [business] = await tx.select({ id: schema.businesses.id })
        .from(schema.businesses).where(eq(schema.businesses.id, businessId));
      if (!business) return { kind: 'not_found', entity: 'business' } as const;

      const blocker = await outreachDeleteBlocker(tx, businessId);
      if (blocker) return { kind: 'blocked', message: blocker } as const;

      await this.deleteBusinessRows(tx, businessId);
      return { kind: 'deleted', businessId } as const;
    });
  }

  async archiveCampaign(campaignId: string, reason?: string): Promise<ArchiveCampaignResult> {
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.select({
        id: schema.campaigns.id,
        archivedAt: schema.campaigns.archivedAt,
      }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
      if (!campaign) return { kind: 'not_found', entity: 'campaign' } as const;
      if (campaign.archivedAt) {
        return { kind: 'archived', campaignId, archivedBusinesses: 0 } as const;
      }

      const live = await tx.select({ id: schema.businesses.id })
        .from(schema.businesses)
        .where(and(
          eq(schema.businesses.campaignId, campaignId),
          isNull(schema.businesses.archivedAt),
        ));
      const liveIds = live.map((row) => row.id);

      // ONE timestamp for the campaign and every business it shelves. This is
      // load-bearing, not tidiness: `unarchiveCampaign` identifies "the rows
      // this cascade archived" by matching that exact instant, so calling
      // now() twice would stamp times milliseconds apart and the restore would
      // match nothing at all.
      const at = this.now();

      if (liveIds.length) {
        await this.cancelInFlightWork(tx, liveIds, reason);
        await tx.update(schema.businesses)
          .set({
            archivedAt: at,
            archivedReason: reason ?? null,
            updatedAt: at,
          })
          .where(inArray(schema.businesses.id, liveIds));
      }

      // A campaign nobody is looking at must not keep discovering new leads.
      await tx.update(schema.campaigns)
        .set({
          archivedAt: at,
          archivedReason: reason ?? null,
          status: 'paused',
        })
        .where(eq(schema.campaigns.id, campaignId));

      return { kind: 'archived', campaignId, archivedBusinesses: liveIds.length } as const;
    });
  }

  /**
   * Restore a campaign.
   *
   * Only the businesses this campaign's own archiving shelved come back: a
   * business Roman archived by hand BEFORE the campaign was archived stays
   * archived, which is why the cascade is matched on `archived_at`, not blindly
   * cleared for every row in the campaign. (Archiving stamps ONE instant across
   * the campaign and its businesses precisely so this match is exact.)
   *
   * The campaign comes back PAUSED, not running: archiving stopped discovery,
   * and quietly resuming a search that spends gosom quota and agent time is not
   * something un-hiding a card should do on its own. Roman presses «Продовжити»
   * when he actually wants it working again.
   */
  async unarchiveCampaign(campaignId: string): Promise<UnarchiveCampaignResult> {
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.select({
        id: schema.campaigns.id,
        archivedAt: schema.campaigns.archivedAt,
      }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
      if (!campaign) return { kind: 'not_found', entity: 'campaign' } as const;
      if (!campaign.archivedAt) {
        return { kind: 'unarchived', campaignId, restoredBusinesses: 0 } as const;
      }

      const restored = await tx.update(schema.businesses)
        .set({ archivedAt: null, archivedReason: null, updatedAt: this.now() })
        .where(and(
          eq(schema.businesses.campaignId, campaignId),
          eq(schema.businesses.archivedAt, campaign.archivedAt),
        ))
        .returning({ id: schema.businesses.id });

      await tx.update(schema.campaigns)
        .set({ archivedAt: null, archivedReason: null })
        .where(eq(schema.campaigns.id, campaignId));

      return { kind: 'unarchived', campaignId, restoredBusinesses: restored.length } as const;
    });
  }

  /** Delete an empty campaign. Businesses must be gone first, by design. */
  async deleteCampaign(campaignId: string): Promise<DeleteCampaignResult> {
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.select({ id: schema.campaigns.id })
        .from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
      if (!campaign) return { kind: 'not_found', entity: 'campaign' } as const;

      const [remaining] = await tx.select({ n: sql<number>`count(*)` })
        .from(schema.businesses)
        .where(eq(schema.businesses.campaignId, campaignId));
      const count = Number(remaining?.n ?? 0);
      if (count) {
        return {
          kind: 'blocked',
          message: `У кампанії ще ${count} бізнес(ів). `
            + 'Видали або заархівуй їх спершу — кампанія видаляється тільки порожньою.',
        } as const;
      }

      // `enrichment_runs` is the only other table with a campaign FK. Deleting
      // the businesses already took its rows with them, so this is a belt-and-
      // braces sweep rather than a load-bearing step. (`city_assessments` has
      // no campaign FK — it is standalone pre-campaign research.)
      await tx.delete(schema.enrichmentRuns)
        .where(eq(schema.enrichmentRuns.campaignId, campaignId));
      await tx.delete(schema.campaigns).where(eq(schema.campaigns.id, campaignId));

      return { kind: 'deleted', campaignId } as const;
    });
  }

  /**
   * Close everything still running for these businesses.
   *
   * Mirrors what «Побудувати заново» already does for a single build, so an
   * archived business leaves the queue the same way a restarted one does —
   * including keeping the logical run ledger in step with the attempt rows.
   */
  private async cancelInFlightWork(
    tx: ArchiveTransaction,
    businessIds: string[],
    reason?: string,
  ): Promise<{ jobs: number; projects: number }> {
    if (!businessIds.length) return { jobs: 0, projects: 0 };
    const finishedAt = this.now();
    const detail = reason?.trim()
      ? `Заархівовано: ${reason.trim()}`
      : 'Заархівовано Романом';

    const projects = await tx.update(schema.siteProjects)
      .set({ state: 'cancelled' })
      .where(and(
        inArray(schema.siteProjects.businessId, businessIds),
        inArray(schema.siteProjects.state, ACTIVE_PROJECT_STATES),
      ))
      .returning({ id: schema.siteProjects.id });

    const attempts = await tx.update(schema.workflowJobs)
      .set({ status: 'cancelled', errorCode: null, errorDetail: detail, finishedAt })
      .where(and(
        inArray(schema.workflowJobs.businessId, businessIds),
        inArray(schema.workflowJobs.status, CANCELLABLE_STATUSES),
      ))
      .returning({ id: schema.workflowJobs.id });

    // Deliberately NOT `transitionCurrentRun`: that helper resolves ONE
    // operator-chosen attempt and throws when the run has moved on, which is
    // the right strictness there and the wrong one here. Archiving cancels a
    // whole business wholesale, so a run that raced ahead must be left alone,
    // not turned into an exception that aborts the archive. The status filter
    // is the guard instead — anything already finished stays as it is.
    await tx.update(schema.workflowJobRuns)
      .set({ status: 'cancelled', updatedAt: finishedAt, finishedAt })
      .where(and(
        inArray(schema.workflowJobRuns.businessId, businessIds),
        inArray(schema.workflowJobRuns.status, CANCELLABLE_STATUSES),
      ));

    // An open enrichment barrier would otherwise wait forever for fan-out
    // results that are never coming.
    await tx.update(schema.enrichmentRuns)
      .set({ status: 'superseded', updatedAt: finishedAt, completedAt: finishedAt })
      .where(and(
        inArray(schema.enrichmentRuns.businessId, businessIds),
        inArray(schema.enrichmentRuns.status, ['running', 'score_enqueued']),
      ));

    return { jobs: attempts.length, projects: projects.length };
  }

  /**
   * Delete every row that hangs off a business, children first.
   *
   * The order is the FK graph, not alphabetical: facts/contacts cite
   * `business_sources`, reconciliation events cite runs and attempts, attempts
   * cite runs, and outreach events cite messages.
   */
  private async deleteBusinessRows(
    tx: ArchiveTransaction,
    businessId: string,
  ): Promise<void> {
    const runs = await tx.select({ id: schema.workflowJobRuns.id })
      .from(schema.workflowJobRuns)
      .where(eq(schema.workflowJobRuns.businessId, businessId));
    const attempts = await tx.select({ id: schema.workflowJobs.id })
      .from(schema.workflowJobs)
      .where(eq(schema.workflowJobs.businessId, businessId));
    const runIds = runs.map((r) => r.id);
    const attemptIds = attempts.map((a) => a.id);

    if (runIds.length) {
      await tx.delete(schema.workflowReconciliationEvents)
        .where(inArray(schema.workflowReconciliationEvents.runId, runIds));
    }
    if (attemptIds.length) {
      await tx.delete(schema.workflowReconciliationEvents)
        .where(inArray(schema.workflowReconciliationEvents.attemptId, attemptIds));
    }

    // Outreach: events cite messages, so they go first. Reaching here at all
    // means the blocker above found no approvals and no messages, so these are
    // no-ops in practice — kept because "no rows" must stay true by deletion,
    // not by assumption.
    await tx.delete(schema.outreachEvents)
      .where(eq(schema.outreachEvents.businessId, businessId));
    await tx.delete(schema.outreachMessages)
      .where(eq(schema.outreachMessages.businessId, businessId));
    await tx.delete(schema.approvals)
      .where(eq(schema.approvals.businessId, businessId));
    await tx.delete(schema.deals)
      .where(eq(schema.deals.businessId, businessId));

    // Evidence: facts and contacts cite sources, so sources go last of the three.
    await tx.delete(schema.businessFacts)
      .where(eq(schema.businessFacts.businessId, businessId));
    await tx.delete(schema.businessContacts)
      .where(eq(schema.businessContacts.businessId, businessId));
    await tx.delete(schema.businessSources)
      .where(eq(schema.businessSources.businessId, businessId));

    await tx.delete(schema.assets)
      .where(eq(schema.assets.businessId, businessId));
    await tx.delete(schema.websiteAudits)
      .where(eq(schema.websiteAudits.businessId, businessId));
    await tx.delete(schema.qualifications)
      .where(eq(schema.qualifications.businessId, businessId));
    await tx.delete(schema.productionGaps)
      .where(eq(schema.productionGaps.businessId, businessId));
    await tx.delete(schema.siteProjects)
      .where(eq(schema.siteProjects.businessId, businessId));
    await tx.delete(schema.enrichmentRuns)
      .where(eq(schema.enrichmentRuns.businessId, businessId));
    await tx.delete(schema.statusHistory)
      .where(eq(schema.statusHistory.businessId, businessId));

    // Attempts cite runs.
    await tx.delete(schema.workflowJobs)
      .where(eq(schema.workflowJobs.businessId, businessId));
    await tx.delete(schema.workflowJobRuns)
      .where(eq(schema.workflowJobRuns.businessId, businessId));

    await tx.delete(schema.businesses)
      .where(eq(schema.businesses.id, businessId));
  }
}
