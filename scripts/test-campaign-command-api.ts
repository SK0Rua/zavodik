import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createInternalAuth } from '../src/api/internalAuth.js';
import {
  registerCampaignCommandRoutes,
  type CampaignCommandExecutor,
} from '../src/api/campaignCommands.js';

let passed = 0;

async function check(label: string, run: () => Promise<void>): Promise<void> {
  await run();
  passed++;
  console.log(`✅ ${label}`);
}

const acceptedJob = {
  kind: 'accepted' as const,
  runId: '00000000-0000-4000-8000-000000000001',
  runStatus: 'queued' as const,
  attemptId: 1,
  attemptSequence: 1,
  bossJobId: '00000000-0000-4000-8000-000000000002',
};

function appWith(secret: string, execute: CampaignCommandExecutor): Hono {
  const app = new Hono();
  registerCampaignCommandRoutes(app, createInternalAuth(() => secret), execute);
  return app;
}

async function post(app: Hono, body: unknown, key?: string) {
  const response = await app.request('/internal/campaigns', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-internal-key': key } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

const validBody = {
  country: 'GR', city: 'Patras', niche: 'Beauty', language: 'el',
  queries: ['beauty patras'], targetCount: 20,
  lat: 38.2, lng: 21.7, radiusKm: 10, autoBuild: 'manual',
};

await check('campaign creation fails closed without the internal credential', async () => {
  const execute: CampaignCommandExecutor = {
    create: async () => ({ kind: 'created', campaignId: 'campaign', job: acceptedJob }),
  };
  assert.equal((await post(appWith('secret', execute), validBody, 'wrong')).status, 401);
  assert.equal((await post(appWith('', execute), validBody, 'secret')).status, 503);
});

await check('invalid campaign fields never reach the service', async () => {
  let calls = 0;
  const app = appWith('secret', {
    create: async () => { calls++; return { kind: 'exists', campaignId: 'x' }; },
  });
  assert.equal((await post(app, { ...validBody, queries: [] }, 'secret')).status, 400);
  assert.equal((await post(app, { ...validBody, lat: 100 }, 'secret')).status, 400);
  assert.equal((await post(app, { ...validBody, targetCount: 0 }, 'secret')).status, 400);
  assert.equal(calls, 0);
});

await check('valid input is normalized and returns the discovery command result', async () => {
  let captured: unknown;
  const app = appWith('secret', {
    create: async (input) => {
      captured = input;
      return { kind: 'created', campaignId: 'gr-patras-beauty-2026-08', job: acceptedJob };
    },
  });
  const response = await post(app, { ...validBody, city: ' Patras ', queries: [' beauty ', ''] }, 'secret');
  assert.equal(response.status, 201);
  assert.equal(response.body.result.job.kind, 'accepted');
  assert.deepEqual(captured, {
    country: 'GR', city: 'Patras', niche: 'Beauty', language: 'el',
    queries: ['beauty'], targetCount: 20,
    geofence: { lat: 38.2, lng: 21.7, radiusKm: 10 },
    autoBuild: 'manual',
    // The route normalises the campaign-flow controls too, so a request that
    // names neither still reaches the service with explicit defaults rather
    // than `undefined`: stop at the build stage, filter nothing at discovery.
    autoStage: 'build',
    discoveryFilter: {
      websiteNone: false, minRating: null, minReviews: null, requireContact: false,
    },
  });
});

await check('campaign-flow controls are normalised, not passed through raw', async () => {
  let captured: { autoStage?: unknown; discoveryFilter?: unknown } = {};
  const app = appWith('secret', {
    create: async (input) => {
      captured = input;
      return { kind: 'created', campaignId: 'gr-patras-beauty-2026-08', job: acceptedJob };
    },
  });
  await post(app, {
    ...validBody,
    autoStage: 'nonsense',
    // `'on'` is what an HTML checkbox sends; `'yes'` is not a truthy form value
    // and must NOT be read as one. `minReviews: 'x'` is unparseable and becomes
    // null rather than NaN, which would poison every later comparison.
    discoveryFilter: { websiteNone: 'on', minRating: '4.2', minReviews: 'x', requireContact: 'yes' },
  }, 'secret');
  // An unknown stop-point falls back to the default rather than reaching the
  // service and silently halting every campaign at an undefined stage.
  assert.equal(captured.autoStage, 'build');
  assert.deepEqual(captured.discoveryFilter, {
    websiteNone: true, minRating: 4.2, minReviews: null, requireContact: false,
  });
});

await check('an existing monthly campaign is an explicit conflict', async () => {
  const response = await post(appWith('secret', {
    create: async () => ({ kind: 'exists', campaignId: 'gr-patras-beauty-2026-08' }),
  }), validBody, 'secret');
  assert.equal(response.status, 409);
  assert.equal(response.body.result.kind, 'exists');
});

console.log(`\n🔐 CAMPAIGN COMMAND API TESTS PASSED (${passed})`);
