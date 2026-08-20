/**
 * Phase B debug: run ONE stage for ONE business synchronously (no queue),
 * so a prompt/parse problem is visible immediately instead of via job retries.
 * Usage: pnpm tsx scripts/phaseB-try-one.ts <stage> <businessId>
 */
import { enrichHandler } from '../src/workers/enrich.js';
import { collectAssetsHandler } from '../src/workers/assets.js';
import { auditHandler } from '../src/workers/audit.js';
import { scoreAndQaHandler } from '../src/workers/score.js';
import { readinessHandler } from '../src/workers/readiness.js';
import { fastQualifyHandler } from '../src/workers/fastQualify.js';
import { ensureBuckets } from '../src/lib/storage.js';

const stage = process.argv[2];
const businessId = process.argv[3];
const handlers: Record<string, (p: { businessId: string; campaignId?: string }) => Promise<void>> = {
  'fast-qualify': fastQualifyHandler,
  enrich: enrichHandler,
  assets: collectAssetsHandler,
  audit: auditHandler,
  score: scoreAndQaHandler,
  readiness: readinessHandler,
};
const h = handlers[stage];
if (!h || !businessId) {
  console.error(`usage: pnpm tsx scripts/phaseB-try-one.ts <${Object.keys(handlers).join('|')}> <businessId>`);
  process.exit(1);
}
await ensureBuckets();
const t0 = Date.now();
await h({ businessId });
console.log(`\n${stage} finished for ${businessId} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
