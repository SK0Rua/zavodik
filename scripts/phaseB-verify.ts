/**
 * Phase B verification: the evidence-integrity and stage-coverage report for a
 * finished run. Everything here is a SQL question about what actually landed in
 * the database — no worker code is involved.
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';

const campaignId = process.argv[2] ?? 'gr-patras-beauty';
const q = async (label: string, statement: ReturnType<typeof sql>) => {
  const res = await db.execute(statement);
  console.log(`\n### ${label}`);
  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? (res as unknown as Record<string, unknown>[]);
  if (!rows.length) { console.log('  (none)'); return rows; }
  const cols = Object.keys(rows[0]);
  const width: Record<string, number> = {};
  for (const c of cols) width[c] = Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length));
  console.log('  ' + cols.map((c) => c.padEnd(width[c])).join('  '));
  console.log('  ' + cols.map((c) => '-'.repeat(width[c])).join('  '));
  for (const r of rows) console.log('  ' + cols.map((c) => String(r[c] ?? '').padEnd(width[c])).join('  '));
  return rows;
};

console.log(`=== PHASE B VERIFICATION — campaign ${campaignId} ===`);

await q('1. final business status distribution', sql`
  select status, count(*)::int as n, round(avg(score)::numeric, 1) as avg_score
  from businesses where campaign_id = ${campaignId}
  group by status order by n desc`);

await q('2. INVARIANT: facts without a source_id (must be 0)', sql`
  select count(*)::int as facts_without_source
  from business_facts f join businesses b on b.id = f.business_id
  where b.campaign_id = ${campaignId} and f.source_id is null`);

await q('3. INVARIANT: contacts without a source_id (must be 0)', sql`
  select count(*)::int as contacts_without_source
  from business_contacts c join businesses b on b.id = c.business_id
  where b.campaign_id = ${campaignId} and c.source_id is null`);

await q('4. INVARIANT: assets not marked private_demo_only (must be 0)', sql`
  select count(*)::int as bad_rights
  from assets a join businesses b on b.id = a.business_id
  where b.campaign_id = ${campaignId} and a.rights <> 'private_demo_only'`);

await q('5. evidence volume per stage', sql`
  select 'facts' as kind, count(*)::int as rows, count(distinct business_id)::int as businesses
    from business_facts where business_id in (select id from businesses where campaign_id = ${campaignId})
  union all select 'contacts', count(*)::int, count(distinct business_id)::int
    from business_contacts where business_id in (select id from businesses where campaign_id = ${campaignId})
  union all select 'assets', count(*)::int, count(distinct business_id)::int
    from assets where business_id in (select id from businesses where campaign_id = ${campaignId})
  union all select 'audits', count(*)::int, count(distinct business_id)::int
    from website_audits where business_id in (select id from businesses where campaign_id = ${campaignId})
  union all select 'sources', count(*)::int, count(distinct business_id)::int
    from business_sources where business_id in (select id from businesses where campaign_id = ${campaignId})`);

await q('6. fact keys by extraction method', sql`
  select f.extraction_method, count(*)::int as n, count(distinct f.business_id)::int as businesses
  from business_facts f join businesses b on b.id = f.business_id
  where b.campaign_id = ${campaignId} group by 1 order by 2 desc`);

await q('7. website audit verdict distribution', sql`
  select verdict, count(*)::int as n,
         count(desktop_screenshot_key)::int as with_desktop_shot,
         count(mobile_screenshot_key)::int as with_mobile_shot
  from website_audits w join businesses b on b.id = w.business_id
  where b.campaign_id = ${campaignId} group by verdict order by n desc`);

await q('8. MESSENGERS + channels detected', sql`
  select c.channel, count(*)::int as rows, count(distinct c.business_id)::int as businesses
  from business_contacts c join businesses b on b.id = c.business_id
  where b.campaign_id = ${campaignId} group by 1 order by 3 desc`);

await q('9. production_ready businesses', sql`
  select id, score, rating, review_count
  from businesses where campaign_id = ${campaignId} and status = 'production_ready'
  order by score desc nulls last`);

await q('10. gap histogram (unresolved hard gates)', sql`
  select g.gap, count(distinct g.business_id)::int as businesses
  from production_gaps g join businesses b on b.id = g.business_id
  where b.campaign_id = ${campaignId} and g.resolved = false and g.blocker_level = 'hard'
  group by 1 order by 2 desc`);

await q('11. independent QA outcomes', sql`
  select case when qa_passed is null then 'unavailable' when qa_passed then 'passed' else 'FAILED' end as qa,
         count(*)::int as n
  from qualifications q join businesses b on b.id = q.business_id
  where b.campaign_id = ${campaignId} and q.stage = 'full' group by 1 order by 2 desc`);

await q('12. job outcomes', sql`
  select job_type, status, count(*)::int as n
  from workflow_jobs where campaign_id = ${campaignId}
  group by 1, 2 order by 1, 3 desc`);

await q('13. jobs needing attention (failed / needs_human / retry_wait)', sql`
  select job_type, status, business_id, error_code, left(coalesce(error_detail, ''), 90) as detail
  from workflow_jobs where campaign_id = ${campaignId}
    and status in ('failed', 'needs_human', 'retry_wait')
  order by job_type limit 25`);

await q('14. per-business evidence counts (top 15 by score)', sql`
  select b.id, b.status, b.score,
    (select count(*)::int from business_facts f where f.business_id = b.id) as facts,
    (select count(*)::int from business_facts f where f.business_id = b.id and f.key = 'service') as services,
    (select count(*)::int from business_contacts c where c.business_id = b.id) as contacts,
    (select count(*)::int from assets a where a.business_id = b.id) as assets,
    (select verdict from website_audits w where w.business_id = b.id order by audited_at desc limit 1) as verdict
  from businesses b where b.campaign_id = ${campaignId}
  order by b.score desc nulls last limit 15`);

await q('15. INVARIANT: no AI-generated media counted as real business photos', sql`
  select count(*)::int as ai_assets
  from assets a join businesses b on b.id = a.business_id
  where b.campaign_id = ${campaignId} and a.ai_generated = true`);

await q('16. sources by capture method (immutable evidence trail)', sql`
  select method, source_type, count(*)::int as n
  from business_sources s join businesses b on b.id = s.business_id
  where b.campaign_id = ${campaignId}
  group by 1, 2 order by 3 desc`);

process.exit(0);
