/**
 * Factory CLI:
 *   pnpm factory campaign:create --id gr-patras-beauty --country gr --city Patras --niche beauty --lang el --queries "nail salon,beauty salon" --target 30
 *   pnpm factory campaign:run --id gr-patras-beauty
 *   pnpm factory status
 *
 * Legacy `website-offers` import lives in `pnpm import:legacy`
 * (`scripts/import-legacy.ts`, phase F — see docs/IMPORT.md). The v0 `import`
 * command that used to sit here read legacy fields that do not exist in the
 * real packages, loaded no evidence, and was neither deduplicating nor
 * idempotent; it was removed rather than left as a trap.
 */
import { eq } from 'drizzle-orm';
import { db, schema, pool } from './db/client.js';
import { enqueue, getBoss } from './orchestrator/queue.js';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const cmd = process.argv[2];

if (cmd === 'campaign:create') {
  const id = arg('id');
  await db.insert(schema.campaigns).values({
    id,
    country: arg('country'),
    city: arg('city'),
    niche: arg('niche'),
    language: arg('lang', 'el'),
    queries: arg('queries').split(',').map((s) => s.trim()),
    geofence: { lat: Number(arg('lat', '0')), lng: Number(arg('lng', '0')), radiusKm: Number(arg('radius', '15')) },
    targetCount: Number(arg('target', '30')),
    mode: arg('mode', process.env.FACTORY_MODE ?? 'dry_run'),
  }).onConflictDoNothing();
  console.log(`campaign created: ${id}`);
} else if (cmd === 'campaign:run') {
  const id = arg('id');
  await db.update(schema.campaigns).set({ status: 'running' }).where(eq(schema.campaigns.id, id));
  await enqueue('discover', { campaignId: id, idempotencyKey: `discover:${id}:${Date.now()}` });
  console.log(`discovery enqueued for ${id}; watch the UI at /jobs`);
} else if (cmd === 'status') {
  const rows = await db.select().from(schema.businesses);
  const byStatus = new Map<string, number>();
  rows.forEach((b) => byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1));
  console.table([...byStatus.entries()].map(([status, count]) => ({ status, count })));
} else {
  console.log(`commands:
  campaign:create --id X --country gr --city Patras --niche beauty --lang el --queries "a,b" --target 30 [--lat --lng --radius --mode dry_run|live]
  campaign:run    --id X
  status

legacy import:  pnpm import:legacy   (see docs/IMPORT.md)`);
}

const boss = await getBoss().catch(() => null);
await boss?.stop({ close: true, timeout: 2000 }).catch(() => {});
await pool.end();
