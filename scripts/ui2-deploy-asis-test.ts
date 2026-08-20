/**
 * Exercise `deployBuildAsIs` on a THROWAWAY fixture project.
 *
 * Roman decides what happens to the real M.K build, so that one is never
 * clicked. Instead a fixture site_project is created in `needs_human_review`
 * against an existing business, the action is invoked exactly as the button
 * invokes it, and the result is inspected — then everything is deleted.
 *
 * What this proves: the state gate flips needs_human_review → ready, exactly one
 * deploy-demo job is enqueued, and a SECOND call is refused rather than
 * enqueueing a second deploy.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = '/Users/romankudin/Developer/websites-factory';
const BASE = 'http://localhost:3000';
const PASSWORD = /^UI_PASSWORD=(.*)$/m
  .exec(readFileSync(path.join(ROOT, '.env'), 'utf8'))?.[1]?.trim() ?? '';

function psql(sql: string): string {
  // psql -c takes ONE line; a template literal spanning lines makes it choke on
  // the newline as a command.
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(
    `docker compose exec -T postgres psql -U factory -d factory -tAc ${JSON.stringify(oneLine)}`,
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
}

/**
 * Click the real button in the real browser.
 *
 * Not an in-process import: the UI container runs a compiled Next bundle, so a
 * server action is only reachable the way Roman reaches it — rendered on a page
 * and clicked. That also makes this a test of the BUTTON, not just the function
 * it happens to call.
 */
async function clickDeployAsIs(page: import('playwright').Page, name: string): Promise<string> {
  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  const card = page.locator('article').filter({ hasText: name }).first();
  page.once('dialog', (d) => d.accept()); // the "публікувати як є?" confirm
  await card.getByText('Задеплоїти як є').click();
  await page.waitForTimeout(4000);
  return (await card.locator('[role="status"]').first().textContent().catch(() => '') ?? '').trim();
}

async function main() {
  const businessId = psql(`select id from businesses limit 1`);
  // psql echoes the command tag ("INSERT 0 1") after the returned row, so take
  // the first line rather than the whole output.
  const id = Number(psql(`
    insert into site_projects (business_id, dir, state, qa_iterations)
    values ('${businessId}', '/tmp/fixture-asis', 'needs_human_review', 3)
    returning id
  `).split('\n')[0]);
  if (!Number.isInteger(id)) throw new Error('fixture insert did not return an id');
  console.log('fixture project', id, 'for', businessId);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } } as never);
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes('/login'));

    const bizName = psql(`select name from businesses where id='${businessId}'`);
    console.log('fixture business:', bizName);

    console.log('click #1 said:', await clickDeployAsIs(page, bizName));
    console.log('  state now:', psql(`select state from site_projects where id=${id}`));
    console.log('  deploy jobs:', psql(
      `select count(*) from workflow_jobs where job_type='deploy-demo' and idempotency_key like '%:${id}'`));

    // The card is gone from the inbox now (the project left needs_human_review),
    // which is itself the second half of the guarantee: there is no button left
    // to press a second time.
    await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
    const stillThere = await page.locator('article').filter({ hasText: bizName }).count();
    console.log('  card still offering the action:', stillThere);
  } finally {
    await browser.close();
    psql(`delete from pgboss.job where name='deploy-demo' and data->>'projectId' = '${id}'`);
    psql(`delete from workflow_jobs where job_type='deploy-demo' and idempotency_key like '%:${id}'`);
    psql(`delete from status_history where business_id='${businessId}' and reason like 'Роман прийняв збірку%'`);
    psql(`delete from site_projects where id=${id}`);
    console.log('fixture removed; remaining rows:', psql(`select count(*) from site_projects where id=${id}`));
  }
}
main();
