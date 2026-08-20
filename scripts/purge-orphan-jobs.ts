/**
 * Remove queued pg-boss jobs whose business no longer exists.
 *
 * Test fixtures (phase E, phase C, the integration smoke) delete their rows
 * when they finish, but jobs those runs had already scheduled — chiefly
 * `send-followup`, which is scheduled +3/+7 days at send time — stay in
 * pg-boss and later fail against a missing business. They are harmless (a send
 * is impossible without an approvals row, and the fixtures' approvals are gone
 * too), but they turn the job list into noise and hide real failures.
 *
 * Only jobs carrying a `businessId` that has NO row in `businesses` are
 * removed. Anything referencing a live business is left alone.
 *
 *   pnpm tsx scripts/purge-orphan-jobs.ts            # dry run
 *   pnpm tsx scripts/purge-orphan-jobs.ts --apply
 */
import 'dotenv/config';
import { pool } from '../src/db/client.js';

const APPLY = process.argv.includes('--apply');

const WHERE = `
     j.state in ('created', 'retry')
     and j.data ? 'businessId'
     and j.data->>'businessId' is not null
     and not exists (
       select 1 from businesses b where b.id = j.data->>'businessId')`;

const { rows } = await pool.query<{ name: string; n: string }>(
  `select j.name, count(*)::text as n from pgboss.job j where ${WHERE}
    group by j.name order by count(*) desc`,
);

if (!rows.length) {
  console.log('no orphan jobs: every queued job points at a business that exists');
} else {
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  console.log(`${total} orphan job(s) queued for deleted businesses:`);
  rows.forEach((r) => console.log(`  ${String(r.n).padStart(4)}  ${r.name}`));

  if (!APPLY) {
    console.log('\ndry run — pass --apply to delete them');
  } else {
    const del = await pool.query(`delete from pgboss.job j where ${WHERE}`);
    console.log(`\n✅ deleted ${del.rowCount} orphan job(s)`);
  }
}

await pool.end();
