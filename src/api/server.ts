/**
 * Factory-side HTTP surface. Two servers:
 *
 *  1. Internal API (dashboardPort): health + inbound webhooks (WhatsApp replies).
 *     The HTML dashboard that used to live here was removed in phase D — the
 *     Next.js control UI (`ui/`) is the interface now, and it reads Postgres
 *     directly instead of proxying through this process.
 *  2. Demo static server (demoPort): serves built demo sites with noindex.
 *     The UI's approval preview iframes DEMO_BASE_URL, which points here.
 */
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { ensureDemoServer, registerPreview, startDemoServer } from '../lib/serveDir.js';
import { writeQaIssues } from '../build/workspace.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { handleWahaWebhook } from '../outreach/wahaInbound.js';
import { verifyApiKey, verifyHmac } from '../outreach/wahaWebhook.js';
import { effectiveConfig, isCheckKind, runCheck } from './checks.js';
import {
  activeSession, cancelSession, disconnect, isAccountProvider,
  startSession, submitCode, telegramChats,
} from './accounts.js';
import { reloadSettings } from '../lib/settingsStore.js';

export async function startApi(): Promise<void> {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, mode: config.mode }));

  // ── Internal API for the control UI ────────────────────────────────────────
  //
  // The UI's /settings page asks the FACTORY to run connectivity checks, because
  // the factory is the process that will do the real sending and the only one
  // with the agent CLIs. Bound to 127.0.0.1 like everything else, but that is
  // network topology, not authentication — a shared secret is required so a
  // compromised sibling container cannot make the factory send Telegram
  // messages or dial SMTP on its behalf.
  //
  // Secret: INTERNAL_API_KEY, falling back to UI_SESSION_SECRET / UI_PASSWORD,
  // so a working setup needs no extra .env line. Empty secret = the endpoints
  // refuse everything rather than opening up.
  const internalAuth = async (c: any, next: any) => {
    const expected = config.ui.internalApiKey;
    if (!expected) return c.json({ ok: false, error: 'internal api disabled (no secret configured)' }, 503);
    const given = c.req.header('x-internal-key') ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      log.warn('internal api rejected', { path: c.req.path });
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
    await next();
  };

  /**
   * Run one connectivity check and report the REAL result (never a throw).
   * `claude` costs a subscription call, `telegram` sends a real message —
   * both only ever on an explicit click in the settings page.
   */
  app.post('/internal/check/:kind', internalAuth, async (c) => {
    const kind = c.req.param('kind');
    if (!isCheckKind(kind)) return c.json({ ok: false, message: `unknown check: ${kind}` }, 400);
    const started = Date.now();
    // Force a snapshot reload FIRST. Roman clicks "Перевірити" seconds after
    // saving, well inside the 15s TTL, and a check that silently used the
    // previous value would report "token не заданий" about a token he just
    // pasted — the single most confusing thing this page could do.
    await reloadSettings().catch(() => { /* stale snapshot is still better than a 500 */ });
    const result = await runCheck(kind);
    log.info('settings check run', { kind, ok: result.ok, ms: Date.now() - started });
    return c.json({ ...result, ms: Date.now() - started });
  });

  /**
   * What THIS process currently believes the configuration to be. Proves that a
   * value saved in the UI reached the running factory without a restart —
   * the whole point of moving settings into Postgres (Roman, 2026-08-17).
   */
  app.get('/internal/effective-config', internalAuth, async (c) => {
    // Same reasoning as the checks: this panel exists to prove propagation, so
    // it must never be the stale side of the TTL.
    await reloadSettings().catch(() => {});
    return c.json({ ok: true, config: effectiveConfig() });
  });

  // ── Connected accounts ─────────────────────────────────────────────────────
  //
  // Interactive logins driven from the console (`/settings` → «Підключені
  // акаунти»), so connecting Claude or Codex is a button and not a terminal
  // session on a second machine. The flows themselves live in `accounts.ts`;
  // these endpoints are the thin poll-based surface over them, because the
  // human step in the middle has no bounded duration.
  //
  // Same internal-key protection as the checks: these SPAWN processes and STORE
  // credentials, so they are strictly more sensitive than a read.

  /** Begin a flow. Returns the first snapshot; the UI then polls /status. */
  app.post('/internal/accounts/:provider/start', internalAuth, async (c) => {
    const p = c.req.param('provider');
    if (!isAccountProvider(p)) return c.json({ ok: false, message: `невідомий провайдер: ${p}` }, 400);
    return c.json({ ok: true, session: startSession(p) });
  });

  /**
   * Current phase. Poll target — the CLI output is parsed as it arrives, so the
   * URL appears here a moment after start, and `done` only after the credential
   * was stored AND re-verified with a real call.
   */
  app.get('/internal/accounts/:provider/status', internalAuth, async (c) => {
    const p = c.req.param('provider');
    if (!isAccountProvider(p)) return c.json({ ok: false, message: `невідомий провайдер: ${p}` }, 400);
    return c.json({ ok: true, session: activeSession(p) });
  });

  /** Claude only: pipe the pasted code into the waiting CLI prompt. */
  app.post('/internal/accounts/:provider/submit-code', internalAuth, async (c) => {
    const p = c.req.param('provider');
    if (!isAccountProvider(p)) return c.json({ ok: false, message: `невідомий провайдер: ${p}` }, 400);
    const body = await c.req.json().catch(() => null) as { code?: string } | null;
    return c.json({ ok: true, session: submitCode(p, String(body?.code ?? '')) });
  });

  app.post('/internal/accounts/:provider/cancel', internalAuth, async (c) => {
    const p = c.req.param('provider');
    if (!isAccountProvider(p)) return c.json({ ok: false, message: `невідомий провайдер: ${p}` }, 400);
    return c.json({ ok: true, session: cancelSession(p) });
  });

  /** "Відключити": drop the stored credential (see accounts.ts for the asymmetry). */
  app.post('/internal/accounts/:provider/disconnect', internalAuth, async (c) => {
    const p = c.req.param('provider');
    if (!isAccountProvider(p)) return c.json({ ok: false, message: `невідомий провайдер: ${p}` }, 400);
    const res = await disconnect(p);
    return c.json(res);
  });

  /**
   * Chats that have written to the Telegram bot, so the chat id is a click
   * rather than a number Roman has to dig out of a raw getUpdates response.
   * The token comes from the request when he has just typed it and not yet
   * saved it; otherwise the stored one is used.
   */
  app.post('/internal/accounts/telegram/chats', internalAuth, async (c) => {
    await reloadSettings().catch(() => {});
    const body = await c.req.json().catch(() => null) as { token?: string } | null;
    const token = (body?.token ?? '').trim() || config.telegram.botToken;
    return c.json(await telegramChats(token));
  });

  /**
   * Open a read-only preview of a build the critic rejected.
   *
   * A `needs_human_review` project never deployed, so there is no demo URL to
   * look at — and Roman cannot decide "ship it / one more pass / drop it"
   * without seeing the page. The workspace GC keeps `out/` for exactly this
   * state (`collectWorkspaceGarbage`), so the preview is a mount, not a rebuild:
   * the export is already on disk and is served by the demo server, which is the
   * only thing that re-roots a Next export's absolute asset paths correctly.
   *
   * Returns the URL rather than the files: the UI iframes it, same as it iframes
   * a deployed demo. When `out/` is genuinely gone (built before this GC rule),
   * it says so instead of serving a blank frame — a rebuild needs `pnpm install`
   * in the workspace and is a build job, not an HTTP request.
   */
  app.post('/internal/preview/:projectId', internalAuth, async (c) => {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return c.json({ ok: false, message: 'invalid project id' }, 400);
    }
    const [project] = await db.select().from(schema.siteProjects)
      .where(eq(schema.siteProjects.id, projectId));
    if (!project) return c.json({ ok: false, message: 'проєкт не знайдено' }, 404);

    const out = path.join(project.dir, 'out');
    if (!existsSync(path.join(out, 'index.html'))) {
      return c.json({
        ok: false,
        message: 'Збірка не збереглася на диску — переглянути нічого. '
          + 'Скриншоти з QA нижче показують, як сторінка виглядала. '
          + 'Щоб отримати живий preview, запусти ще одну ітерацію.',
      }, 409);
    }

    await ensureDemoServer();
    const token = registerPreview(projectId, out);
    const url = `${config.deploy.demoBaseUrl.replace(/\/+$/, '')}/${token}/`;
    log.info('preview mounted', { projectId, out, url });
    return c.json({ ok: true, url });
  });

  /**
   * Write Roman's own note into the workspace as a QA issue.
   *
   * The builder's fix iteration reads `QA-ISSUES.md` first, so this is the
   * channel by which a human instruction reaches the agent — in the same file
   * and the same format the automated critic uses, because the builder already
   * knows how to act on that file and inventing a second mechanism would mean
   * two things to keep working.
   *
   * His note goes ABOVE the machine issues and is marked as coming from the
   * owner: when the two disagree, the human is the one to obey.
   */
  app.post('/internal/qa-note/:projectId', internalAuth, async (c) => {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return c.json({ ok: false, message: 'invalid project id' }, 400);
    }
    const body = await c.req.json().catch(() => null) as { note?: string } | null;
    const note = String(body?.note ?? '').trim();
    if (!note) return c.json({ ok: false, message: 'порожня нотатка' }, 400);

    const [project] = await db.select().from(schema.siteProjects)
      .where(eq(schema.siteProjects.id, projectId));
    if (!project) return c.json({ ok: false, message: 'проєкт не знайдено' }, 404);
    if (!existsSync(path.join(project.dir, 'package.json'))) {
      return c.json({
        ok: false,
        message: 'Воркспейс цієї збірки більше не на диску — ітерацію не запустити. '
          + 'Запусти збірку заново з картки бізнесу.',
      }, 409);
    }

    const previous = existsSync(path.join(project.dir, 'QA-ISSUES.md'))
      ? await readFile(path.join(project.dir, 'QA-ISSUES.md'), 'utf8')
      : '';

    await writeQaIssues(project.dir, `# QA issues — правка від власника

## Найголовніше: це замовив Роман, власник продукту

Він подивився на зібрану сторінку і сказав саме це. Це має пріоритет над усім
нижче: якщо його вимога суперечить якомусь автоматичному зауваженню, виконуй
його. Все, про що він не написав, лишай як є — сторінка вже пройшла три
ітерації, і переробляти те, що працює, не треба.

> ${note.split('\n').join('\n> ')}

Коли закінчиш: \`pnpm build\` зелений, \`out/index.html\` на місці, потім напиши
\`result.json\`.

---

${previous || '(попередніх автоматичних зауважень у воркспейсі немає)'}
`);

    log.info('human QA note written', { projectId, dir: project.dir, chars: note.length });
    return c.json({ ok: true, message: 'нотатку записано' });
  });

  /**
   * WhatsApp inbound from WAHA (decision #2 — NOT the Meta Cloud API).
   * WAHA is configured with WHATSAPP_HOOK_URL pointing here and
   * WHATSAPP_HOOK_EVENTS=message.
   *
   * Authentication is two-layered and both layers are optional-but-recommended:
   *  - X-Api-Key must equal WAHA_API_KEY (WAHA echoes it via
   *    WHATSAPP_HOOK_CUSTOM_HEADERS), and
   *  - X-Webhook-Hmac must be HMAC-SHA512 of the RAW body under
   *    WAHA_HOOK_HMAC_KEY.
   * The raw text is read before parsing precisely because the HMAC is over
   * the exact bytes — re-serialized JSON would not match.
   */
  app.post('/webhooks/waha', async (c) => {
    const raw = await c.req.text();

    if (!verifyApiKey(c.req.header('x-api-key'))) {
      log.warn('WAHA webhook rejected: bad api key', { ip: c.req.header('x-forwarded-for') ?? null });
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
    if (!verifyHmac(raw, c.req.header('x-webhook-hmac'))) {
      log.warn('WAHA webhook rejected: bad hmac');
      return c.json({ ok: false, error: 'bad signature' }, 401);
    }

    let envelope: unknown = null;
    try { envelope = JSON.parse(raw); } catch {
      return c.json({ ok: false, error: 'invalid json' }, 400);
    }

    // Always 200 after authentication: a processing error must not make WAHA
    // retry the same inbound message forever.
    const result = await handleWahaWebhook(envelope as any)
      .catch((err) => {
        log.error('WAHA webhook processing failed', { err: String(err) });
        return { handled: false as const, reason: 'error' };
      });
    return c.json({ ok: true, ...result });
  });

  serve({ fetch: app.fetch, port: config.dashboardPort });
  log.info('factory api up', { port: config.dashboardPort, ui: config.ui.baseUrl });

  // Demo static server: private demos are noindex (SPEC §8).
  //
  // This MUST be `startDemoServer()` and not a second static handler. A Next
  // static export requests its chunks at a ROOT-absolute `/_next/...`, while a
  // private demo is served from `/<token>/` — so a plain static root serves the
  // HTML with 200 and 404s every chunk, font and photo, i.e. an unstyled page
  // that no status-code health check notices. `serveDir.ts` re-roots those
  // requests via the Referer token and is the only implementation that does;
  // duplicating a static handler here is what regressed it before.
  await startDemoServer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startApi().catch((err) => {
    log.error('api failed to start', { err: String(err) });
    process.exit(1);
  });
}
