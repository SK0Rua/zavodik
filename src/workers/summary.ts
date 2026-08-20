/**
 * Daily operations summary to Telegram: funnel counts, open reviews, failures.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifyDailySummary, stageLabel } from '../telegram/notify.js';
import type { JobPayload } from '../orchestrator/queue.js';

export async function dailySummaryHandler(payload: JobPayload): Promise<void> {
  // Test/verification runs (smoke.ts and friends) exercise the queue with this
  // job type. They must NEVER reach Roman's Telegram: only the pg-boss cron
  // schedule (no payload flags) sends for real.
  if (payload.silent === true || payload.idempotencyKey?.toString().startsWith('smoke-')) {
    return;
  }
  const statusRows = await db.execute(sql`select status, count(*)::int as n from businesses group by status order by n desc`);
  const jobFails = await db.execute(sql`select job_type, count(*)::int as n from workflow_jobs where status in ('failed','needs_human') and created_at > now() - interval '1 day' group by job_type`);
  const sends = await db.execute(sql`select state, count(*)::int as n from outreach_messages where sent_at > now() - interval '1 day' group by state`);

  const STATUS_UA: Record<string, string> = {
    discovered: 'знайдено', prequalified: 'відібрано', enriching: 'збираємо дані',
    needs_review: 'потрібна твоя увага', qualified: 'підходять', production_ready: 'готові до демо',
    site_in_progress: 'будуються демо', site_ready: 'демо чекають підтвердження',
    outreach_approved: 'підтверджено', contacted: 'написали', replied: 'відповіли',
    meeting: 'зустріч', proposal: 'пропозиція', won: 'виграно', lost: 'програно',
    rejected: 'відхилено', duplicate: 'дублікати', closed: 'закрито', do_not_contact: 'не контактувати',
  };
  const lines = [
    'Воронка:',
    ...(statusRows.rows as any[]).map((r) => `  ${STATUS_UA[r.status] ?? r.status}: ${r.n}`),
  ];
  if ((jobFails.rows as any[]).length) {
    lines.push('', 'Проблеми (24г):', ...(jobFails.rows as any[]).map((r) => `  ${stageLabel(r.job_type)}: ${r.n}`));
  }
  if ((sends.rows as any[]).length) {
    lines.push('', 'Outreach (24г):', ...(sends.rows as any[]).map((r) => `  ${r.state}: ${r.n}`));
  }
  await notifyDailySummary(lines);
}
