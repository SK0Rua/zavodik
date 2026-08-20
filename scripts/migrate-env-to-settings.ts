/**
 * One-time migration: copy the operational values currently in `.env` into the
 * encrypted settings table, so moving configuration into the UI does not lose
 * a single working credential.
 *
 * Idempotent and non-destructive: a key already present in the table is left
 * alone (the DB is the newer source of truth), and `.env` itself is not
 * touched — trimming it is a separate, reviewable edit.
 *
 * `--dry` prints the plan without writing.
 */
import { config as loadEnv } from 'dotenv';
import { SETTINGS, masterKeyConfigured } from '../src/lib/settings.js';
import { loadSettingsFromDb, writeSetting } from '../src/lib/settingsStore.js';
import { pool } from '../src/db/client.js';

loadEnv();

const dry = process.argv.includes('--dry');

/**
 * Values that must NOT be copied verbatim: `.env` holds the host-side form
 * (the factory used to run via `pnpm` on the host), while the containers reach
 * these services over the compose network. Copying `http://127.0.0.1:3001`
 * into the DB would point the UI and the factory at their own loopback.
 */
const COMPOSE_OVERRIDES: Record<string, string> = {
  WAHA_URL: 'http://waha:3000',
};

const existing = await loadSettingsFromDb();
if (!masterKeyConfigured()) {
  console.error('SETTINGS_MASTER_KEY missing — secrets cannot be written. Aborting.');
  process.exit(1);
}

let copied = 0, skipped = 0, defaulted = 0;
for (const def of SETTINGS) {
  if (existing.has(def.key)) { skipped++; continue; }
  const override = COMPOSE_OVERRIDES[def.key];
  const raw = override ?? process.env[def.key] ?? '';
  if (raw === '') { defaulted++; continue; }
  const err = def.validate?.(raw);
  if (err) {
    console.warn(`skip ${def.key}: ${err} (value from env is invalid)`);
    skipped++;
    continue;
  }
  console.log(`${dry ? '[dry] ' : ''}${def.key} <- ${def.secret ? `(secret, ${raw.length} chars)` : raw}${override ? ' [compose override]' : ''}`);
  if (!dry) await writeSetting(def.key, raw, 'env-migration');
  copied++;
}

console.log(`\n${dry ? 'would copy' : 'copied'}: ${copied}; already in DB: ${skipped}; left to default: ${defaulted}`);
await pool.end();
