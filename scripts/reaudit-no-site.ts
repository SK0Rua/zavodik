/**
 * Re-audit every business whose latest verdict says "no site of their own".
 *
 * Why (Roman, 2026-08-20): the old audit measured pages at `domcontentloaded`
 * + 2.5s and called anything thin `broken`, so every JS-heavy site in the
 * campaign is under suspicion of the TRENDY HAIR misclassification. `broken`
 * and `no_website` are exactly the verdicts that feed the build policy, so a
 * wrong one there costs a demo build.
 *
 * Only businesses that HAVE a `website_url` are re-audited: a business with no
 * URL at all has nothing new for the fixed renderer to see.
 *
 *   pnpm tsx scripts/reaudit-no-site.ts            # list
 *   pnpm tsx scripts/reaudit-no-site.ts --apply    # enqueue
 */
import 'dotenv/config';
import { pool } from '../src/db/client.js';
import { enqueue } from '../src/orchestrator/queue.js';

const APPLY = process.argv.includes('--apply');

const { rows } = await pool.query<{
  id: string; campaign_id: string; status: string; domain: string | null; verdict: string;
}>(`
  with latest as (
    select distinct on (business_id) business_id, verdict
      from website_audits order by business_id, audited_at desc
  )
  select b.id, b.campaign_id, b.status, b.domain, l.verdict
    from businesses b join latest l on l.business_id = b.id
   where b.website_url is not null
     and l.verdict in ('broken', 'no_website')
   order by l.verdict, b.id`);

console.log(`${rows.length} business(es) to re-audit:`);
for (const r of rows) {
  console.log(`  · ${r.id.padEnd(58)} ${r.verdict.padEnd(11)} domain=${r.domain ?? '-'}`);
}

if (!APPLY) {
  console.log('\nlist only — pass --apply to enqueue audit-website');
  process.exit(0);
}

for (const r of rows) {
  // A fresh idempotency key per run: re-auditing is the point, and the default
  // key would dedupe this against the August audit and enqueue nothing.
  await enqueue('audit-website', {
    businessId: r.id,
    campaignId: r.campaign_id,
    idempotencyKey: `audit-website:${r.id}:reaudit-2026-08-20`,
  });
}
console.log(`\nenqueued ${rows.length} audit-website jobs`);
process.exit(0);
