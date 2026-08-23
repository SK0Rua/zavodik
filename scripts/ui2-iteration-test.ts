/**
 * Exercise «Ще ітерація» on M.K through the real UI and prove it enqueues
 * EXACTLY ONE build-site job. Then put everything back: the job is cancelled and
 * the project returned to needs_human_review, because Roman — not this test —
 * decides what happens to that build.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = '/Users/romankudin/Developer/websites-factory';
const BASE = 'http://localhost:3000';
const PROJECT_ID = 7;
const BUSINESS_ID = 'gr-patras-m-k-hair-studio-mykoniatis-konstantinos';
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const PASSWORD = /^UI_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';

function psql(sql: string): string {
  return execSync(
    `docker compose exec -T postgres psql -U factory -d factory -tAc ${JSON.stringify(sql)}`,
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
}

async function main() {
  const before = psql(
    `select count(*) from workflow_jobs where job_type='build-site' and idempotency_key like '%:roman:%'`,
  );
  const stateBefore = psql(`select state, qa_iterations from site_projects where id=${PROJECT_ID}`);
  // The action under test now ALSO transitions the business (needs_review →
  // site_in_progress, new status_reason), so the business must be captured and
  // restored the same way the project is — otherwise every run of this test
  // leaves a real business permanently «Будуємо демо» with no build running.
  // Two separate reads, not one piped string: a QA status_reason contains «|»
  // itself («risk=low | provenanceOk=true | …»), so any delimiter would lie.
  const bizStatusBefore = psql(`select status from businesses where id='${BUSINESS_ID}'`);
  const bizReasonBefore = psql(`select coalesce(status_reason, '') from businesses where id='${BUSINESS_ID}'`);
  console.log('BEFORE  roman-triggered build jobs:', before, '| project:', stateBefore,
    '| business:', bizStatusBefore, bizReasonBefore);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } } as never);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'));

  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await page.click('text=Ще ітерація');
  await page.fill('textarea', 'ТЕСТ: не виконувати. Перевірка, що кнопка ставить рівно одну задачу.');
  await page.click('text=Запустити ітерацію');
  await page.waitForTimeout(6000);

  const banner = await page.locator('[role="status"]').first().textContent().catch(() => null);
  console.log('UI said:', banner?.trim());
  await page.screenshot({ path: path.join(ROOT, 'docs/evidence/ui2-iteration-queued.png') });
  await browser.close();

  const after = psql(
    `select count(*) from workflow_jobs where job_type='build-site' and idempotency_key like '%:roman:%'`,
  );
  const stateAfter = psql(`select state, qa_iterations from site_projects where id=${PROJECT_ID}`);
  console.log('AFTER   roman-triggered build jobs:', after, '| project:', stateAfter);
  console.log('DELTA:', Number(after) - Number(before), '(must be exactly 1)');

  // ── put it back ───────────────────────────────────────────────────────────
  // Cancel the queued job in pg-boss AND in the mirror table, then restore the
  // project. Roman decides the real fate of this build, not a verification run.
  psql(`update pgboss.job set state='cancelled' where name='build-site' and state in ('created','retry','active')`);
  psql(`update workflow_jobs set status='cancelled' where job_type='build-site' and idempotency_key like '%:roman:%' and status='queued'`);
  psql(`update site_projects set state='needs_human_review', qa_iterations=3 where id=${PROJECT_ID}`);
  psql(
    `update businesses set status='${bizStatusBefore}', `
    + `status_reason=${bizReasonBefore ? `'${bizReasonBefore.replace(/'/g, "''")}'` : 'null'} `
    + `where id='${BUSINESS_ID}'`,
  );
  psql(`delete from status_history where business_id='${BUSINESS_ID}' and reason like 'Роман замовив ще одну ітерацію: ТЕСТ%'`);
  console.log('RESTORED project:', psql(`select state, qa_iterations from site_projects where id=${PROJECT_ID}`));
  console.log('RESTORED business:',
    psql(`select status from businesses where id='${BUSINESS_ID}'`),
    psql(`select coalesce(status_reason, '') from businesses where id='${BUSINESS_ID}'`));
  console.log('leftover active build-site jobs:',
    psql(`select count(*) from pgboss.job where name='build-site' and state in ('created','retry','active')`));
}
main();
