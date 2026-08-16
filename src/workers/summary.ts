/**
 * Daily operations summary to Telegram: funnel counts, open reviews, failures.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifyTelegram } from '../telegram/notify.js';
import type { JobPayload } from '../orchestrator/queue.js';

export async function dailySummaryHandler(_payload: JobPayload): Promise<void> {
  const statusRows = await db.execute(sql`select status, count(*)::int as n from businesses group by status order by n desc`);
  const jobFails = await db.execute(sql`select job_type, count(*)::int as n from workflow_jobs where status in ('failed','needs_human') and created_at > now() - interval '1 day' group by job_type`);
  const sends = await db.execute(sql`select state, count(*)::int as n from outreach_messages where sent_at > now() - interval '1 day' group by state`);

  const lines = [
    '📊 <b>Daily factory summary</b>',
    '',
    '<b>Funnel:</b>',
    ...(statusRows.rows as any[]).map((r) => `  ${r.status}: ${r.n}`),
  ];
  if ((jobFails.rows as any[]).length) {
    lines.push('', '<b>Failures (24h):</b>', ...(jobFails.rows as any[]).map((r) => `  ${r.job_type}: ${r.n}`));
  }
  if ((sends.rows as any[]).length) {
    lines.push('', '<b>Outreach (24h):</b>', ...(sends.rows as any[]).map((r) => `  ${r.state}: ${r.n}`));
  }
  await notifyTelegram(lines.join('\n'));
}
