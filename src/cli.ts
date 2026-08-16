/**
 * Factory CLI:
 *   pnpm factory campaign:create --id gr-patras-beauty --country gr --city Patras --niche beauty --lang el --queries "nail salon,beauty salon" --target 30
 *   pnpm factory campaign:run --id gr-patras-beauty
 *   pnpm factory import --dir /path/to/website-offers   (import existing clients/ folders)
 *   pnpm factory status
 */
import { eq } from 'drizzle-orm';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { db, schema, pool } from './db/client.js';
import { enqueue, getBoss } from './orchestrator/queue.js';
import { normalizeName, normalizePhone, extractDomain } from './workers/normalize.js';

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
  console.log(`discovery enqueued for ${id}; watch the dashboard`);
} else if (cmd === 'import') {
  // import existing /root/website-offers clients/ as read-only evidence archive -> DB
  const dir = arg('dir');
  const clientsDir = path.join(dir, 'clients');
  const campaignId = arg('campaign', 'imported-legacy');
  await db.insert(schema.campaigns).values({
    id: campaignId, country: 'gr', city: 'Patras', niche: 'beauty', language: 'el',
    queries: [], geofence: { lat: 38.246, lng: 21.735, radiusKm: 15 }, targetCount: 0, status: 'done',
  }).onConflictDoNothing();

  for (const entry of await readdir(clientsDir)) {
    const clientDir = path.join(clientsDir, entry);
    if (!(await stat(clientDir)).isDirectory()) continue;
    try {
      const lead = YAML.parse(await readFile(path.join(clientDir, 'lead.yaml'), 'utf8'));
      const status = YAML.parse(await readFile(path.join(clientDir, 'status.yaml'), 'utf8').catch(() => 'status: discovered')) ?? {};
      const name = lead?.name ?? lead?.business_name ?? entry;
      await db.insert(schema.businesses).values({
        id: entry, campaignId,
        name, normalizedName: normalizeName(String(name)),
        category: lead?.category ?? null,
        address: lead?.address ?? null,
        phone: lead?.phone ?? null,
        normalizedPhone: normalizePhone(lead?.phone ?? null),
        websiteUrl: lead?.website ?? null,
        domain: extractDomain(lead?.website ?? null),
        placeId: lead?.place_id ?? null,
        listingUrl: lead?.google_maps_url ?? null,
        rating: lead?.rating ?? null,
        reviewCount: lead?.review_count ?? null,
        status: status?.status ?? 'discovered',
      }).onConflictDoNothing();
      await db.insert(schema.statusHistory).values({ businessId: entry, toStatus: status?.status ?? 'discovered', actor: 'import', reason: 'legacy import' });
      console.log(`imported ${entry} (${status?.status ?? 'discovered'})`);
    } catch (err) {
      console.warn(`skip ${entry}: ${String(err).slice(0, 120)}`);
    }
  }
} else if (cmd === 'status') {
  const rows = await db.select().from(schema.businesses);
  const byStatus = new Map<string, number>();
  rows.forEach((b) => byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1));
  console.table([...byStatus.entries()].map(([status, count]) => ({ status, count })));
} else {
  console.log(`commands:
  campaign:create --id X --country gr --city Patras --niche beauty --lang el --queries "a,b" --target 30 [--lat --lng --radius --mode dry_run|live]
  campaign:run    --id X
  import          --dir /path/to/website-offers [--campaign imported-legacy]
  status`);
}

const boss = await getBoss().catch(() => null);
await boss?.stop({ close: true, timeout: 2000 }).catch(() => {});
await pool.end();
