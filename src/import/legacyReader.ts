/**
 * Read-only reader for the legacy `website-offers` tree.
 *
 * Hard rule (spec §10 phase F): this module NEVER writes, moves or deletes
 * anything under LEGACY_DIR. It only opens files for reading.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  LegacyAsset, LegacyAssetsManifest, LegacyAudit, LegacyClient,
  LegacyLead, LegacySource, LegacySourcesFile, LegacyStatus,
} from './types.js';

/** Files that are documentation placeholders, not evidence. */
const PLACEHOLDER_FILES = new Set(['README.md', '.gitkeep', '.DS_Store']);

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
}

async function readYaml<T>(file: string): Promise<T | null> {
  try { return YAML.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
}

/** Recursively list files under `dir`, returned relative to `dir`. */
async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(full, base));
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/** List legacy client ids (directory names under `<legacyDir>/clients`). */
export async function listLegacyClientIds(legacyDir: string): Promise<string[]> {
  const clientsDir = path.join(legacyDir, 'clients');
  const entries = await readdir(clientsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/**
 * A legacy `raw_ref` is relative to the CAMPAIGN dir, not the client dir
 * (e.g. `raw/google-maps/search-x.html` under `campaigns/<campaign-id>/`).
 * Resolve it against every campaign the client belongs to, then fall back to
 * the client dir itself (older packages stored raw locally).
 *
 * Returns a path relative to `legacyDir`, or null when the file does not exist.
 */
export async function resolveRawRef(
  legacyDir: string,
  clientId: string,
  campaignIds: string[],
  rawRef: string,
): Promise<string | null> {
  const rel = rawRef.replace(/^\.?\//, '');
  const candidates = [
    ...campaignIds.map((cid) => path.join('campaigns', cid, rel)),
    path.join('clients', clientId, rel),
  ];
  for (const c of candidates) {
    if (await exists(path.join(legacyDir, c))) return c;
  }
  return null;
}

/** Find legacy audit blobs under `research/` (shape varies; treated as opaque JSON). */
async function readAudits(clientDir: string): Promise<Array<{ relPath: string; audit: LegacyAudit }>> {
  const researchDir = path.join(clientDir, 'research');
  if (!(await exists(researchDir))) return [];
  const out: Array<{ relPath: string; audit: LegacyAudit }> = [];
  for (const rel of await listFiles(researchDir)) {
    if (!/audit/i.test(rel) || !rel.endsWith('.json')) continue;
    const audit = await readJson<LegacyAudit>(path.join(researchDir, rel));
    if (audit) out.push({ relPath: path.join('research', rel), audit });
  }
  return out;
}

/**
 * A legacy `website/` dir counts as a real demo site only when it holds actual
 * site files — a lone README.md is the documented placeholder, not a site.
 */
async function detectWebsiteDir(clientDir: string): Promise<string | null> {
  const websiteDir = path.join(clientDir, 'website');
  if (!(await exists(websiteDir))) return null;
  const files = await listFiles(websiteDir);
  const real = files.filter((f) => !PLACEHOLDER_FILES.has(path.basename(f)));
  return real.length > 0 ? 'website' : null;
}

/** Read one legacy client package. Throws when `lead.yaml` is missing/unparseable. */
export async function readLegacyClient(legacyDir: string, clientId: string): Promise<LegacyClient> {
  const dir = path.join(legacyDir, 'clients', clientId);
  const lead = await readYaml<LegacyLead>(path.join(dir, 'lead.yaml'));
  if (!lead) throw new Error(`unreadable or missing lead.yaml in ${clientId}`);

  const status = (await readYaml<LegacyStatus>(path.join(dir, 'status.yaml'))) ?? {};
  const sourcesFile = await readJson<LegacySourcesFile>(path.join(dir, 'sources.json'));
  const sources: LegacySource[] = sourcesFile?.sources ?? [];
  const manifest = await readJson<LegacyAssetsManifest>(path.join(dir, 'assets', 'manifest.json'));
  const assets: LegacyAsset[] = manifest?.assets ?? [];
  const audits = await readAudits(dir);
  const websiteDir = await detectWebsiteDir(dir);

  // Evidence files: everything inside the client dir except doc placeholders.
  const evidenceFiles = (await listFiles(dir))
    .filter((rel) => !PLACEHOLDER_FILES.has(path.basename(rel)))
    .map((rel) => path.join('clients', clientId, rel))
    .sort();

  return { clientId, dir, lead, status, sources, assets, audits, websiteDir, evidenceFiles };
}
