/**
 * Photo hunting — the business's OWN photographs, out of captured evidence.
 *
 * WHY IT IS SEPARATE FROM `collectPageImages`. That function runs in a live
 * Playwright page during enrichment and reads `naturalWidth` — real rendered
 * dimensions, which is genuinely better information. But it only ever sees the
 * ONE page the capture landed on (the homepage), and it cannot be re-run later:
 * by the time we know a business is thin on photos, the browser is long gone
 * and re-capturing means re-running `enrich`, which deletes and rebuilds every
 * fact for a business whose demo may already be built.
 *
 * This module works from the STORED HTML instead. Every capture wrote its full
 * page source to object storage as immutable evidence (spec §5), so a backfill
 * can mine gallery and portfolio images out of pages captured weeks ago, for
 * free, with no browser and no new requests to the business's site. The cost is
 * that dimensions are only known when the markup declares them — which is why
 * the real size filter stays in `collect-assets`, where the bytes are in hand
 * and the header can be read.
 *
 * WHAT IT WILL NOT DO. It does not fabricate a gallery. Instagram serves post
 * thumbnails only to a logged-in session, and the captured profile HTML for the
 * Patras businesses carries the avatar (`og:image`) and little else. What is
 * public gets taken; what is behind the login wall stays a gap, and the caller
 * records it as one.
 */

import { largestFromSrcset, resolveUrl, sectionAt } from './logoHunt.js';

export interface PhotoCandidate {
  url: string;
  /** Best-guess usage. Only decides where an asset is OFFERED, never a claim. */
  kind: 'hero' | 'gallery';
  width: number | null;
  height: number | null;
  alt: string;
  /** `site` | `instagram` | `facebook` | `maps` — recorded on the asset. */
  origin: string;
  via: string;
}

/**
 * Image hosts whose content is stock photography or third-party furniture.
 *
 * A stock photo on a demo is the specific thing Roman objected to: it makes
 * every salon's page look like every other salon's page, which is what
 * "шаблонні" means. These are excluded at the offer stage so they never reach
 * storage and never become "evidence" of anything.
 */
const STOCK_HOSTS = [
  'unsplash.com', 'images.unsplash.com', 'pexels.com', 'images.pexels.com',
  'pixabay.com', 'cdn.pixabay.com', 'shutterstock.com', 'istockphoto.com',
  'gettyimages.com', 'freepik.com', 'img.freepik.com', 'stock.adobe.com',
  'depositphotos.com', 'dreamstime.com', 'placehold.co', 'placeholder.com',
  'via.placeholder.com', 'picsum.photos', 'gravatar.com', 'secure.gravatar.com',
  'googletagmanager.com', 'google-analytics.com', 'facebook.com/tr',
  'w.org', 'stats.wp.com', 'ps.w.org',
];

/** Path fragments that mean "site furniture", not a photograph of the business. */
const FURNITURE_PATTERNS = [
  /\/(?:plugins?|themes?)\/[^/]+\/(?:assets\/)?(?:img|images|icons?)\//i,
  /\/wp-includes\//i,
  /\/(?:icons?|sprites?|flags?|emoji|avatars?)\//i,
  /(?:^|\/)(?:spinner|loader|loading|placeholder|blank|pixel|spacer|dummy)[-_.]/i,
  /\.(?:svg|gif)(?:$|[?#])/i, // vector/animated: never a photograph of a salon
];

export function isStockOrFurniture(url: string): boolean {
  let host = '';
  let path = url;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch { /* relative: judge on the string alone */ }
  if (STOCK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  if (FURNITURE_PATTERNS.some((re) => re.test(path))) return true;
  return false;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)
    ?? new RegExp(`${name}\\s*=\\s*([^\\s>"']+)`, 'i').exec(tag);
  return m?.[1] ?? '';
}

function numAttr(tag: string, name: string): number | null {
  const n = Number(attr(tag, name).replace(/px$/i, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * WordPress and most galleries emit the SAME photo at a dozen sizes
 * (`photo-300x200.jpg`, `photo-1024x683.jpg`, `photo-scaled.jpg`). Downloading
 * all of them wastes the budget and then dedupes to one by hash anyway — but
 * only AFTER paying for every fetch. Collapsing them here by their base name
 * and keeping the largest declared variant is the same result for a fraction of
 * the requests, and it means the copy we keep is the big one.
 */
export function baseImageName(url: string): string {
  let path = url;
  try { path = new URL(url).pathname; } catch { /* relative is fine */ }
  return path
    .replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]+$)/i, '')
    .replace(/-scaled(?=\.[a-z0-9]+$)/i, '')
    .replace(/@\dx(?=\.[a-z0-9]+$)/i, '')
    .toLowerCase();
}

/** Declared pixel area, for picking the biggest variant of one photo. */
function declaredArea(c: PhotoCandidate): number {
  if (c.width && c.height) return c.width * c.height;
  // No declaration: infer from a `-1024x683` suffix, which WordPress always emits.
  const m = /-(\d{2,4})x(\d{2,4})\.[a-z0-9]+(?:$|[?#])/i.exec(c.url);
  if (m) return Number(m[1]) * Number(m[2]);
  return 0;
}

/**
 * Photographs offered by one captured page.
 *
 * `minDeclaredEdge` only rejects images whose markup DECLARES a small size —
 * an undeclared image is kept, because the byte-level check in `collect-assets`
 * reads the real dimensions from the file header and is the authority. Throwing
 * away an unmeasured image here would silently discard real evidence.
 */
export function photoCandidatesFromHtml(
  html: string,
  baseUrl: string,
  opts: { origin: string; minDeclaredEdge?: number } = { origin: 'site' },
): PhotoCandidate[] {
  const minEdge = opts.minDeclaredEdge ?? 400;
  const out: PhotoCandidate[] = [];

  // og:image is the page's own chosen representative image — on a social
  // profile it is the avatar, on a site it is usually the hero.
  const ogMatch = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i.exec(html);
  if (ogMatch) {
    const url = resolveUrl(ogMatch[1]!.replace(/\\u0026/g, '&').replace(/\\\//g, '/'), baseUrl);
    if (url && !isStockOrFurniture(url)) {
      out.push({ url, kind: 'hero', width: null, height: null, alt: '', origin: opts.origin, via: 'og:image' });
    }
  }

  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const raw = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src')
      || (attr(tag, 'srcset') ? largestFromSrcset(attr(tag, 'srcset')) ?? '' : '')
      || (attr(tag, 'data-srcset') ? largestFromSrcset(attr(tag, 'data-srcset')) ?? '' : '');
    if (!raw) continue;
    const url = resolveUrl(raw, baseUrl);
    if (!url || isStockOrFurniture(url)) continue;

    const width = numAttr(tag, 'width');
    const height = numAttr(tag, 'height');
    if (width && height && (width < minEdge && height < minEdge)) continue;

    const alt = attr(tag, 'alt');
    const attrs = `${attr(tag, 'class')} ${attr(tag, 'id')}`.toLowerCase();
    const hay = `${url} ${alt} ${attrs}`.toLowerCase();
    // A logo is collected by `logoHunt`, with a scorer that can tell a partner
    // brand from the business's own mark. Admitting it here too would put an
    // unscored copy into the photo set.
    if (/logo|wordmark|emblem|icon/.test(hay)) continue;

    const position = sectionAt(html, m.index!);
    const ratio = width && height ? width / height : 1;
    const kind: PhotoCandidate['kind'] = (position === 'header' || /hero|banner|slide|cover|masthead/.test(hay))
      && ratio >= 1.2 ? 'hero' : 'gallery';

    out.push({ url, kind, width, height, alt, origin: opts.origin, via: '<img>' });
  }

  // Background images declared inline: gallery grids and hero sections
  // routinely carry the photo in `style="background-image:url(...)"`.
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
    const url = resolveUrl(m[2]!, baseUrl);
    if (!url || isStockOrFurniture(url)) continue;
    out.push({ url, kind: 'hero', width: null, height: null, alt: '', origin: opts.origin, via: 'css background' });
  }

  return dedupeVariants(out);
}

/** One entry per distinct photograph, keeping the largest declared variant. */
export function dedupeVariants(candidates: PhotoCandidate[]): PhotoCandidate[] {
  const best = new Map<string, PhotoCandidate>();
  for (const c of candidates) {
    const key = baseImageName(c.url);
    const prev = best.get(key);
    if (!prev || declaredArea(c) > declaredArea(prev)) best.set(key, c);
  }
  return [...best.values()];
}
