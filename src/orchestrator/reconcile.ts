/**
 * Startup reconciliation: make the DB agree with reality again.
 *
 * `workflow_jobs` is a MIRROR of pg-boss, written by `queue.ts` around the
 * handler. That mirror is only ever advanced by a running handler, so any way a
 * worker process can die without unwinding — SIGKILL, container recreate, an
 * OOM, a crash inside pg-boss itself — leaves a row frozen at `queued` or
 * `running` forever. pg-boss then archives and eventually PURGES its own job,
 * and the mirror row is left pointing at a job that no longer exists anywhere.
 *
 * Observed on 2026-08-20 (audit P0-3): 88 rows — 84 `queued`, 4 `running`,
 * untouched since 2026-08-16 — with ZERO matching rows in `pgboss.job` or
 * `pgboss.archive`. The queue drains new work fine; the backlog was simply
 * never recoverable, and nothing in the product ever said so.
 *
 * The knock-on (audit P0-2) is worse than a wrong number: five businesses sat
 * in `site_in_progress` for 3.5 days with no `site_projects` row and no job,
 * while their card told Roman «Фабрика будує демосайт. Це займає 10–30 хвилин.»
 * A transient status is a CLAIM that something is running. When nothing is,
 * the claim has to be retracted.
 *
 * So this runs once at worker boot, before any handler is registered, and does
 * exactly two things:
 *
 *   1. every mirror row in `queued`/`running` whose pg-boss job is gone,
 *      completed, failed or cancelled becomes `stale`, with the reason on the
 *      row. `stale` is a TERMINAL bookkeeping status: it says "this row is not
 *      the truth about anything", not "this failed" — the work may well have
 *      been done by a later run.
 *   2. every business in a transient status with no live job and no artefact
 *      to show for it is reverted to its last stable status from
 *      `status_history`, actor `reconciler`.
 *
 * What it deliberately does NOT do: re-enqueue. Restarting 84 jobs unattended
 * would burn the subscription window on work Roman may no longer want, and the
 * decision of what to re-run is his — from the card or from Налаштування.
 *
 * That choice is also what makes reconciliation SAFE TO NOTIFY AROUND, which
 * matters more than it looks. Several job types send Telegram on completion
 * (`daily-summary`, and the problem/pause pushes in `queue.ts`), and a
 * reconciler that "recovered" stranded work by re-running it would re-fire
 * every one of those — days-old notifications arriving in a burst on Roman's
 * phone, describing work he already saw. This module imports no notification
 * code at all and only ever writes rows, so a `stale` row is silent by
 * construction: it ends a job's life, it does not restart it.
 *
 * The corollary for anyone adding a re-enqueue here later: the payload is NOT
 * persisted (`workflow_jobs` has no payload column), so a re-enqueued job
 * cannot carry forward a suppression flag such as `daily-summary`'s
 * `silent: true`. Any such flag must be derivable from a column that IS stored
 * — `idempotency_key` is the one the summary worker uses.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';

/**
 * Mirror statuses that assert "pg-boss is holding this right now".
 * `retry_wait` is NOT here: it is parked by us, deliberately, with a
 * re-enqueue already made under the same idempotency key (SPEC §2.3б).
 */
const LIVE_MIRROR_STATUSES = ['queued', 'running'] as const;

/**
 * pg-boss states that still mean "this job will run": anything else (or no row
 * at all, once retention purged it) means the mirror row is lying.
 */
const LIVE_BOSS_STATES = ['created', 'retry', 'active'] as const;

/**
 * Business statuses that promise ongoing work, mapped to the artefact that
 * would prove the work actually landed. A business here with neither a live
 * job nor its artefact is stranded.
 */
const TRANSIENT_STATUSES = ['enriching', 'site_in_progress'] as const;

/**
 * Statuses a stranded business may be reverted TO. `status_history` also holds
 * the transient ones we are reverting from, and re-entering one of those would
 * just recreate the problem one row further back.
 */
const STABLE_STATUSES = [
  'discovered', 'prequalified', 'needs_review', 'qualified',
  'production_ready', 'site_ready', 'rejected', 'duplicate', 'closed', 'do_not_contact',
];

export interface ReconcileReport {
  staleJobs: number;
  revertedBusinesses: Array<{ businessId: string; from: string; to: string }>;
  /** Build projects whose worker died mid-flight; the card now offers a restart. */
  interruptedBuilds: Array<{ businessId: string; projectId: number }>;
}

/**
 * Mirror rows claiming to be live while pg-boss has no live job for them.
 *
 * The check is deliberately by ABSENCE of a live boss row rather than by age:
 * a 40-minute `build-site` session is legitimately `running` and must survive
 * a reconcile that happens to fire next to it, while a 10-second `normalize`
 * whose process died is stale immediately. Rows with `boss_job_id IS NULL`
 * never reached pg-boss at all and are stale by definition.
 *
 * That distinction is load-bearing across CONTAINERS, not just within one.
 * `factory` (core,enrich) and `factory-build` (build) are separate processes
 * with separate lifecycles, so restarting `factory` alone runs this pass while
 * a real 40-minute build is mid-flight in the other container. It survives
 * because pg-boss holds that job in `active` for the duration — the state, not
 * a timer, is what says it is alive. Verified against a live `content-and-design`
 * run on 2026-08-20, and pinned by `scripts/test-reconcile.ts`.
 */
async function markStaleJobs(): Promise<number> {
  const rows = await db.execute(sql`
    update workflow_jobs w set
      status = 'stale',
      error_code = coalesce(w.error_code, 'STALE'),
      error_detail = coalesce(
        w.error_detail,
        'Робітник перезапустився, поки задача була в черзі — pg-boss її вже не тримає. '
        || 'Задачу не втрачено назавжди: її можна перезапустити вручну.'
      ),
      finished_at = coalesce(w.finished_at, now())
    where w.status in (${sql.join(LIVE_MIRROR_STATUSES.map((s) => sql`${s}`), sql`, `)})
      and not exists (
        select 1 from pgboss.job j
        where j.id::text = w.boss_job_id
          and j.state::text in (${sql.join(LIVE_BOSS_STATES.map((s) => sql`${s}`), sql`, `)})
      )
    returning w.id
  `);
  return rows.rows.length;
}

/** The most recent status in `status_history` that is not itself transient. */
async function lastStableStatus(businessId: string): Promise<string | null> {
  const [row] = await db.select({ to: schema.statusHistory.toStatus })
    .from(schema.statusHistory)
    .where(and(
      eq(schema.statusHistory.businessId, businessId),
      inArray(schema.statusHistory.toStatus, STABLE_STATUSES),
    ))
    .orderBy(desc(schema.statusHistory.at))
    .limit(1);
  return row?.to ?? null;
}

/**
 * Businesses whose transient status no longer describes anything happening.
 *
 * Two independent proofs of life are accepted, and only both being absent makes
 * a business stranded:
 *   - a live mirror job of ANY type for it (checked AFTER markStaleJobs, so the
 *     ghosts have already stopped counting as live), or
 *   - for `site_in_progress`, a `site_projects` row: a build that produced a
 *     project is a real build, whatever the job table says, and reverting it
 *     would throw away the operator's view of a real artefact.
 */
async function revertStrandedBusinesses(): Promise<ReconcileReport['revertedBusinesses']> {
  const stranded = await db.execute(sql`
    select b.id, b.status
    from businesses b
    where b.status in (${sql.join(TRANSIENT_STATUSES.map((s) => sql`${s}`), sql`, `)})
      and not exists (
        select 1 from workflow_jobs w
        where w.business_id = b.id
          and w.status in ('queued', 'running', 'retry_wait')
      )
      and not exists (
        select 1 from site_projects p where p.business_id = b.id
      )
  `);

  const out: ReconcileReport['revertedBusinesses'] = [];
  for (const r of stranded.rows as Array<{ id: string; status: string }>) {
    // Fall back to `needs_review` rather than guessing: a business with no
    // stable history at all is exactly the case a human should look at, and
    // `needs_review` is the status the inbox already surfaces.
    const to = (await lastStableStatus(r.id)) ?? 'needs_review';
    if (to === r.status) continue;

    const reason = r.status === 'site_in_progress'
      ? 'Збірку демо перервано перезапуском фабрики: живої задачі й site_project немає. '
        + 'Статус повернуто, демо можна зібрати заново.'
      : 'Збір даних перервано перезапуском фабрики: живої задачі немає. '
        + 'Статус повернуто, крок можна перезапустити.';

    // Deliberately NOT via transition(): these are recovery moves that the
    // forward-only transition table has no edge for (site_in_progress ->
    // production_ready is a step BACK), and forcing them through with
    // force:true would log actor 'reconciler' making a legal-looking move.
    // Writing both rows here keeps businesses.status and status_history in
    // lockstep — the invariant the audit verified — and names the actor
    // honestly.
    await db.transaction(async (tx) => {
      await tx.update(schema.businesses)
        .set({ status: to, statusReason: reason, updatedAt: new Date() })
        .where(eq(schema.businesses.id, r.id));
      await tx.insert(schema.statusHistory).values({
        businessId: r.id, fromStatus: r.status, toStatus: to, reason, actor: 'reconciler',
      });
    });
    out.push({ businessId: r.id, from: r.status, to });
  }
  return out;
}

/**
 * Run both passes. Never throws: a database hiccup here must not stop the
 * workers from booting — the factory being up matters more than the ledger
 * being tidy, and the next boot will reconcile again.
 */
/**
 * Build projects frozen in a transient state with no live build-chain job.
 *
 * A container recreate mid-build leaves `site_projects.state = 'building'`
 * forever: the card then claims «Фабрика будує демосайт», hides the build
 * button, and the live panel shows a frozen log — with no way for Roman to
 * restart (observed on BEAUTIFY Laser, 2026-08-22, after a git-pull redeploy).
 * `failed` is the state the card already knows how to offer a restart for.
 */
async function failInterruptedBuilds(): Promise<ReconcileReport['interruptedBuilds']> {
  const rows = await db.execute(sql`
    update site_projects p set state = 'failed'
    where p.state in ('pending', 'brief', 'building', 'qa')
      and not exists (
        select 1 from workflow_jobs w
        where w.business_id = p.business_id
          and w.job_type in ('content-and-design', 'build-site', 'visual-qa', 'deploy-demo')
          and w.status in ('queued', 'running', 'retry_wait')
      )
    returning p.id, p.business_id
  `);
  return (rows.rows as Array<{ id: number; business_id: string }>).map((r) => ({
    businessId: r.business_id, projectId: r.id,
  }));
}

export async function reconcileOnStartup(): Promise<ReconcileReport> {
  const report: ReconcileReport = { staleJobs: 0, revertedBusinesses: [], interruptedBuilds: [] };
  try {
    report.staleJobs = await markStaleJobs();
    // AFTER markStaleJobs: a ghost job must not count as proof of a live build.
    report.interruptedBuilds = await failInterruptedBuilds();
    report.revertedBusinesses = await revertStrandedBusinesses();
    if (report.staleJobs || report.revertedBusinesses.length) {
      log.warn('startup reconciliation closed stranded work', {
        staleJobs: report.staleJobs,
        reverted: report.revertedBusinesses,
      });
    } else {
      log.info('startup reconciliation: nothing stranded');
    }
  } catch (err) {
    log.error('startup reconciliation failed', { err: String(err).slice(0, 500) });
  }
  return report;
}
