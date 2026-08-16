/**
 * Worker registry: binds every job type to its handler.
 * Run standalone (`pnpm workers`) or via `pnpm all`.
 */
import { register, getBoss } from '../orchestrator/queue.js';
import { ensureBuckets } from '../lib/storage.js';
import { discoverHandler } from './discovery.js';
import { normalizeHandler } from './normalize.js';
import { fastQualifyHandler } from './fastQualify.js';
import { enrichHandler } from './enrich.js';
import { collectAssetsHandler } from './assets.js';
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
import { log } from '../lib/logger.js';

export async function startWorkers(): Promise<void> {
  await ensureBuckets();

  await register('discover', discoverHandler);
  await register('normalize', normalizeHandler);
  await register('fast-qualify', fastQualifyHandler);
  await register('enrich', enrichHandler);
  await register('collect-assets', collectAssetsHandler);
  await register('audit-website', auditHandler);
  await register('score-and-qa', scoreAndQaHandler);
  await register('readiness-gate', readinessHandler);
  await register('content-and-design', contentDesignHandler);
  await register('build-site', buildSiteHandler);
  await register('visual-qa', visualQaHandler);
  await register('deploy-demo', deployHandler);
  await register('request-approval', requestApprovalHandler);
  await register('send-outreach', sendOutreachHandler);
  await register('send-followup', sendFollowupHandler);
  await register('poll-replies', pollRepliesHandler);
  await register('daily-summary', dailySummaryHandler);

  // schedules: replies every 10 min, summary daily 08:00
  const boss = await getBoss();
  await boss.schedule('poll-replies', '*/10 * * * *', {}, {});
  await boss.schedule('daily-summary', '0 8 * * *', {}, {});

  log.info('all workers registered');
}

// standalone mode
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkers().catch((err) => { console.error(err); process.exit(1); });
}
