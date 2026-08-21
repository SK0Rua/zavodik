/**
 * Tests for the landing.gallery inspiration client (`src/lib/landingGallery.ts`).
 *
 * The offline half runs against `scripts/fixtures/landing-gallery-search.sse`,
 * which is a REAL captured response (query `editorial`, limit 3) with only the
 * base64 `image` blocks stripped — those are ~55KB each and we never read them.
 * Capturing rather than inventing matters here because the two things most likely
 * to break this client are transport details nobody would guess: the endpoint
 * answers SSE for a single JSON-RPC response, and the useful payload is in
 * `structuredContent` rather than in the text blocks a naive reader would take.
 *
 * The live half makes one real HTTPS call. It needs no docker and no database.
 * A network failure SKIPS rather than fails: this suite must stay runnable on a
 * laptop with no connectivity, and the client's own contract is that the endpoint
 * being down is a normal outcome.
 *
 *   pnpm tsx scripts/test-landing-gallery.ts
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildQueries, downloadRefs, entriesFromResponse, parseSseJson,
  renderGalleryBlock, renderIndexMd, searchInspiration,
  type DownloadedRef, type GalleryEntry,
} from '../src/lib/landingGallery.js';

let failures = 0;
let skipped = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const FIXTURE = readFileSync(
  path.resolve('scripts/fixtures/landing-gallery-search.sse'), 'utf8',
);

// ─── SSE framing ─────────────────────────────────────────────────────────────

console.log('\nSSE parsing');
{
  const parsed = parseSseJson(FIXTURE) as { result?: unknown; jsonrpc?: string };
  check('captured SSE body yields a JSON-RPC result', !!parsed?.result);

  check(
    'a plain application/json body still parses (transport fallback)',
    (parseSseJson('{"result":{"ok":true}}') as { result?: { ok?: boolean } })?.result?.ok === true,
  );

  check('a body with no data: frames and no JSON is null, not a throw', parseSseJson('garbage') === null);

  // A streaming server may emit progress notifications before the answer. The
  // LAST frame carrying a result is the response; taking the first would return
  // a notification with no results at all.
  const multi = 'event: message\ndata: {"method":"notifications/progress"}\n\n'
    + 'event: message\ndata: {"result":{"marker":2}}\n\n';
  check(
    'the last result-bearing frame wins over an earlier notification',
    ((parseSseJson(multi) as { result?: { marker?: number } })?.result?.marker) === 2,
  );

  check('[DONE] sentinel frames are ignored', parseSseJson('data: [DONE]\n\n') === null);
}

// ─── Result mapping ──────────────────────────────────────────────────────────

console.log('\nResult mapping');
const entries = entriesFromResponse(parseSseJson(FIXTURE), 'editorial');
{
  check('fixture yields entries', entries.length === 3, `got ${entries.length}`);
  const first = entries[0]!;
  check('title read', first.title === 'Yolanta Birkhane Studio', first.title);
  check('sourceUrl is the real site, not the gallery page',
    first.sourceUrl === 'https://www.yolantabirkhane.com/', first.sourceUrl);
  check('previewUrl points at the CDN', first.previewUrl.startsWith('https://imagedelivery.net/'));
  check('builder read from pagebuilder.name', first.builder === 'Squarespace', String(first.builder));
  check('query is carried as the why-fetched note', first.query === 'editorial');
  check('every entry has the three load-bearing fields',
    entries.every((e) => e.title && e.previewUrl && e.sourceUrl));

  // The corpus is third-party data; a row missing a screenshot must be dropped,
  // never half-built into an entry that cites a file we cannot download.
  const partial = {
    result: { structuredContent: { results: [
      { name: 'No screenshot', screenshot: null },
      { name: 'No source', screenshot: { previewUrl: 'https://x.test/a.jpg' } },
      { screenshot: { previewUrl: 'https://x.test/b.jpg', sourcePageUrl: 'https://y.test/' } },
    ] } },
  };
  check('rows missing title/preview/source are dropped', entriesFromResponse(partial, 'q').length === 0);

  check('a non-array results field yields []',
    entriesFromResponse({ result: { structuredContent: { results: 'nope' } } }, 'q').length === 0);
  check('an error response yields []', entriesFromResponse({ error: { code: -32601 } }, 'q').length === 0);
  check('null yields []', entriesFromResponse(null, 'q').length === 0);
}

// ─── Query building ──────────────────────────────────────────────────────────

console.log('\nQuery building');
{
  // Measured against the live endpoint: multi-word queries AND their terms and
  // return nothing ("hair salon" → 0, "beauty studio" → 0). Single words only.
  const q = buildQueries({ category: 'Hair salon', moodWords: ['warm editorial', 'calm'] });
  check('single words only, never a phrase', q.every((w) => !w.includes(' ')), q.join('|'));
  check('mood words come before category words', q[0] === 'warm', q.join(','));
  check('words shorter than 4 chars are dropped ("calm" kept, nothing shorter)',
    q.every((w) => w.length >= 4), q.join(','));
  check('capped at 3 by default', q.length <= 3, String(q.length));

  const empty = buildQueries({ category: null, moodWords: null });
  check('a business with no category and no mood still gets the "design" floor',
    empty.length === 1 && empty[0] === 'design', empty.join(','));

  const deduped = buildQueries({ category: 'salon', moodWords: ['salon', 'salon'] }, 5);
  check('duplicate words appear once', deduped.filter((w) => w === 'salon').length === 1);

  check('punctuation and digits are stripped out of a word',
    buildQueries({ category: 'Beauty-Studio 24', moodWords: null }, 5).includes('beauty'));
}

// ─── Rendering ───────────────────────────────────────────────────────────────

console.log('\nPrompt and index rendering');
{
  const refs: DownloadedRef[] = entries.map((e, i) => ({ ...e, file: `references/gallery/${i + 1}.webp` }));

  const block = renderGalleryBlock(refs);
  check('block names every reference', refs.every((r) => block.includes(r.title)));
  check('block cites the source URLs', block.includes(refs[0]!.sourceUrl));
  // These three sentences are the whole policy: without them a SaaS-skewed corpus
  // quietly drags every local salon towards a SaaS landing page.
  check('block subordinates motion to the motion pack', block.includes('motion pack'));
  check('block forbids taking a colour', /[Nn]ever take a colour/.test(block));
  check('block says brand identity outranks the references', block.includes('outranks'));
  check('block names the galleryRefs citation field', block.includes('galleryRefs'));
  check('no refs = empty string, so the prompt is unchanged when the feature is off',
    renderGalleryBlock([]) === '');

  const index = renderIndexMd(refs);
  check('index.md records each file path', refs.every((r) => index.includes(r.file)));
  check('index.md records the query that surfaced each entry', index.includes('`editorial`'));
  check('index.md carries the do-not-copy rule', /[Nn]ever copy a colour/.test(index));
}

// ─── Downloading (guarded, offline) ──────────────────────────────────────────

console.log('\nDownload guard');
{
  const dir = await mkdtemp(path.join(tmpdir(), 'lg-test-'));
  try {
    // These previews come from a third party and the workers sit inside the
    // compose network. A private-address preview must be refused by safeFetch,
    // and the entry dropped rather than half-recorded.
    const hostile: GalleryEntry[] = [{
      title: 'SSRF attempt', description: null,
      sourceUrl: 'https://example.test/', galleryUrl: 'https://example.test/',
      previewUrl: 'http://169.254.169.254/latest/meta-data/',
      fullScreenshotUrl: 'http://169.254.169.254/', builder: null, framework: null, query: 'x',
    }];
    const saved = await downloadRefs(dir, hostile);
    check('a link-local preview URL is blocked and the entry dropped', saved.length === 0);
    check('no index.md is written when nothing downloaded',
      await readFile(path.join(dir, 'index.md'), 'utf8').then(() => false, () => true));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ─── Live call ───────────────────────────────────────────────────────────────

console.log('\nLive endpoint (skips on network failure)');
{
  // `editorial` rather than a business-shaped phrase: the corpus is full-text and
  // SaaS-skewed, so a realistic niche query is a legitimate 0 and would make this
  // check flap. What is being verified is the transport, not the corpus.
  const live = await searchInspiration(['editorial'], { limit: 2, timeoutMs: 12_000 })
    .catch(() => [] as GalleryEntry[]);

  if (live.length === 0) {
    skipped++;
    console.log('  skip live search_inspiration — no results (offline, or the endpoint changed)');
  } else {
    check('live call returns usable entries', live.length > 0 && live.length <= 2);
    check('live entries carry a downloadable preview URL',
      live.every((e) => /^https:\/\//.test(e.previewUrl)));
    check('live entries carry a citable source URL',
      live.every((e) => /^https?:\/\//.test(e.sourceUrl)));
    check('live entries are deduped by source URL',
      new Set(live.map((e) => e.sourceUrl)).size === live.length);
    console.log(`       live sample: ${live.map((e) => e.title).join(' | ')}`);

    const dir = await mkdtemp(path.join(tmpdir(), 'lg-live-'));
    try {
      const saved = await downloadRefs(dir, live.slice(0, 1));
      if (saved.length === 0) {
        skipped++;
        console.log('  skip live preview download — CDN unreachable');
      } else {
        check('live preview lands on disk with a workspace-relative path',
          saved[0]!.file.startsWith('references/gallery/'), saved[0]!.file);
        const bytes = await readFile(path.join(dir, path.basename(saved[0]!.file)));
        check('downloaded preview is a non-trivial image', bytes.length > 1000, `${bytes.length} bytes`);
        check('index.md written next to it',
          (await readFile(path.join(dir, 'index.md'), 'utf8')).includes(saved[0]!.title));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

// ─── Workspace plumbing ──────────────────────────────────────────────────────

/**
 * Stage 9 stages the previews under `sites/<businessId>/gallery/` and
 * `prepareWorkspace` copies them to `references/gallery/` in the build. The full
 * `prepareWorkspace` needs Postgres and MinIO, so what is checked here is the one
 * thing that can silently break without either: that the two halves agree on the
 * staging path. A mismatch would fail open — no gallery in the workspace, no
 * error anywhere — which is exactly the kind of bug a test has to catch.
 */
console.log('\nWorkspace plumbing');
{
  const { galleryStagingDir } = await import('../src/workers/contentDesign.js');
  const staged = galleryStagingDir('e2e-fixture-biz');
  check('staging dir is keyed by business, under sites/',
    staged.endsWith(path.join('sites', 'e2e-fixture-biz', 'gallery')), staged);

  // `copyGalleryReferences` is module-private; the contract it must honour is the
  // literal path above, so the check is that the workspace module reads the same
  // one. Read as source rather than called, since calling it means a DB.
  const workspaceSrc = await readFile(path.resolve('src/build/workspace.ts'), 'utf8');
  check('workspace copies from SITES_ROOT/<businessId>/gallery',
    /path\.join\(SITES_ROOT,\s*businessId,\s*'gallery'\)/.test(workspaceSrc));
  check('workspace writes them to references/gallery',
    /path\.join\(target,\s*'references',\s*'gallery'\)/.test(workspaceSrc));
  check('BUILD-TASK.md tells the builder not to take colour from them',
    /Never take a colour, a photograph or a line of\s*\ncopy from them/.test(workspaceSrc));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s), ${skipped} skipped\n`);
process.exit(failures === 0 ? 0 : 1);
