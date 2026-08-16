/**
 * Dashboard + JSON API + demo static server + WhatsApp webhook.
 * Dashboard: funnel, businesses, jobs, gaps, approvals; no build step, plain HTML.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { config } from '../config.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue } from '../orchestrator/queue.js';
import { recordReply } from '../workers/replies.js';
import { log } from '../lib/logger.js';

export function startApi(): void {
  const app = new Hono();

  app.get('/api/funnel', async (c) => {
    const rows = await db.execute(sql`select status, count(*)::int as n from businesses group by status`);
    return c.json(rows.rows);
  });

  app.get('/api/businesses', async (c) => {
    const rows = await db.select().from(schema.businesses).orderBy(desc(schema.businesses.updatedAt)).limit(500);
    return c.json(rows);
  });

  app.get('/api/business/:id', async (c) => {
    const id = c.req.param('id');
    const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, id));
    if (!biz) return c.json({ error: 'not found' }, 404);
    const facts = await db.select().from(schema.businessFacts).where(eq(schema.businessFacts.businessId, id));
    const contacts = await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, id));
    const audits = await db.select().from(schema.websiteAudits).where(eq(schema.websiteAudits.businessId, id));
    const gaps = await db.select().from(schema.productionGaps).where(eq(schema.productionGaps.businessId, id));
    const sites = await db.select().from(schema.siteProjects).where(eq(schema.siteProjects.businessId, id));
    const history = await db.select().from(schema.statusHistory).where(eq(schema.statusHistory.businessId, id));
    const messages = await db.select().from(schema.outreachMessages).where(eq(schema.outreachMessages.businessId, id));
    return c.json({ biz, facts, contacts, audits, gaps, sites, history, messages });
  });

  app.get('/api/jobs', async (c) => {
    const rows = await db.select().from(schema.workflowJobs).orderBy(desc(schema.workflowJobs.createdAt)).limit(300);
    return c.json(rows);
  });

  // manual actions from dashboard
  app.post('/api/business/:id/transition', async (c) => {
    const { to, reason } = await c.req.json();
    await transition(c.req.param('id'), to, 'roman', reason, { force: true });
    return c.json({ ok: true });
  });
  app.post('/api/business/:id/enqueue', async (c) => {
    const { job } = await c.req.json();
    const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, c.req.param('id')));
    if (!biz) return c.json({ error: 'not found' }, 404);
    await enqueue(job, { businessId: biz.id, campaignId: biz.campaignId, idempotencyKey: `${job}:${biz.id}:${Date.now()}` });
    return c.json({ ok: true });
  });

  // WhatsApp Cloud API webhook (replies)
  app.get('/webhooks/whatsapp', (c) => {
    const challenge = c.req.query('hub.challenge');
    return c.text(challenge ?? 'ok');
  });
  app.post('/webhooks/whatsapp', async (c) => {
    const body = await c.req.json().catch(() => null) as any;
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.from) {
      const from = String(msg.from).replace(/[^\d]/g, '');
      const sent = await db.select().from(schema.outreachMessages).where(eq(schema.outreachMessages.channel, 'whatsapp'));
      const match = sent.find((m) => m.toAddress.replace(/[^\d]/g, '') === from);
      if (match) await recordReply(match.businessId, 'whatsapp', { preview: msg.text?.body ?? '' });
    }
    return c.json({ ok: true });
  });

  // minimal HTML dashboard
  app.get('/', (c) => c.html(DASHBOARD_HTML));

  serve({ fetch: app.fetch, port: config.dashboardPort });
  log.info('dashboard up', { port: config.dashboardPort });

  // demo static server with noindex
  const demo = new Hono();
  demo.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); });
  demo.use('/*', serveStatic({ root: './deploys' }));
  serve({ fetch: demo.fetch, port: config.demoPort });
  log.info('demo server up', { port: config.demoPort });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><title>Websites Factory</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui; background:#0d1117; color:#e6edf3; margin:0; padding:24px; }
  h1 { font-size:20px; } h2 { font-size:15px; margin-top:28px; color:#9baec8; }
  .funnel { display:flex; gap:8px; flex-wrap:wrap; }
  .stage { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px 14px; min-width:110px; }
  .stage b { font-size:20px; display:block; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th, td { text-align:left; padding:6px 10px; border-bottom:1px solid #21262d; }
  tr:hover { background:#161b22; }
  .badge { padding:2px 8px; border-radius:99px; background:#1f6feb33; font-size:12px; }
  .failed { color:#f85149; } .succeeded { color:#3fb950; }
  a { color:#58a6ff; }
</style></head><body>
<h1>🏭 Websites Factory</h1>
<h2>Воронка</h2><div class="funnel" id="funnel"></div>
<h2>Бізнеси</h2><table id="biz"><thead><tr><th>ID</th><th>Назва</th><th>Статус</th><th>Score</th><th>Verdict причина</th><th>Оновлено</th></tr></thead><tbody></tbody></table>
<h2>Jobs (останні)</h2><table id="jobs"><thead><tr><th>Тип</th><th>Business</th><th>Статус</th><th>Спроби</th><th>Помилка</th></tr></thead><tbody></tbody></table>
<script>
async function load() {
  const [funnel, biz, jobs] = await Promise.all([
    fetch('/api/funnel').then(r=>r.json()),
    fetch('/api/businesses').then(r=>r.json()),
    fetch('/api/jobs').then(r=>r.json()),
  ]);
  document.getElementById('funnel').innerHTML = funnel.map(f =>
    '<div class="stage"><b>'+f.n+'</b>'+f.status+'</div>').join('');
  document.querySelector('#biz tbody').innerHTML = biz.map(b =>
    '<tr><td><a href="/api/business/'+b.id+'">'+b.id+'</a></td><td>'+b.name+'</td><td><span class="badge">'+b.status+'</span></td><td>'+(b.score??'')+'</td><td>'+(b.statusReason??'')+'</td><td>'+new Date(b.updatedAt).toLocaleString()+'</td></tr>').join('');
  document.querySelector('#jobs tbody').innerHTML = jobs.map(j =>
    '<tr><td>'+j.jobType+'</td><td>'+(j.businessId??'')+'</td><td class="'+j.status+'">'+j.status+'</td><td>'+j.attempts+'</td><td>'+(j.errorCode??'')+'</td></tr>').join('');
}
load(); setInterval(load, 10000);
</script></body></html>`;
