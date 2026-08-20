/**
 * Phase F CLI — import the legacy `website-offers` packages into the factory DB.
 *
 *   pnpm import:legacy --dry-run
 *   pnpm import:legacy --only get-nailed --only mc-beauty --only be-beautiful
 *   pnpm import:legacy --dir ~/Developer/website-offers
 *   LEGACY_DIR=/root/website-offers pnpm import:legacy
 *
 * The legacy directory is opened READ-ONLY; the importer never writes there.
 * Re-running is safe: the import is idempotent (see docs/IMPORT.md).
 */
import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { stat } from 'node:fs/promises';
import { pool } from '../src/db/client.js';
import { runImport, DEFAULT_LEGACY_CAMPAIGN } from '../src/import/importer.js';

/** Spec §10 phase F names the server path; LEGACY_DIR overrides it locally. */
const DEFAULT_LEGACY_DIR = '/root/website-offers';

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function opt(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}

/** `--only` may be repeated; each value is an exact id or a substring. */
function multiOpt(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) out.push(process.argv[i + 1]);
  });
  return out;
}

if (flag('help')) {
  console.log(`import-legacy — Phase F legacy importer (read-only on the legacy tree)

  --dir <path>       legacy workspace (default: $LEGACY_DIR or ${DEFAULT_LEGACY_DIR})
  --campaign <id>    factory campaign to attach to (default: ${DEFAULT_LEGACY_CAMPAIGN})
  --only <name>      import only matching client ids (repeatable, substring ok)
  --limit <n>        cap the number of clients processed
  --dry-run          print the plan, write nothing (no DB rows, no uploads)
  --json             print the full machine-readable summary
`);
  process.exit(0);
}

const legacyDir = path.resolve(expandHome(opt('dir') ?? process.env.LEGACY_DIR ?? DEFAULT_LEGACY_DIR));
const campaignId = opt('campaign', DEFAULT_LEGACY_CAMPAIGN)!;
const only = multiOpt('only');
const limitRaw = opt('limit');
const limit = limitRaw ? Number(limitRaw) : undefined;
const dryRun = flag('dry-run');

let exitCode = 0;
try {
  const clientsDir = path.join(legacyDir, 'clients');
  try {
    if (!(await stat(clientsDir)).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`legacy clients dir not found: ${clientsDir}\nPass --dir or set LEGACY_DIR.`);
    process.exit(2);
  }

  const summary = await runImport({ legacyDir, campaignId, only, limit, dryRun });

  const totals = summary.results.reduce((acc, r) => {
    for (const [k, v] of Object.entries(r.counts)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {} as Record<string, number>);

  if (flag('json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('\n' + '─'.repeat(72));
    console.log(`legacy import ${dryRun ? '(DRY RUN — nothing written)' : ''}`);
    console.log(`  legacy dir : ${summary.legacyDir}  (read-only)`);
    console.log(`  campaign   : ${summary.campaignId}`);
    console.log(`  clients    : ${summary.clientsSeen} seen`);
    console.log(`  businesses : ${summary.created} created, ${summary.attached} attached, ${summary.skipped} skipped, ${summary.failed} failed`);
    console.log('  evidence   : '
      + `${totals.sourcesCreated ?? 0} sources created, ${totals.sourcesExisting ?? 0} already present, `
      + `${totals.objectsUploaded ?? 0} objects uploaded`);
    console.log('  data       : '
      + `${totals.factsCreated ?? 0} facts (${totals.factsUnverified ?? 0} unverified), `
      + `${totals.contactsCreated ?? 0} contacts, ${totals.assetsCreated ?? 0} assets, `
      + `${totals.auditsCreated ?? 0} audits, ${totals.siteProjectsCreated ?? 0} site projects, `
      + `${totals.gapsCreated ?? 0} gaps`);

    const failures = summary.results.filter((r) => r.outcome === 'failed');
    if (failures.length) {
      console.log(`\n  failures (${failures.length}):`);
      for (const f of failures.slice(0, 20)) console.log(`    - ${f.clientId}: ${f.reason}`);
    }
    if (only.length || summary.clientsSeen <= 20) {
      console.log('\n  per client:');
      for (const r of summary.results) {
        console.log(`    - ${r.clientId} -> ${r.businessId ?? '(none)'} [${r.outcome}] status=${r.status ?? '-'}`
          + ` sources=${r.counts.sourcesCreated}/+${r.counts.sourcesExisting}`
          + ` facts=${r.counts.factsCreated} assets=${r.counts.assetsCreated} gaps=${r.counts.gapsCreated}`);
      }
    }
    console.log('─'.repeat(72) + '\n');
  }

  if (summary.failed > 0) exitCode = 1;
} catch (err) {
  console.error('import failed:', err);
  exitCode = 1;
} finally {
  await pool.end();
}

process.exit(exitCode);
