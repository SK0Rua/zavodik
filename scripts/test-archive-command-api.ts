import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createInternalAuth } from '../src/api/internalAuth.js';
import {
  registerArchiveCommandRoutes,
  type ArchiveCommandExecutor,
} from '../src/api/archiveCommands.js';

let passed = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  await run();
  passed++;
  console.log(`✅ ${label}`);
}

function executor(
  overrides: Partial<ArchiveCommandExecutor> = {},
): ArchiveCommandExecutor {
  return {
    archiveBusiness: async (businessId) => ({
      kind: 'archived', businessId, cancelledJobs: 0, cancelledProjects: 0,
    }),
    unarchiveBusiness: async (businessId) => ({ kind: 'unarchived', businessId }),
    deleteBusiness: async (businessId) => ({ kind: 'deleted', businessId }),
    archiveCampaign: async (campaignId) => ({
      kind: 'archived', campaignId, archivedBusinesses: 0,
    }),
    unarchiveCampaign: async (campaignId) => ({
      kind: 'unarchived', campaignId, restoredBusinesses: 0,
    }),
    deleteCampaign: async (campaignId) => ({ kind: 'deleted', campaignId }),
    archiveBusinesses: async (ids) => ({
      archived: ids.length, cancelledJobs: 0, cancelledProjects: 0, missing: 0,
    }),
    unarchiveBusinesses: async (ids) => ({ restored: ids.length }),
    deleteBusinesses: async (ids) => ({ deleted: ids.length, blocked: 0, missing: 0 }),
    ...overrides,
  };
}

function appWith(secret: string, execute = executor()): Hono {
  const app = new Hono();
  registerArchiveCommandRoutes(app, createInternalAuth(() => secret), execute);
  return app;
}

async function call(app: Hono, method: string, path: string, body?: unknown, key?: string) {
  const response = await app.request(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'x-internal-key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

await check('archive commands fail closed without the internal credential', async () => {
  assert.equal((await call(appWith('secret'), 'POST', '/internal/businesses/a/archive', undefined, 'wrong')).status, 401);
  assert.equal((await call(appWith('secret'), 'DELETE', '/internal/businesses/a', undefined, 'wrong')).status, 401);
  // No secret configured at all must refuse rather than accept everything.
  assert.equal((await call(appWith(''), 'POST', '/internal/campaigns/c/archive', undefined, 'secret')).status, 503);
});

await check('archiving a business passes the reason through and reports what it cancelled', async () => {
  let seen: { id?: string; reason?: string } = {};
  const app = appWith('secret', executor({
    archiveBusiness: async (businessId, reason) => {
      seen = { id: businessId, reason };
      return { kind: 'archived', businessId, cancelledJobs: 3, cancelledProjects: 1 };
    },
  }));
  const res = await call(app, 'POST', '/internal/businesses/ua-sumy-kfc/archive', { reason: 'не цільовий' }, 'secret');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(seen.id, 'ua-sumy-kfc');
  assert.equal(seen.reason, 'не цільовий');
  assert.equal(res.body.result.cancelledJobs, 3);
});

await check('a blank reason reaches the service as undefined, not an empty string', async () => {
  let seen: unknown = 'untouched';
  const app = appWith('secret', executor({
    archiveBusiness: async (businessId, reason) => {
      seen = reason;
      return { kind: 'archived', businessId, cancelledJobs: 0, cancelledProjects: 0 };
    },
  }));
  await call(app, 'POST', '/internal/businesses/b/archive', { reason: '   ' }, 'secret');
  assert.equal(seen, undefined);
});

await check('deleting a contacted business is refused with the reason, not a 500', async () => {
  const message = 'Цьому бізнесу вже писали';
  const app = appWith('secret', executor({
    deleteBusiness: async () => ({ kind: 'blocked', message }),
  }));
  const res = await call(app, 'DELETE', '/internal/businesses/ua-sumy-kfc', undefined, 'secret');
  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.message, message);
});

await check('a missing business/campaign is 404, a state conflict is 409', async () => {
  const missing = appWith('secret', executor({
    deleteBusiness: async () => ({ kind: 'not_found', entity: 'business' }),
    deleteCampaign: async () => ({ kind: 'not_found', entity: 'campaign' }),
  }));
  assert.equal((await call(missing, 'DELETE', '/internal/businesses/nope', undefined, 'secret')).status, 404);
  assert.equal((await call(missing, 'DELETE', '/internal/campaigns/nope', undefined, 'secret')).status, 404);

  const nonEmpty = appWith('secret', executor({
    deleteCampaign: async () => ({ kind: 'blocked', message: 'У кампанії ще 12 бізнес(ів).' }),
  }));
  const res = await call(nonEmpty, 'DELETE', '/internal/campaigns/ua-sumy-beauty', undefined, 'secret');
  assert.equal(res.status, 409);
  assert.match(res.body.message, /12/);
});

await check('campaign archive and restore report their cascade counts', async () => {
  const app = appWith('secret', executor({
    archiveCampaign: async (campaignId) => ({ kind: 'archived', campaignId, archivedBusinesses: 42 }),
    unarchiveCampaign: async (campaignId) => ({ kind: 'unarchived', campaignId, restoredBusinesses: 42 }),
  }));
  const archived = await call(app, 'POST', '/internal/campaigns/ua-sumy-beauty/archive', {}, 'secret');
  assert.equal(archived.body.result.archivedBusinesses, 42);
  const restored = await call(app, 'POST', '/internal/campaigns/ua-sumy-beauty/unarchive', undefined, 'secret');
  assert.equal(restored.body.result.restoredBusinesses, 42);
});

await check('bulk archive de-duplicates ids and passes the reason through', async () => {
  let seen: { ids?: readonly string[]; reason?: string } = {};
  const app = appWith('secret', executor({
    archiveBusinesses: async (ids, reason) => {
      seen = { ids, reason };
      return { archived: ids.length, cancelledJobs: 7, cancelledProjects: 2, missing: 0 };
    },
  }));
  const res = await call(app, 'POST', '/internal/businesses/archive-bulk', {
    businessIds: ['a', 'b', 'a', '  ', 'c'],
    reason: 'чистка',
  }, 'secret');
  assert.equal(res.status, 200);
  assert.deepEqual([...(seen.ids ?? [])], ['a', 'b', 'c']);
  assert.equal(seen.reason, 'чистка');
  assert.equal(res.body.result.cancelledJobs, 7);
});

await check('bulk endpoints reject a missing or empty id list', async () => {
  const app = appWith('secret');
  assert.equal((await call(app, 'POST', '/internal/businesses/archive-bulk', {}, 'secret')).status, 400);
  assert.equal((await call(app, 'POST', '/internal/businesses/archive-bulk', { businessIds: [] }, 'secret')).status, 400);
  assert.equal((await call(app, 'POST', '/internal/businesses/delete-bulk', { businessIds: 'a' }, 'secret')).status, 400);
});

await check('an unbounded bulk request is refused rather than attempted', async () => {
  let called = false;
  const app = appWith('secret', executor({
    archiveBusinesses: async (ids) => {
      called = true;
      return { archived: ids.length, cancelledJobs: 0, cancelledProjects: 0, missing: 0 };
    },
  }));
  const tooMany = Array.from({ length: 5001 }, (_, i) => `biz-${i}`);
  const res = await call(app, 'POST', '/internal/businesses/archive-bulk', { businessIds: tooMany }, 'secret');
  assert.equal(res.status, 400);
  assert.equal(called, false, 'the service must not be asked to run an oversized transaction');
});

await check('bulk delete reports what outreach protected instead of failing', async () => {
  const app = appWith('secret', executor({
    deleteBusinesses: async () => ({ deleted: 37, blocked: 3, missing: 0 }),
  }));
  const res = await call(app, 'POST', '/internal/businesses/delete-bulk', {
    businessIds: ['a', 'b'],
  }, 'secret');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.result.deleted, 37);
  assert.equal(res.body.result.blocked, 3);
});

await check('bulk routes are still behind the internal credential', async () => {
  for (const path of ['archive-bulk', 'unarchive-bulk', 'delete-bulk']) {
    const res = await call(appWith('secret'), 'POST', `/internal/businesses/${path}`, { businessIds: ['a'] }, 'wrong');
    assert.equal(res.status, 401, `${path} must fail closed`);
  }
});

console.log(`\n${passed} archive command API checks passed`);
