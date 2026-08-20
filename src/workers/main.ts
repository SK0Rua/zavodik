/**
 * Worker registry: binds job types to handlers, in GROUPS.
 *
 * Why groups (SPEC §2.3(а), Roman's decision 2026-08-16): `AGENT_CONCURRENCY` +
 * `withAgentSlot` is a single FIFO queue **per process**. When one process hosts
 * every job type, a 40-minute `build-site` session and a large `enrich` backlog
 * starve each other — observed for real: a build sat 50 minutes behind 126 queued
 * enrich jobs. Splitting job types across processes gives each its own semaphore,
 * which is process topology, not an architectural change.
 *
 *   pnpm workers                      # all groups (single-process dev, default)
 *   pnpm workers --only=core,enrich   # the "factory" container
 *   pnpm workers --only=build         # the "factory-build" container
 *   WORKER_GROUPS=build pnpm workers  # same, via env (docker-compose)
 *
 * Per-group agent concurrency: `AGENT_CONCURRENCY_BUILD` / `AGENT_CONCURRENCY_ENRICH`
 * override `AGENT_CONCURRENCY` when the process runs exactly that group.
 */
import { register, getBoss, type JobName } from '../orchestrator/queue.js';
import { reconcileOnStartup } from '../orchestrator/reconcile.js';
import { ensureBuckets } from '../lib/storage.js';
import { discoverHandler } from './discovery.js';
import { normalizeHandler } from './normalize.js';
import { fastQualifyHandler } from './fastQualify.js';
import { enrichHandler } from './enrich.js';
import { enrichSocialsHandler } from './enrichSocials.js';
import { collectAssetsHandler } from './assets.js';
import { refreshBrandHandler } from './refreshBrand.js';
import { auditHandler } from './audit.js';
import { scoreAndQaHandler } from './score.js';
import { readinessHandler } from './readiness.js';
import { contentDesignHandler } from './contentDesign.js';
import { buildSiteHandler } from './builder.js';
import { visualQaHandler } from './visualQa.js';
import { deployHandler } from './deploy.js';
import { requestApprovalHandler } from './approval.js';
import { sendOutreachHandler, sendFollowupHandler } from './outreach.js';
import { pollRepliesHandler } from './replies.js';
import { dailySummaryHandler } from './summary.js';
import { setAgentConcurrency } from '../agents/semaphore.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export type WorkerGroup = 'core' | 'enrich' | 'build';

export const WORKER_GROUPS: Record<WorkerGroup, JobName[]> = {
  /** Deterministic + light-agent stages, plus the schedules and the outreach path. */
  core: [
    'discover', 'normalize', 'fast-qualify', 'collect-assets', 'audit-website',
    'readiness-gate', 'deploy-demo', 'request-approval',
    'send-outreach', 'send-followup', 'poll-replies', 'daily-summary',
  ],
  /**
   * Evidence extraction: many medium-length agent calls, plus `enrich-socials`,
   * which is agent-free but Playwright-bound — these containers already run the
   * browser, and it must not sit behind a 40-minute build session.
   */
  enrich: ['enrich', 'enrich-socials', 'refresh-brand', 'score-and-qa'],
  /** Site production: few very long agent sessions (a build can run 40+ min). */
  build: ['content-and-design', 'build-site', 'visual-qa'],
};

const HANDLERS: Record<JobName, Parameters<typeof register>[1]> = {
  'discover': discoverHandler,
  'normalize': normalizeHandler,
  'fast-qualify': fastQualifyHandler,
  'enrich': enrichHandler,
  'enrich-socials': enrichSocialsHandler,
  'collect-assets': collectAssetsHandler,
  'refresh-brand': refreshBrandHandler,
  'audit-website': auditHandler,
  'score-and-qa': scoreAndQaHandler,
  'readiness-gate': readinessHandler,
  'content-and-design': contentDesignHandler,
  'build-site': buildSiteHandler,
  'visual-qa': visualQaHandler,
  'deploy-demo': deployHandler,
  'request-approval': requestApprovalHandler,
  'send-outreach': sendOutreachHandler,
  'send-followup': sendFollowupHandler,
  'poll-replies': pollRepliesHandler,
  'daily-summary': dailySummaryHandler,
};

/** Only the `core` process owns the cron schedules; two would double-fire them. */
const SCHEDULE_GROUP: WorkerGroup = 'core';

/**
 * Groups this process should host. Precedence: explicit argument, then
 * `--only=` on the command line, then `WORKER_GROUPS` env, then all groups.
 */
export function resolveGroups(explicit?: WorkerGroup[]): WorkerGroup[] {
  if (explicit?.length) return explicit;

  const argv = process.argv.slice(2);
  const flag = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
    ?? (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined)
    ?? process.env.WORKER_GROUPS;

  if (!flag || !flag.trim()) return Object.keys(WORKER_GROUPS) as WorkerGroup[];

  const requested = flag.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = requested.filter((g): g is WorkerGroup => g in WORKER_GROUPS);
  const unknown = requested.filter((g) => !(g in WORKER_GROUPS));
  if (unknown.length) {
    throw new Error(
      `unknown worker group(s): ${unknown.join(', ')}. Valid: ${Object.keys(WORKER_GROUPS).join(', ')}`,
    );
  }
  return valid;
}

/**
 * A process hosting exactly one agent-heavy group may use that group's own
 * concurrency. Mixed processes fall back to the global value, because the whole
 * point of the split is that groups no longer share a slot.
 */
function concurrencyFor(groups: WorkerGroup[]): number {
  if (groups.length === 1 && groups[0] === 'build') return config.agents.concurrencyBuild;
  if (groups.length === 1 && groups[0] === 'enrich') return config.agents.concurrencyEnrich;
  return config.agents.concurrency;
}

export async function startWorkers(explicit?: WorkerGroup[]): Promise<void> {
  await ensureBuckets();

  const groups = resolveGroups(explicit);

  /**
   * Close out work stranded by the previous process BEFORE any handler is
   * registered — otherwise a job picked up in the first second would race the
   * reconciler and could be marked `stale` while it is genuinely running.
   *
   * Only the schedule-owning group does it, for the same reason it owns the
   * schedules: `factory` and `factory-build` boot together, and two concurrent
   * reconcilers would each try to revert the same business. The pass is
   * idempotent anyway, but one writer keeps `status_history` free of duplicate
   * recovery rows.
   */
  if (groups.includes(SCHEDULE_GROUP)) await reconcileOnStartup();

  const concurrency = concurrencyFor(groups);
  setAgentConcurrency(concurrency);

  const registered: JobName[] = [];
  for (const group of groups) {
    for (const jobName of WORKER_GROUPS[group]) {
      await register(jobName, HANDLERS[jobName]);
      registered.push(jobName);
    }
  }

  if (groups.includes(SCHEDULE_GROUP)) {
    const boss = await getBoss();
    await boss.schedule('poll-replies', '*/10 * * * *', {}, {});
    await boss.schedule('daily-summary', '0 8 * * *', {}, {});
  }

  log.info('workers registered', {
    groups, jobs: registered.length, agentConcurrency: concurrency,
    schedules: groups.includes(SCHEDULE_GROUP),
  });
}

// standalone mode (`pnpm workers`, i.e. the factory-build container)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Settings first: concurrencyFor() below reads them, and a worker started
  // with a cold snapshot would use the .env fallback for a value Roman
  // changed in the UI. Then a 30s heartbeat so the console can see this
  // process is alive (src/lib/settingsStore.ts).
  (async () => {
    const { initSettings, startHeartbeat } = await import('../lib/settingsStore.js');
    await initSettings();
    await startWorkers();
    startHeartbeat(process.env.WORKER_GROUPS ?? 'workers', () => ({
      groups: process.env.WORKER_GROUPS ?? 'all',
    }));
  })().catch((err) => { console.error(err); process.exit(1); });
}
