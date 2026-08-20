/**
 * Proxy for evidence objects (assets, audit screenshots).
 *
 * Storage is private — MinIO is not exposed and demo assets are
 * `private_demo_only` (SPEC §8). Rather than hand out signed URLs, the UI
 * streams objects through this authenticated route (middleware already
 * rejected unauthenticated requests).
 *
 * Only keys that actually appear in the DB are servable, so a crafted `key`
 * cannot walk the bucket or the filesystem.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { eq, or, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Bucket = 'raw' | 'assets';

async function keyIsKnown(bucket: Bucket, key: string): Promise<boolean> {
  if (bucket === 'assets') {
    const [row] = await db.select({ id: schema.assets.id }).from(schema.assets)
      .where(eq(schema.assets.objectKey, key)).limit(1);
    if (row) return true;
  }
  // Audit screenshots and QA reports live in raw.
  const [audit] = await db.select({ id: schema.websiteAudits.id }).from(schema.websiteAudits)
    .where(or(
      eq(schema.websiteAudits.desktopScreenshotKey, key),
      eq(schema.websiteAudits.desktopFullScreenshotKey, key),
      eq(schema.websiteAudits.mobileScreenshotKey, key),
    )).limit(1);
  if (audit) return true;

  // Phase-C build artefacts: QA screenshots + reports (one per iteration),
  // and the frozen snapshot the site was built from. The jsonb columns hold
  // arrays, so membership is checked inside the array, not by equality.
  const [project] = await db.select({ id: schema.siteProjects.id }).from(schema.siteProjects)
    .where(or(
      eq(schema.siteProjects.qaReportKey, key),
      eq(schema.siteProjects.snapshotKey, key),
      eq(schema.siteProjects.contentBriefKey, key),
      eq(schema.siteProjects.designContractKey, key),
      sql`${schema.siteProjects.screenshotKeys} ? ${key}`,
      sql`${schema.siteProjects.qaReportKeys} ? ${key}`,
    )).limit(1);
  if (project) return true;

  if (await isKnownQaIterationKey(key)) return true;

  const [src] = await db.select({ id: schema.businessSources.id }).from(schema.businessSources)
    .where(eq(schema.businessSources.rawObjectKey, key)).limit(1);
  return Boolean(src);
}

/**
 * Screenshots of an OLDER QA iteration.
 *
 * `site_projects.screenshotKeys` holds only the newest iteration, so every shot
 * from `qa-0` / `qa-1` was rejected here and the historical QA report rendered
 * as 14 broken images (audit 2026-08-20, P0-5). The keys ARE referenced — from
 * inside the iteration's report JSON — but reading and parsing every report on
 * each image request would make one report page do N object fetches.
 *
 * The rule instead is derived from a key already proven to be in the DB:
 *
 *   a key is servable iff it lives under the SAME `sites/<businessId>/qa-<n>/`
 *   directory as a report key listed in that project's `qaReportKeys`.
 *
 * That prefix is written by the build pipeline (`src/workers/visualQa.ts`) and
 * contains nothing but that iteration's own artefacts, so this widens the
 * allowlist by exactly the set of objects the report page links to — not by a
 * bucket, not by a wildcard, and never across businesses.
 *
 * The pattern is deliberately charset-restricted rather than `[^/]+`: the
 * matched prefix is interpolated into a SQL LIKE, and `%` / `_` inside a
 * business id would turn that LIKE into a wildcard match across other
 * businesses' iterations. Only `[A-Za-z0-9._-]` is allowed, so the prefix
 * carries no LIKE metacharacter and `..` cannot form a traversal either.
 */
const QA_ITERATION_KEY_RE = /^(sites\/[A-Za-z0-9][A-Za-z0-9.-]*\/qa-\d+)\/[A-Za-z0-9][A-Za-z0-9.-]*\/[A-Za-z0-9][A-Za-z0-9.-]*$/;

async function isKnownQaIterationKey(key: string): Promise<boolean> {
  const m = QA_ITERATION_KEY_RE.exec(key);
  if (!m) return false;
  const prefix = `${m[1]}/`;
  // Anchored LIKE on the report keys of the SAME iteration directory: proves
  // some report in that exact directory is registered on a project row.
  const [row] = await db.select({ id: schema.siteProjects.id }).from(schema.siteProjects)
    .where(sql`exists (
      select 1 from jsonb_array_elements_text(${schema.siteProjects.qaReportKeys}) as k(v)
      where k.v like ${`${prefix}%`}
    )`)
    .limit(1);
  return Boolean(row);
}

const EXT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.json': 'application/json',
};

/**
 * Content type from MAGIC BYTES first, extension second.
 *
 * Storage keys are content-addressed and mostly extensionless
 * (`audits/<biz>/desktop/<ts>-<hash>`), so extension-only detection labelled
 * real screenshots `application/octet-stream` — which, combined with the
 * `nosniff` header below, stops the browser rendering them at all.
 * Sniffing the bytes is also the safer order: it cannot be steered by a
 * misleading key name.
 */
function detectContentType(body: Uint8Array, key: string): string {
  const b = body;
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);

  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  // ISO-BMFF: 'ftyp' at offset 4 (mp4 and friends)
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4';

  const ext = path.extname(key).toLowerCase();
  if (EXT_TYPES[ext]) return EXT_TYPES[ext];

  // Unknown bytes stay opaque: never guess a renderable/executable type.
  return 'application/octet-stream';
}

/**
 * SVG is an executable document, not just an image: it can carry <script> and
 * event handlers. Every asset here was scraped from a business's own website
 * (`rights: private_demo_only`), so it is untrusted input — serving one inline
 * on this origin would run attacker script inside Roman's authenticated
 * session (stored XSS). SVGs are therefore forced to download instead of
 * render. Raster/video assets are unaffected.
 *
 * Detection is by CONTENT as well as extension: an SVG hiding behind a `.png`
 * key must not slip through, and with `nosniff` set the browser will refuse to
 * render it as an image anyway.
 */
function isSvg(body: Uint8Array, key: string): boolean {
  if (path.extname(key).toLowerCase() === '.svg') return true;
  // Look for "<svg" within the leading bytes (allowing XML prolog/whitespace).
  const head = Buffer.from(body.slice(0, 512)).toString('utf8').toLowerCase();
  return head.includes('<svg');
}

/**
 * Captured evidence — a scraped Facebook page, a site's HTML, a gosom CSV.
 *
 * These are the objects behind the «доказ» links on the Факти tab (audit
 * 2026-08-20, P1-5): the immutable capture a fact was extracted from. They are
 * extensionless and content-addressed, so `detectContentType` finds no magic
 * bytes and no extension and correctly falls through to
 * `application/octet-stream` — which, with `nosniff`, makes the browser
 * DOWNLOAD the evidence instead of showing it. Roman clicks "show me the proof"
 * and gets a file in his Downloads folder.
 *
 * They are NOT served as `text/html`. This is third-party HTML scraped from a
 * page we do not control, and the file already establishes the rule for that
 * class of input one function above: an untrusted executable document is never
 * rendered inline on the authenticated origin. The `sandbox` CSP would very
 * probably contain it, but "one header stands between a scraped page and
 * Roman's session" is a worse position than not rendering it as a document at
 * all, and the evidence value here is in READING THE SOURCE, not in seeing
 * Facebook's layout reproduced.
 *
 * So captured evidence is served as `text/plain; charset=utf-8`: the operator
 * sees the actual captured bytes in a tab — which is what "what was this fact
 * extracted from?" really asks — and no markup in it is ever a document.
 *
 * This covers the CSV captures too (the gosom discovery rows). Those carry no
 * script risk at all, but they were downloading for the same reason — no magic
 * bytes, no extension — and a spreadsheet landing in Downloads is no better an
 * answer to "show me the proof" than a saved web page is.
 *
 * The test is "does this decode as text", not "does it look like HTML": the
 * decision is only ever between `text/plain` and a download, so the failure
 * mode of a false positive is a binary rendered as mojibake, not a security
 * boundary crossed.
 *
 * It is a RATIO, not a purity check, because real captured evidence is not
 * clean. The first Facebook capture measured here carries a genuinely
 * malformed byte mid-document (it cuts `αγάπη` short — the same corruption the
 * audit surfaced as P2-11), so "reject anything containing U+FFFD" would send
 * every Greek capture in the system back to downloading. Measured on real
 * objects the two populations are nowhere near each other: captured HTML scores
 * 0.05% replacement characters, an equivalent span of binary scores 50%. A 5%
 * threshold sits two orders of magnitude clear of both.
 */
const MAX_REPLACEMENT_RATIO = 0.05;

function isCapturedText(body: Uint8Array, key: string): boolean {
  if (path.extname(key).toLowerCase()) return false; // real extensions keep their own handling
  const sample = body.slice(0, 2048);
  if (!sample.length) return false;
  if (sample.some((b) => b === 0)) return false; // NUL => binary, never text
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  if (!decoded.length) return false;
  let bad = 0;
  for (const ch of decoded) if (ch === '\uFFFD') bad++;
  return bad / decoded.length <= MAX_REPLACEMENT_RATIO;
}


export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const bucket = (req.nextUrl.searchParams.get('bucket') ?? 'assets') as Bucket;
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  if (bucket !== 'raw' && bucket !== 'assets') {
    return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
  }
  if (!(await keyIsKnown(bucket, key))) {
    return NextResponse.json({ error: 'unknown object' }, { status: 404 });
  }

  try {
    const body = await fetchObject(bucket, key);
    const svg = isSvg(body, key);
    // Order matters: the SVG rule wins, because an `.svg` key is markup we
    // specifically refuse to serve inline at all.
    const captured = !svg && isCapturedText(body, key);
    const headers: Record<string, string> = {
      // An SVG is always labelled as SVG, never as the image type its key claims.
      // Captured third-party markup is labelled text, so it is readable but
      // never a document. Everything else is sniffed.
      'content-type': svg
        ? 'image/svg+xml'
        : captured ? 'text/plain; charset=utf-8' : detectContentType(body, key),
      'cache-control': 'private, max-age=300',
      'x-robots-tag': 'noindex, nofollow',
      // Defence in depth for EVERY object, not just SVG: even if a payload is
      // somehow interpreted as a document, it can load nothing, call nothing
      // and reach nowhere. `sandbox` (no allow-scripts) kills script execution;
      // default-src 'none' kills every fetch/subresource.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // Stop content-type sniffing from turning a mislabelled object into HTML.
      'x-content-type-options': 'nosniff',
    };
    if (svg) {
      // Never render an untrusted SVG inline on the app origin.
      const base = path.basename(key).replace(/[^\w.\-]/g, '_') || 'asset';
      const filename = base.toLowerCase().endsWith('.svg') ? base : `${base}.svg`;
      headers['content-disposition'] = `attachment; filename="${filename}"`;
    }
    return new NextResponse(body as BodyInit, { headers });
  } catch (err) {
    return NextResponse.json({ error: 'object unavailable', detail: String(err) }, { status: 404 });
  }
}

async function fetchObject(bucket: Bucket, key: string): Promise<Uint8Array> {
  // Mirrors src/lib/storage.ts: STORAGE_MODE picks the driver.
  if ((process.env.STORAGE_MODE ?? 's3') === 'fs') {
    const root = path.resolve(process.env.STORAGE_DIR ?? 'storage');
    const target = path.resolve(root, bucket, key);
    if (!target.startsWith(root)) throw new Error('bad key');
    return new Uint8Array(await readFile(target));
  }
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'factory',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'factorysecret',
    },
  });
  const res = await s3.send(new GetObjectCommand({
    Bucket: bucket === 'raw'
      ? (process.env.S3_BUCKET_RAW ?? 'factory-raw')
      : (process.env.S3_BUCKET_ASSETS ?? 'factory-assets'),
    Key: key,
  }));
  return res.Body!.transformToByteArray();
}
