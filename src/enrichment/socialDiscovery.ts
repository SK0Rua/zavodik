/**
 * Social discovery (spec §4 stage 4, extending the messenger detection).
 *
 * WHY THIS EXISTS. Until now social profiles came from exactly two places: the
 * gosom `website` field and links found on the business's own website. Roman
 * checked the real Patras run and found the gap: "exte hair design" has both a
 * Facebook page and an Instagram profile, and the factory had neither — its
 * only contact was a phone from Google Maps. In Patras most beauty businesses
 * are reachable on Instagram, and decision #8 puts messengers before email, so
 * a missing Instagram handle is a missing outreach channel.
 *
 * WHAT IT DOES. Keyless web search (no API keys, no pay-per-call) via Playwright
 * against public SERP pages, then verification of every candidate against the
 * profile's OWN captured page:
 *
 *   1. run a small set of queries per business (Greek + Latin, plain + site:);
 *   2. store each SERP page as immutable raw evidence (`source_type='search'`);
 *   3. extract candidate profile URLs from the results;
 *   4. capture each candidate profile page as raw evidence;
 *   5. score it deterministically in code (`socialMatch.ts`) — never by an LLM;
 *   6. strong => a verified contact; medium => an unverified candidate for
 *      Roman to confirm; weak => evidence kept, no contact written.
 *
 * INVARIANTS. A handle is never synthesised: every candidate comes from a link
 * in a captured SERP, and no contact row exists without a captured profile page
 * whose `business_sources.id` is its `source_id`. A failure here is a warning
 * plus a `socials_unresolved` gap — never a failed enrichment job.
 */
import type { Browser, Page } from 'playwright';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { log } from '../lib/logger.js';
import { config } from '../config.js';
import { launchBrowser, newCapturePage } from './capture.js';
import { detectContacts, cleanProfileUrl } from './messengers.js';
import { scoreProfileMatch, type MatchVerdict, type SocialPlatform } from './socialMatch.js';

export interface SocialTargetBusiness {
  id: string;
  name: string;
  city: string;
  phone?: string | null;
  normalizedPhone?: string | null;
  address?: string | null;
  domain?: string | null;
  websiteUrl?: string | null;
  category?: string | null;
}

export interface SocialCandidate {
  platform: SocialPlatform;
  /** Canonical profile URL (no query string, no trailing slash). */
  url: string;
  handle: string;
  /**
   * Stable identity when the platform exposes one, used for deduplication.
   * Facebook publishes the same page as `/p/<Slug>-<id>` and `/<id>`; without
   * this both forms would become separate contacts for one page.
   */
  identity?: string;
  /** Which SERP(s) produced it, for the report. */
  foundVia: string[];
}

export interface VerifiedProfile extends SocialCandidate {
  verdict: MatchVerdict;
  /** business_sources.id of the captured profile page. */
  sourceId: number;
  rawObjectKey: string;
  title: string;
  bio: string;
  /** Messenger markers detected in the profile bio, with their source. */
  messengers: Array<{ channel: string; value: string; evidence: string }>;
}

export interface SocialDiscoveryResult {
  businessId: string;
  /** SERP pages successfully captured. */
  serpsCaptured: number;
  /** SERP pages that failed / were rate-limited. */
  serpsFailed: number;
  candidates: SocialCandidate[];
  profiles: VerifiedProfile[];
  /** Contacts actually inserted (channel:value). */
  contactsWritten: Array<{ channel: string; value: string; verified: boolean; sourceId: number }>;
  /** Set when nothing usable could be established. */
  gap: string | null;
  notes: string[];
}

// ── search engines ──────────────────────────────────────────────────────────
//
// Keyless SERP endpoints, tried in order until enough candidates are found.
// DuckDuckGo's HTML/lite endpoints answer 403 to datacenter and many residential
// IPs (verified on this machine, 2026-08-16), so they are LAST, not first:
// keeping them in the list costs one cheap request when the others are blocked
// and nothing when they are not.
interface Engine {
  name: string;
  url: (q: string) => string;
  /** Some engines wrap outbound links in a redirector; this unwraps them. */
  unwrap?: (href: string) => string | null;
}

/**
 * Bing puts every result behind `/ck/a?...&u=a1<base64url>`, so the raw href
 * never contains the destination. Decoding is what makes Bing results usable
 * at all.
 */
function unwrapBing(href: string): string | null {
  try {
    const u = new URL(href);
    if (!/(^|\.)bing\.com$/.test(u.hostname) || !u.pathname.startsWith('/ck/a')) return null;
    const raw = u.searchParams.get('u');
    if (!raw || !raw.startsWith('a1')) return null;
    let b64 = raw.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    return decoded.startsWith('http') ? decoded : null;
  } catch {
    return null;
  }
}

/** DuckDuckGo HTML results point at `/l/?uddg=<encoded>`. */
function unwrapDdg(href: string): string | null {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (!/duckduckgo\.com$/.test(u.hostname.replace(/^www\./, ''))) return null;
    const target = u.searchParams.get('uddg');
    return target && target.startsWith('http') ? target : null;
  } catch {
    return null;
  }
}

const ENGINES: Engine[] = [
  { name: 'brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  { name: 'startpage', url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  { name: 'bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`, unwrap: unwrapBing },
  { name: 'duckduckgo', url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, unwrap: unwrapDdg },
];

/**
 * Queries per business. Both alphabets, because a Greek salon's name may be
 * written either way and the engines do not transliterate for us. `site:`
 * variants are what actually surface profile pages rather than news articles.
 */
export function buildQueries(biz: SocialTargetBusiness): string[] {
  // Quotes are removed (they would break the phrase query) but `|` is KEPT for
  // now: it is the separator Greek listings use between the trading name and
  // the trade description, and `core` below needs to split on it.
  const name = biz.name.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * The searchable core of a long listing name.
   *
   * A Greek listing name is often a full trade description — "Ινστιτούτο
   * Αισθητικής Ιώ Νικολάου-Γεωργίου Ρένα", "Female Secrets | Κέντρο Υγείας
   * Δέρματος". Quoting the WHOLE thing is an exact-phrase search that matches
   * nothing, because no profile writes its name that way: three businesses on
   * the real run returned zero candidates for exactly this reason, and the
   * naive 48-char truncation made it worse by cutting mid-word and leaving a
   * dangling separator.
   *
   * So the phrase is cut at the first separator and capped at four words —
   * the part a business actually puts on its Instagram.
   */
  const core = (name
    .split(/\s*[-–—/|,]\s*/)[0]
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
    .replace(/[-–—/|,]+$/, '')
    .trim() || name).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  const full = name.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

  const queries = [
    `"${core}" Πάτρα instagram`,
    `"${core}" patras facebook`,
    `site:instagram.com "${core}"`,
    `site:facebook.com "${core}" ${biz.city}`,
  ];
  // When the core had to drop words, one unquoted query keeps a path to the
  // full name without demanding an exact phrase match.
  if (core !== full) queries.push(`${core} ${biz.city} instagram facebook`);
  return queries;
}

// ── SERP link extraction ────────────────────────────────────────────────────

/**
 * Handles/pages belonging to a platform or a search engine, never to a business.
 * `messengers.ts` has its own list for page chrome; this one additionally covers
 * the SERP hosts themselves, which appear in every result page's footer
 * ("startpagesearch", "brave"). Without it, every business would "find" the
 * search engine's own Facebook page.
 */
const NON_BUSINESS_HANDLES = new Set([
  'startpage', 'startpagesearch', 'brave', 'bravesoftware', 'duckduckgo', 'bing', 'microsoft',
  'google', 'yahoo', 'mojeek', 'ecosia', 'qwant',
  'instagram', 'facebook', 'meta', 'tiktok', 'whatsapp', 'youtube', 'twitter', 'x',
  'treatwell', 'treatwellgr', 'booksy', 'fresha', 'easyrantevou', 'linktree', 'wix', 'wordpress',
  'shopify', 'squarespace', 'godaddy', 'yelp', 'tripadvisor', 'foursquare', 'explore',
]);

/**
 * Instagram path segments that are NOT profiles.
 *
 * `p` and `reel` matter most: a search for a salon returns posts by *other*
 * accounts that tagged it. Verified on the real run — searching "exte hair
 * design patras instagram" returns `instagram.com/p/DbvxZI-MCaK/`, a post
 * belonging to `beauty.volos`, a business in a different city entirely. Treating
 * a post URL as a profile would have produced a confident false positive.
 */
const IG_NON_PROFILE = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'directory',
  'about', 'developer', 'legal', 'privacy', 'terms', 'blog', 'press', 'api', 'web', '_u', '_n', 'share', 'locations',
]);
const FB_NON_PROFILE = new Set([
  'sharer', 'sharer.php', 'share', 'plugins', 'dialog', 'login', 'help', 'policies',
  'privacy', 'legal', 'terms', 'watch', 'groups', 'events', 'marketplace', 'gaming',
  'photo.php', 'photo', 'permalink.php', 'story.php', 'tr', 'business', 'ads', 'pages',
  'search', 'hashtag', 'media', 'notes', 'l.php', 'profile.php',
]);

/**
 * Turns one SERP link into a profile candidate, or null.
 *
 * Facebook's `/p/<Slug>-<numericId>/` form is the modern public page URL and is
 * kept as-is: the numeric id is the page's identity, and rewriting it to the
 * slug alone would 404.
 */
export function parseProfileUrl(href: string): SocialCandidate | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|m|web|l|mobile)\./, '').toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (segments.length === 0) return null;
  const first = segments[0].replace(/^@/, '').toLowerCase();

  const reject = (h: string) => NON_BUSINESS_HANDLES.has(h) || h.length < 2 || /^[._-]+$/.test(h) || !/[a-z0-9]/i.test(h);

  if (host === 'instagram.com') {
    if (IG_NON_PROFILE.has(first) || reject(first)) return null;
    // A profile URL is a single segment (a trailing /reels/ or /tagged/ is still
    // the same profile, so deeper paths are truncated rather than rejected).
    if (!/^[a-z0-9._]{2,40}$/.test(first)) return null;
    return { platform: 'instagram', url: `https://www.instagram.com/${first}`, handle: first, foundVia: [] };
  }
  if (host === 'facebook.com' || host === 'fb.com') {
    if (/^v\d+(\.\d+)?$/.test(first)) return null;         // JS-SDK version segment
    if (FB_NON_PROFILE.has(first) || first.endsWith('.php')) return null;
    // /p/<Slug>-<id>/ — the current public page form
    if (first === 'p' && segments[1]) {
      const slug = segments[1];
      if (reject(slug.toLowerCase())) return null;
      // `/p/Exte-Hair-Design-100063552791835` and the bare `/100063552791835`
      // are the SAME page and both appear in one SERP. Keying on the numeric id
      // collapses them, so a business gets one Facebook contact rather than two
      // rows pointing at the same page (observed on the first real run).
      const numericId = slug.match(/-(\d{8,})$/)?.[1];
      return {
        platform: 'facebook',
        url: `https://www.facebook.com/p/${slug}`,
        handle: slug.replace(/-\d{6,}$/, '').replace(/-/g, ' ').toLowerCase(),
        identity: numericId ? `facebook:${numericId}` : undefined,
        foundVia: [],
      };
    }
    // A bare numeric path is a page id; same identity as the /p/ form above.
    if (/^\d{8,}$/.test(first)) {
      return {
        platform: 'facebook',
        url: `https://www.facebook.com/${first}`,
        handle: first,
        identity: `facebook:${first}`,
        foundVia: [],
      };
    }
    if (reject(first)) return null;
    if (!/^[a-z0-9._-]{2,60}$/.test(first)) return null;
    return { platform: 'facebook', url: `https://www.facebook.com/${first}`, handle: first, foundVia: [] };
  }
  if (host === 'tiktok.com') {
    const at = segments.find((s) => s.startsWith('@'));
    if (!at) return null;
    const handle = at.slice(1).toLowerCase();
    if (reject(handle) || !/^[a-z0-9._]{2,40}$/.test(handle)) return null;
    return { platform: 'tiktok', url: `https://www.tiktok.com/@${handle}`, handle, foundVia: [] };
  }
  return null;
}

/** All hrefs on the current page, with engine redirectors already unwrapped. */
const SERP_LINKS_JS = `(() => Array.prototype.slice.call(document.querySelectorAll('a[href]'))
  .map(function (a) { return a.href; })
  .filter(function (h) { return typeof h === 'string' && h.indexOf('http') === 0; })
  .slice(0, 400))()`;

/**
 * Adds a candidate, deduplicating on the platform identity when there is one
 * and on the canonical URL otherwise. Returns true when it was new.
 */
function addCandidate(byUrl: Map<string, SocialCandidate>, cand: SocialCandidate, via: string): boolean {
  const key = cand.identity ?? cand.url;
  const existing = byUrl.get(key);
  if (existing) {
    if (!existing.foundVia.includes(via)) existing.foundVia.push(via);
    return false;
  }
  cand.foundVia.push(via);
  byUrl.set(key, cand);
  return true;
}

/** `instagram.com/explore/locations/<id>/<slug>/` -> the canonical location URL. */
export function parseInstagramLocationUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.hostname.replace(/^www\./, '') !== 'instagram.com') return null;
    const m = u.pathname.match(/^\/explore\/locations\/(\d+)(?:\/([^/]+))?/);
    if (!m) return null;
    return `https://www.instagram.com/explore/locations/${m[1]}/${m[2] ? `${m[2]}/` : ''}`;
  } catch {
    return null;
  }
}

/**
 * Accounts that have posted from an Instagram location, most-recent first.
 *
 * The location page is only opened when its own title names the business —
 * Instagram creates location pages from Facebook places, so a location called
 * "Exte Hair Design" is about this business, while a generic one ("Patras,
 * Greece") would flood the candidate list with unrelated accounts.
 *
 * `nameSimilarity` is imported lazily by the caller; here the check is a direct
 * token overlap on the location title.
 */
async function harvestLocationAccounts(
  page: Page,
  locationUrl: string,
  businessName: string,
  timeoutMs: number,
): Promise<string[]> {
  try {
    const res = await page.goto(locationUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if ((res?.status() ?? 0) >= 400) return [];
    await page.waitForTimeout(3_000);
    const title = await page.evaluate(`document.title || ''`) as string;
    const { nameSimilarity } = await import('./socialMatch.js');
    // The location must be THIS business's place, not a generic city location.
    if (nameSimilarity(businessName, title, '') < 0.5) return [];
    const html = await page.content();
    // Accounts appear in the page's embedded JSON. Order is meaningful: the
    // profile that owns the venue is normally the first/top poster, so the list
    // is capped rather than taken whole.
    const handles: string[] = [];
    for (const m of html.matchAll(/"username"\s*:\s*"([A-Za-z0-9._]{2,40})"/g)) {
      const h = m[1].toLowerCase();
      if (!handles.includes(h) && !NON_BUSINESS_HANDLES.has(h)) handles.push(h);
      if (handles.length >= 12) break;
    }
    return handles;
  } catch {
    return [];
  }
}

// ── profile page reading ────────────────────────────────────────────────────

/**
 * The public surface of a social profile behind a login wall: og tags, the page
 * title, and whatever body text is rendered before the wall. Instagram and
 * Facebook both ship a real og:title/og:description for public profiles even
 * when the feed itself needs a login — that is exactly the evidence the matcher
 * needs (a bio containing a phone or an address).
 */
const PROFILE_META_JS = `(() => {
  function meta(n) {
    var el = document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]');
    return (el && el.content) || '';
  }
  var body = (document.body && document.body.innerText) || '';
  return {
    title: document.title || '',
    ogTitle: meta('og:title'),
    ogDescription: meta('og:description'),
    description: meta('description'),
    body: body.replace(/\\n{3,}/g, '\\n\\n').slice(0, 6000)
  };
})()`;

interface ProfileRead {
  title: string;
  bio: string;
  text: string;
  html: string;
  finalUrl: string;
  /** False when the platform served "profile unavailable" rather than a profile. */
  exists: boolean;
}

/**
 * "Profile isn't available" pages still answer HTTP 200 with a full app shell,
 * so status codes cannot be used. What distinguishes them is that a real public
 * profile always ships an og:title / a title naming the account, and a missing
 * one ships neither (verified against a deliberately nonexistent handle).
 */
const UNAVAILABLE_MARKERS = [
  "page isn't available", 'page isn’t available', 'δεν είναι διαθέσιμο', 'content isn’t available',
  'sorry, this page isn', 'δεν είναι διαθέσιμη', 'profile isn’t available', 'this page isn’t available',
];

function looksUnavailable(platform: SocialPlatform, read: { title: string; ogTitle: string; body: string }): boolean {
  const hay = `${read.title}\n${read.ogTitle}\n${read.body.slice(0, 1500)}`.toLowerCase();
  if (UNAVAILABLE_MARKERS.some((m) => hay.includes(m))) return true;
  // A real IG/FB profile names the account in og:title or <title>; the
  // unavailable stub carries an empty og:title and a generic title.
  if (platform === 'instagram') {
    if (!read.ogTitle && !/\(@[a-z0-9._]+\)/i.test(read.title)) return true;
  }
  if (platform === 'facebook') {
    if (!read.ogTitle && !/\|\s*facebook\s*$/i.test(read.title.trim())) return true;
  }
  return false;
}

async function readProfile(page: Page, url: string, platform: SocialPlatform, timeoutMs: number): Promise<ProfileRead | null> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const status = res?.status() ?? null;
  if (status !== null && status >= 400) return null;
  await page.waitForTimeout(2_500);
  const meta = await page.evaluate(PROFILE_META_JS) as {
    title: string; ogTitle: string; ogDescription: string; description: string; body: string;
  };
  const html = await page.content();
  return {
    title: [meta.ogTitle, meta.title].filter(Boolean).join(' | '),
    bio: [meta.ogDescription, meta.description].filter(Boolean).join('\n'),
    text: [meta.ogTitle, meta.ogDescription, meta.description, meta.body].filter(Boolean).join('\n'),
    html,
    finalUrl: page.url(),
    exists: !looksUnavailable(platform, meta),
  };
}

// ── evidence persistence ────────────────────────────────────────────────────

/**
 * Stores a page as immutable raw evidence and returns the `business_sources.id`
 * that every derived contact must cite. Mirrors `capture.ts` versioning: a
 * re-capture of the same URL is a new version, never an overwrite.
 */
async function storeEvidence(
  businessId: string,
  sourceType: string,
  url: string,
  html: string,
  prefix: string,
): Promise<{ sourceId: number; rawObjectKey: string }> {
  const rawObjectKey = await putRaw(`enrichment/${businessId}/${prefix}`, html, 'text/html');
  const previous = await db.select({ version: schema.businessSources.version })
    .from(schema.businessSources)
    .where(and(eq(schema.businessSources.businessId, businessId), eq(schema.businessSources.url, url)));
  const version = previous.reduce((max, p) => Math.max(max, p.version), 0) + 1;
  const [src] = await db.insert(schema.businessSources).values({
    businessId,
    sourceType,
    url,
    method: 'playwright',
    rawObjectKey,
    capturedAt: new Date(),
    version,
  }).returning();
  return { sourceId: src.id, rawObjectKey };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── main entry point ────────────────────────────────────────────────────────

export interface SocialDiscoveryOptions {
  /** Reuse an already-open browser (the enrich worker has one). */
  browser?: Browser;
  /** Skip platforms the business already has a verified contact for. */
  skipPlatforms?: SocialPlatform[];
  /** Write nothing to the DB; used to inspect scoring before it takes effect. */
  dryRun?: boolean;
}

/**
 * Runs the whole social discovery step for one business.
 *
 * Never throws for an ordinary failure (blocked engine, unreachable profile):
 * it returns a result whose `gap` explains what was missing, so the caller
 * records a gap and continues. Only a programming error propagates.
 */
export async function discoverSocials(
  biz: SocialTargetBusiness,
  opts: SocialDiscoveryOptions = {},
): Promise<SocialDiscoveryResult> {
  const cfg = config.socialDiscovery;
  const result: SocialDiscoveryResult = {
    businessId: biz.id,
    serpsCaptured: 0,
    serpsFailed: 0,
    candidates: [],
    profiles: [],
    contactsWritten: [],
    gap: null,
    notes: [],
  };

  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? await launchBrowser();
  const skip = new Set(opts.skipPlatforms ?? []);

  try {
    const page = await newCapturePage(browser);
    const queries = buildQueries(biz);
    const byUrl = new Map<string, SocialCandidate>();

    // ── 1-3: search, store the SERP, harvest candidate profile URLs ─────────
    //
    // Engines are tried in order per query, and an engine that answers 403 is
    // dropped for the rest of the run: retrying a rate-limited host on every
    // query wastes minutes and hardens the block.
    const deadEngines = new Set<string>();
    outer: for (const q of queries) {
      for (const engine of ENGINES) {
        if (deadEngines.has(engine.name)) continue;
        const serpUrl = engine.url(q);
        try {
          const res = await page.goto(serpUrl, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs });
          const status = res?.status() ?? 0;
          if (status === 403 || status === 429) {
            deadEngines.add(engine.name);
            result.serpsFailed++;
            result.notes.push(`${engine.name} refused (${status}) — engine dropped for this run`);
            continue;
          }
          await page.waitForTimeout(1_500);
          // Startpage and Bing both bounce the first request through a redirect
          // ("Unable to retrieve content because the page is navigating"), which
          // killed every query for one business on the real run and produced a
          // false `socials_unresolved`. Settling and retrying once turns a
          // transient redirect into a normal read.
          let html = '';
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              html = await page.content();
              break;
            } catch (err) {
              if (attempt === 1) throw err;
              await page.waitForLoadState('domcontentloaded', { timeout: cfg.timeoutMs }).catch(() => {});
              await page.waitForTimeout(2_000);
            }
          }
          if (html.length < 2_000) {
            result.serpsFailed++;
            result.notes.push(`${engine.name}: empty response for "${q}"`);
            continue;
          }

          const links = await page.evaluate(SERP_LINKS_JS) as string[];
          const resolved = links.map((h) => (engine.unwrap ? engine.unwrap(h) ?? h : h));
          const fresh: SocialCandidate[] = [];
          for (const href of resolved) {
            const cand = parseProfileUrl(href);
            if (!cand) continue;
            if (skip.has(cand.platform)) continue;
            if (addCandidate(byUrl, cand, `${engine.name}:${q}`)) fresh.push(cand);
          }

          // Instagram rarely surfaces a small business's PROFILE in a SERP, but
          // it does surface the place's location page. That page names the
          // accounts that posted from the venue — one of which is usually the
          // business itself (this is exactly how `@extehairdesign` was found,
          // after four profile-targeted queries returned nothing). The accounts
          // are only CANDIDATES: most are customers, and every one still has to
          // pass the same profile-page verification as any other candidate.
          if (!skip.has('instagram')) {
            for (const href of resolved) {
              const loc = parseInstagramLocationUrl(href);
              if (!loc) continue;
              for (const handle of await harvestLocationAccounts(page, loc, biz.name, cfg.timeoutMs)) {
                const cand: SocialCandidate = {
                  platform: 'instagram',
                  url: `https://www.instagram.com/${handle}`,
                  handle,
                  foundVia: [],
                };
                if (addCandidate(byUrl, cand, `ig-location:${loc}`)) fresh.push(cand);
              }
              await sleep(cfg.delayMs);
              break; // one location page per SERP is enough
            }
          }

          // The SERP is evidence for WHERE the candidates came from, so it is
          // stored whether or not it yielded any (a zero-result search is a
          // fact about the business too).
          if (!opts.dryRun) {
            await storeEvidence(biz.id, 'search', `${serpUrl}#${engine.name}`, html, `search/${engine.name}`);
          }
          result.serpsCaptured++;
          await sleep(cfg.delayMs);

          // One engine answering per query is enough; move to the next query.
          if (fresh.length > 0 || status === 200) break;
        } catch (err) {
          result.serpsFailed++;
          result.notes.push(`${engine.name} failed on "${q}": ${String(err).slice(0, 120)}`);
        }
        if (byUrl.size >= cfg.maxCandidates * 3) break outer;
      }
    }

    result.candidates = [...byUrl.values()];

    if (result.candidates.length === 0) {
      result.gap = 'socials_unresolved';
      result.notes.push(
        result.serpsCaptured === 0
          ? 'no search engine was reachable'
          : 'no candidate profiles in any SERP',
      );
      return result;
    }

    // ── 4-6: capture each candidate profile and score it deterministically ──
    //
    // Ordering matters when the cap bites: a candidate whose handle already
    // resembles the business name is far likelier to be the right profile, so
    // the cheap pre-filter spends the budget where it pays.
    const { nameSimilarity } = await import('./socialMatch.js');
    const ordered = result.candidates
      .map((c) => ({ c, pre: nameSimilarity(biz.name, c.handle, c.handle) }))
      .sort((a, b) => b.pre - a.pre)
      .slice(0, cfg.maxCandidates)
      .map((x) => x.c);

    for (const cand of ordered) {
      let read: ProfileRead | null = null;
      try {
        read = await readProfile(page, cand.url, cand.platform, cfg.timeoutMs);
      } catch (err) {
        result.notes.push(`profile unreachable ${cand.url}: ${String(err).slice(0, 100)}`);
      }
      await sleep(cfg.delayMs);
      if (!read) continue;
      if (!read.exists) {
        result.notes.push(`profile not public / not found: ${cand.url}`);
        continue;
      }

      const verdict = scoreProfileMatch({
        business: {
          name: biz.name,
          city: biz.city,
          phone: biz.normalizedPhone ?? biz.phone ?? null,
          address: biz.address ?? null,
          domain: biz.domain ?? null,
          category: biz.category ?? null,
        },
        profile: {
          platform: cand.platform,
          handle: cand.handle,
          title: read.title,
          bio: read.bio,
          text: read.text,
        },
      });

      // Weak matches are NOT stored as contacts, but their capture is still
      // evidence — of what was checked and rejected. That record is what makes
      // a later "why did you miss X?" answerable.
      let sourceId = -1;
      let rawObjectKey = '';
      if (!opts.dryRun) {
        const stored = await storeEvidence(biz.id, cand.platform, read.finalUrl, read.html, `social/${cand.platform}`);
        sourceId = stored.sourceId;
        rawObjectKey = stored.rawObjectKey;
      }

      // Messenger markers inside the bio (a wa.me link in an Instagram bio is a
      // real, evidenced WhatsApp contact). Third-party rules apply: only markers
      // carrying an explicit identifier count on a platform-owned page.
      const messengers = verdict.strength === 'weak' ? [] : detectContacts(read.html, {
        sourceType: cand.platform,
        knownProfiles: [read.finalUrl, cand.url],
      }).filter((c) => c.channel === 'whatsapp' || c.channel === 'viber');

      result.profiles.push({
        ...cand,
        verdict,
        sourceId,
        rawObjectKey,
        title: read.title.slice(0, 300),
        bio: read.bio.slice(0, 600),
        messengers: messengers.map((m) => ({ channel: m.channel, value: m.value, evidence: m.evidence })),
      });
    }

    if (!opts.dryRun) {
      result.contactsWritten = await persistProfiles(biz.id, result.profiles);
    }

    const anyUsable = result.profiles.some((p) => p.verdict.strength !== 'weak');
    if (!anyUsable) {
      result.gap = 'socials_unresolved';
      result.notes.push(`${result.profiles.length} profile(s) captured, none matched the business`);
    }
    return result;
  } catch (err) {
    // A hard failure is still a gap, never a thrown enrichment job.
    log.warn('social discovery failed', { businessId: biz.id, err: String(err).slice(0, 300) });
    result.gap = 'socials_unresolved';
    result.notes.push(`social discovery error: ${String(err).slice(0, 200)}`);
    return result;
  } finally {
    if (ownBrowser) await browser.close().catch(() => {});
  }
}

/**
 * Writes contacts for the profiles worth keeping.
 *
 *   strong => `verified=true`  — the profile page itself corroborated identity
 *   medium => `verified=false` — a candidate; the UI shows it for Roman to confirm
 *   weak   => nothing
 *
 * `verified=false` is not a lesser fact: it is an honest "we found this and
 * could not prove it", which the readiness gates already ignore (they count
 * verified contacts only), so a medium match can never sneak a business through
 * a gate.
 */
async function persistProfiles(
  businessId: string,
  profiles: VerifiedProfile[],
): Promise<SocialDiscoveryResult['contactsWritten']> {
  const written: SocialDiscoveryResult['contactsWritten'] = [];
  const existing = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));
  const seen = new Set(existing.map((c) => `${c.channel}:${c.value.toLowerCase()}`));

  for (const p of profiles) {
    if (p.verdict.strength === 'weak' || p.sourceId < 0) continue;
    const value = cleanProfileUrl(p.url);
    const key = `${p.platform}:${value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      await db.insert(schema.businessContacts).values({
        businessId,
        channel: p.platform,
        value,
        sourceId: p.sourceId,
        verified: p.verdict.strength === 'strong',
      });
      written.push({ channel: p.platform, value, verified: p.verdict.strength === 'strong', sourceId: p.sourceId });
    }

    // The match reasoning is stored as a fact so the decision is auditable
    // later without re-running the matcher.
    await db.insert(schema.businessFacts).values({
      businessId,
      key: `social_match.${p.platform}`,
      value: {
        url: value,
        handle: p.handle,
        strength: p.verdict.strength,
        score: p.verdict.score,
        nameSimilarity: p.verdict.nameSimilarity,
        signals: p.verdict.signals,
        blockers: p.verdict.blockers,
        foundVia: p.foundVia,
        title: p.title,
        bio: p.bio,
      },
      sourceId: p.sourceId,
      extractionMethod: 'deterministic',
      confidence: p.verdict.strength === 'strong' ? 1 : 0.5,
      verified: p.verdict.strength === 'strong',
    });

    // Messenger markers found in the bio, each citing the profile capture.
    for (const m of p.messengers) {
      const mkey = `${m.channel}:${m.value.toLowerCase()}`;
      if (seen.has(mkey)) continue;
      seen.add(mkey);
      await db.insert(schema.businessContacts).values({
        businessId,
        channel: m.channel,
        value: m.value,
        sourceId: p.sourceId,
        verified: p.verdict.strength === 'strong',
      });
      await db.insert(schema.businessFacts).values({
        businessId,
        key: `contact_marker.${m.channel}`,
        value: { value: m.value, evidence: m.evidence, foundOn: p.url },
        sourceId: p.sourceId,
        extractionMethod: 'deterministic',
        confidence: 1,
        verified: true,
      });
      written.push({ channel: m.channel, value: m.value, verified: p.verdict.strength === 'strong', sourceId: p.sourceId });
    }
  }
  return written;
}

/** Platforms the business already has a contact for — those searches are skipped. */
export async function existingSocialPlatforms(businessId: string): Promise<SocialPlatform[]> {
  const rows = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));
  const out = new Set<SocialPlatform>();
  for (const r of rows) {
    if (!r.verified) continue;
    if (r.channel === 'instagram' || r.channel === 'facebook' || r.channel === 'tiktok') out.add(r.channel);
  }
  return [...out];
}
