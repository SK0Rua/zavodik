/**
 * landing.gallery as an ADDITIONAL inspiration source for stage 9 (SPEC §2.4).
 *
 * The motion pack (`references/motion/`) is 17 hand-picked sites whose notes were
 * written by hand, and it stays the authority on MECHANICS. What it cannot be is
 * broad: it is a fixed pack, so every campaign sees the same seventeen moods.
 * landing.gallery is a public, hand-curated screenshot corpus (~1600 sites) with
 * a read-only MCP endpoint, which makes it a cheap way to put a few CURRENT,
 * business-relevant layouts in front of the art director without anybody curating
 * them first.
 *
 * ARCHITECTURE, unchanged from the motion pack: CODE fetches, the AGENT cites.
 * No MCP server is wired into the agent runtime and the builder workspace keeps
 * its no-internet property — this module downloads previews during stage-9 prep
 * and drops them on disk as ordinary files.
 *
 * WHAT THE ENDPOINT ACTUALLY IS (verified by calling it, 2026-08-21):
 *
 *   - `POST https://www.landing.gallery/api/mcp`, no auth, no `Mcp-Session-Id`.
 *     A bare `tools/call` works: NO `initialize` handshake is required, which is
 *     why this file is 200 lines of fetch rather than an MCP client dependency.
 *   - It answers `text/event-stream` even for a single response — one
 *     `event: message` / `data: {json}` frame — so the body is parsed by pulling
 *     `data:` lines out, with a plain-JSON fallback in case that ever changes.
 *   - The one tool, `search_inspiration`, caps `limit` at 4 per call. More than
 *     four results therefore means more than one call.
 *   - The result carries BOTH `content` (text + base64 `image/webp` blocks, ~55KB
 *     each) and `structuredContent` (typed JSON). We read `structuredContent`
 *     ONLY and never decode the inline images: a 4-result response is ~114KB of
 *     base64, and the same screenshots are available as plain URLs that
 *     `safeFetchImage` can guard.
 *
 * THE SEARCH IS FULL-TEXT OVER name+description, NOT SEMANTIC. Measured:
 * `"hair salon"` → 0 results, `"beauty studio"` → 0, `"dark luxury"` → 0, while
 * `"hair"` → 4, `"beauty"` → 8, `"editorial"` → 6, `"luxury"` → 7. Multi-word
 * queries appear to AND their terms against a corpus that skews hard towards SaaS
 * and design agencies. `searchInspiration()` therefore takes a LIST of SINGLE
 * WORDS and unions their results — building "hair salon dark luxury" as one
 * string would reliably return nothing at all.
 *
 * NOTHING HERE IS EVER FATAL. Inspiration is a nice-to-have; a dead endpoint, a
 * timeout or an empty corpus for this niche degrades the prompt by one optional
 * block and stage 9 continues. Every entry point returns [] rather than throwing.
 */
import { safeFetchImage } from './safeFetch.js';
import { config } from '../config.js';
import { log } from './logger.js';

const MCP_URL = 'https://www.landing.gallery/api/mcp';

/** The endpoint's own hard cap on one call. Asking for more is silently clamped. */
export const MAX_LIMIT_PER_CALL = 4;

export interface GalleryEntry {
  /** Site name as the gallery lists it. */
  title: string;
  /** Short blurb the gallery stores; may be null. */
  description: string | null;
  /** The real site this screenshot is of — what a human would go and look at. */
  sourceUrl: string;
  /** The landing.gallery page for this entry. */
  galleryUrl: string;
  /** Downscaled screenshot (720x1080 crop of the top). What we download. */
  previewUrl: string;
  /** Full-page screenshot; recorded for the index, not downloaded (they are tall). */
  fullScreenshotUrl: string;
  /** "Framer" / "Webflow" / null. */
  builder: string | null;
  /** "Next.js" / "Astro" / null. */
  framework: string | null;
  /** Which of our queries surfaced this entry — the "why fetched" line. */
  query: string;
}

/**
 * Pull the JSON payload out of an SSE-framed body.
 *
 * The endpoint answers `text/event-stream` with a single frame, but a plain
 * `application/json` body is accepted too so a future change in their transport
 * degrades to "still works" rather than "silently returns nothing". Multi-frame
 * bodies take the LAST frame carrying a `result` or `error`, which is what a
 * streaming JSON-RPC response ends with.
 */
export function parseSseJson(body: string): unknown {
  const frames: unknown[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { frames.push(JSON.parse(payload)); } catch { /* a partial frame is not an error */ }
  }
  if (frames.length === 0) {
    try { return JSON.parse(body); } catch { return null; }
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i] as { result?: unknown; error?: unknown } | null;
    if (f && typeof f === 'object' && ('result' in f || 'error' in f)) return f;
  }
  return frames[frames.length - 1];
}

/** Shape of the `structuredContent` the tool returns. Narrowed, not trusted. */
interface RawResult {
  name?: unknown;
  description?: unknown;
  galleryUrl?: unknown;
  pagebuilder?: { name?: unknown } | null;
  framework?: { name?: unknown } | null;
  screenshot?: {
    previewUrl?: unknown;
    fullScreenshotUrl?: unknown;
    sourcePageUrl?: unknown;
  } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Turn one JSON-RPC response into entries, dropping anything without the three
 * fields that make an entry useful: a title, a preview to download, and a source
 * URL the art director can cite. A malformed row is skipped, never guessed at.
 */
export function entriesFromResponse(payload: unknown, query: string): GalleryEntry[] {
  const result = (payload as { result?: { structuredContent?: { results?: unknown } } } | null)
    ?.result?.structuredContent?.results;
  if (!Array.isArray(result)) return [];

  const out: GalleryEntry[] = [];
  for (const row of result as RawResult[]) {
    const title = str(row?.name);
    const previewUrl = str(row?.screenshot?.previewUrl);
    const sourceUrl = str(row?.screenshot?.sourcePageUrl);
    if (!title || !previewUrl || !sourceUrl) continue;
    out.push({
      title,
      description: str(row?.description),
      sourceUrl,
      galleryUrl: str(row?.galleryUrl) ?? sourceUrl,
      previewUrl,
      fullScreenshotUrl: str(row?.screenshot?.fullScreenshotUrl) ?? previewUrl,
      builder: str(row?.pagebuilder?.name),
      framework: str(row?.framework?.name),
      query,
    });
  }
  return out;
}

/** One `tools/call`. Returns [] on any failure — see the file header. */
async function callSearch(query: string, limit: number, timeoutMs: number): Promise<GalleryEntry[]> {
  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Both, because the server answers SSE but may negotiate plain JSON.
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_inspiration',
          arguments: { query, limit: Math.min(limit, MAX_LIMIT_PER_CALL) },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    log.warn('landing.gallery request failed', { query, err: String(err).slice(0, 160) });
    return [];
  }
  if (!res.ok) {
    log.warn('landing.gallery returned an error status', { query, status: res.status });
    return [];
  }
  const body = await res.text().catch(() => '');
  return entriesFromResponse(parseSseJson(body), query);
}

/**
 * Search several SINGLE-WORD queries and union the results, deduped by source URL.
 *
 * Queries run in sequence rather than in parallel: this is a free public endpoint
 * being used as a courtesy, three requests take ~2s in total, and stage 9 is
 * already a multi-minute stage. Nothing here is on a latency path.
 */
export async function searchInspiration(
  queries: string[],
  opts: { limit?: number; timeoutMs?: number } = {},
): Promise<GalleryEntry[]> {
  const limit = opts.limit ?? 6;
  const timeoutMs = opts.timeoutMs ?? config.landingGallery.timeoutMs;

  const seen = new Set<string>();
  const out: GalleryEntry[] = [];
  for (const query of queries) {
    if (out.length >= limit) break;
    const word = query.trim();
    if (!word) continue;
    for (const entry of await callSearch(word, MAX_LIMIT_PER_CALL, timeoutMs)) {
      if (seen.has(entry.sourceUrl)) continue;
      seen.add(entry.sourceUrl);
      out.push(entry);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Build the query list for one business.
 *
 * SINGLE WORDS ONLY — see the file header for the measurement. The order is
 * deliberate: the business's own measured mood words first (they are the thing
 * that makes one salon's references differ from its neighbour's), then category
 * words, and `design` last as a floor so a niche the corpus does not cover still
 * yields something rather than nothing.
 *
 * Words shorter than four characters are dropped: `"a"` matches 1613 entries and
 * would return the corpus's four newest sites for every business alike.
 */
/**
 * English corpus words per campaign niche — the query source that SURVIVES a
 * non-Latin business. Measured on GR-patras (2026-08-22): the mood words and
 * category were Greek, the `[^a-z]` strip erased them all, only the `design`
 * floor remained — and every Greek salon got the same four SaaS landing pages
 * as "inspiration", which is the exact pull towards a startup template the
 * prompt warns against. The niche comes from the campaign row and is always
 * a Latin word we chose ourselves.
 */
const NICHE_QUERY_WORDS: Record<string, string[]> = {
  beauty: ['beauty', 'salon', 'studio', 'wellness'],
};

export function buildQueries(business: {
  category?: string | null;
  moodWords?: string[] | null;
  /** Campaign niche — the reliable Latin fallback when the business is localized. */
  niche?: string | null;
}, max = 3): string[] {
  const words: string[] = [];
  const push = (raw: string) => {
    const w = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length < 4) return;
    if (words.includes(w)) return;
    words.push(w);
  };

  for (const m of business.moodWords ?? []) for (const part of m.split(/\s+/)) push(part);
  for (const part of (business.category ?? '').split(/[^a-zA-Z]+/)) push(part);
  const niche = (business.niche ?? '').toLowerCase();
  for (const w of NICHE_QUERY_WORDS[niche] ?? [niche]) push(w);
  push('design'); // the floor: always matches, so the block is rarely empty
  return words.slice(0, max);
}

export interface DownloadedRef extends GalleryEntry {
  /**
   * Path of the saved preview RELATIVE TO THE WORKSPACE, e.g.
   * `references/gallery/1.webp`. It is written that way even though the file is
   * first staged elsewhere, because the only consumer that opens it is the
   * builder agent, which sees it at that path.
   */
  file: string;
}

/**
 * Download the previews into `dir` and write an `index.md` next to them.
 *
 * Every download goes through `safeFetchImage`: these URLs come from a third
 * party, and the workers run inside the compose network where `minio:9000` and
 * `postgres:5432` are reachable by name. The guard is the same one that protects
 * the scraped-`og:image` path — an inspiration source is no more trusted than a
 * scraped page.
 *
 * Returns only the entries whose image actually landed on disk, so callers cannot
 * cite a file that is not there.
 */
export async function downloadRefs(
  galleryDir: string,
  entries: GalleryEntry[],
): Promise<DownloadedRef[]> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');

  await mkdir(galleryDir, { recursive: true });

  const saved: DownloadedRef[] = [];
  for (const entry of entries) {
    const res = await safeFetchImage(entry.previewUrl, {
      maxBytes: 4 * 1024 * 1024,
      timeoutMs: config.landingGallery.timeoutMs,
    });
    if ('blocked' in res) {
      log.warn('landing.gallery preview not downloaded', {
        url: entry.previewUrl.slice(0, 120), reason: res.blocked,
      });
      continue;
    }
    // The CDN serves `format=auto` (webp in practice); the extension follows the
    // content type so the builder agent's image reader is not lied to.
    const ext = res.contentType.includes('png') ? 'png'
      : res.contentType.includes('webp') ? 'webp'
      : 'jpg';
    const name = `${saved.length + 1}.${ext}`;
    await writeFile(path.join(galleryDir, name), res.buffer);
    saved.push({ ...entry, file: `references/gallery/${name}` });
  }

  if (saved.length === 0) return saved;

  await writeFile(path.join(galleryDir, 'index.md'), renderIndexMd(saved));
  return saved;
}

/** The on-disk provenance record: what each file is and why it was fetched. */
export function renderIndexMd(refs: DownloadedRef[]): string {
  return [
    '# Additional layout references — landing.gallery',
    '',
    'Public, hand-curated screenshots fetched automatically for THIS build. They are',
    'inspiration for layout and mood only. Motion mechanics come from the motion pack;',
    'the palette comes from the business\'s own measured identity. Never copy a colour,',
    'a photograph or any copy from these pages.',
    '',
    ...refs.flatMap((r) => [
      `## ${r.file}`,
      '',
      `- **${r.title}**${r.builder ? ` (${r.builder})` : r.framework ? ` (${r.framework})` : ''}`,
      `- Site: ${r.sourceUrl}`,
      `- Gallery: ${r.galleryUrl}`,
      `- Fetched for the query: \`${r.query}\``,
      ...(r.description ? [`- ${r.description}`] : []),
      '',
    ]),
  ].join('\n');
}

/**
 * The prompt block for the art director.
 *
 * Deliberately short and deliberately subordinate. The three sentences that carry
 * the whole policy are the last three: mechanics still come from the motion pack,
 * brand identity outranks anything seen here, and a reference is only worth
 * citing if it changed a decision. Without them a corpus that skews towards SaaS
 * landing pages would quietly pull every salon towards a SaaS landing page — the
 * exact "всі демо в одному стилі" failure the brand block exists to prevent.
 */
export function renderGalleryBlock(refs: DownloadedRef[]): string {
  if (refs.length === 0) return '';
  return [
    '### Additional layout references (landing.gallery)',
    '',
    'Alongside the motion pack, these current, hand-curated landing pages were fetched for',
    'this business. They are OPTIONAL and SECONDARY — a wider sample of how pages are being',
    'composed right now, not a curated pack with written mechanics:',
    '',
    ...refs.map((r) => `- **${r.title}**${r.builder ? ` — built with ${r.builder}` : ''} — ${r.sourceUrl}`
      + `${r.description ? `\n  ${r.description.slice(0, 180)}` : ''}\n  (surfaced by the query \`${r.query}\`)`),
    '',
    'How to use them:',
    '',
    '- They may suggest LAYOUT and MOOD — section rhythm, how type and image sit together, crop language.',
    '- **Motion mechanics still come from the motion pack.** These are still screenshots; nothing',
    '  here tells you what a page DOES, and `referenceSlug` must still be a motion-pack slug.',
    '- **The business\'s own measured identity outranks every one of these.** Never take a colour',
    '  from one. This corpus skews towards SaaS and design studios; borrowing its palette or its',
    '  register is precisely how a local salon ends up looking like a startup.',
    '- If one of them genuinely shaped a direction, put its URL in `galleryRefs` and say what you',
    '  took in the direction\'s own words. Citing one you did not use is worse than citing none.',
  ].join('\n');
}
