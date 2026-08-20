/**
 * Logo hunting — finding the mark a business actually chose for itself.
 *
 * WHY THIS EXISTS. Roman, on the second batch of demos: "Чого ти не збираєш
 * ассети нормально? Фотки, логотип, брендові кольори. Демки виходять
 * шаблонні." The cause was measurable in the database. `collect-assets` tagged
 * an image `logo` when `src + alt + class` matched `/logo|brand/`, and on the
 * real Patras run that produced:
 *
 *   - The Parlor: NINE `logo` assets, of which eight are the PARTNER BRANDS the
 *     salon stocks — `loreal_logo.png`, `wella_logo.png`, `farcom_logo.jpg`,
 *     `tangleteezer_logo.png`. The salon's own `logo.png` was in there too,
 *     indistinguishable from the other eight to everything downstream.
 *   - Laser Beauty: `e-banner.png` (712x193), a WordPress promo banner that
 *     happens to sit in a sidebar.
 *   - Elegant Hairdesign: `margilogo.webp`, off the third-party booking widget
 *     `easyrantevou.gr` — not this salon's mark at all.
 *
 * `brandIdentity.ts` then takes `assetRows.find(a => a.intendedUsage === 'logo')`
 * — the FIRST row — and reads the brand palette off it. For The Parlor that is
 * a coin flip between the salon and L'Oréal, and L'Oréal's red would have been
 * written to the database as this salon's brand colour, with a real
 * `source_id`, looking exactly as trustworthy as a true fact. That is the
 * failure mode the evidence rules exist to prevent, and a regex cannot tell the
 * two apart because both files are literally named `*_logo.png`.
 *
 * WHAT SEPARATES THEM is not the filename, it is everything around it:
 *
 *   - WHERE it sits. A business's own mark is in the `<header>`/`<nav>`, usually
 *     inside the link back to `/`. Partner logos live in a "brands we use"
 *     strip far down the page, and promo banners sit in sidebars and footers.
 *   - WHAT IT IS CALLED, precisely. `logo.png` and `<site>-logo.svg` are the
 *     business's; `loreal_logo.png` names somebody else, and the somebody-else
 *     list for a beauty salon is short and knowable.
 *   - WHETHER THE SITE DECLARES IT. `<link rel="icon">`, `og:logo` and
 *     schema.org `Organization.logo` are the site telling us which image is the
 *     brand. No inference required, and no partner brand is ever declared there.
 *   - SHAPE. A wordmark is wide (3:1, 4:1); a partner strip is uniformly sized
 *     (every Parlor partner is exactly 300x170 — the give-away that they are one
 *     styled row, not a brand).
 *
 * So this module scores candidates on those signals and keeps the best one or
 * two, instead of tagging everything that says "logo". Everything here is PURE
 * — HTML in, scored candidates out — so the whole ranking is unit-tested against
 * the real Patras markup in `scripts/test-logo-hunt.ts` without a network.
 *
 * INVARIANT. This module decides which image to DOWNLOAD and how to LABEL it.
 * It never invents a URL: every candidate it returns was literally present in a
 * captured page, and the caller records the capture as the asset's source.
 */

/** Where in the document a candidate was found. Drives most of the score. */
export type LogoPosition = 'declared' | 'header' | 'footer' | 'body' | 'partner_strip';

export interface LogoCandidate {
  /** Absolute URL, resolved against the page's own base. */
  url: string;
  /** How the page announced it: `link[rel=icon]`, `og:logo`, `<img>`, ... */
  via: string;
  position: LogoPosition;
  /** Intrinsic size when the markup declared one (width/height attrs). */
  width: number | null;
  height: number | null;
  alt: string;
  /** Class/id text, kept for scoring and for the audit trail. */
  attrs: string;
  /** True when the URL is an SVG — vector marks are ideal but need marking. */
  svg: boolean;
  /** Filled in by `scoreLogoCandidate`. */
  score?: number;
  reasons?: string[];
}

/**
 * Brands a beauty/hair business STOCKS rather than IS.
 *
 * This is the list that saves The Parlor. It is deliberately narrow and
 * niche-specific — a denylist of famous names is a blunt instrument, and the
 * failure mode it must avoid is rejecting a salon genuinely called "Wella
 * Studio". That is why a hit here is a strong PENALTY and not a hard reject:
 * combined with a header position and a name match the candidate can still win,
 * which is the behaviour a real "Kerastase Patras" would need.
 */
const PARTNER_BRANDS = [
  'loreal', 'l-oreal', 'loréal', 'wella', 'schwarzkopf', 'kerastase', 'kérastase',
  'redken', 'matrix', 'olaplex', 'moroccanoil', 'farcom', 'glossco', 'sebastian',
  'tigi', 'goldwell', 'indola', 'revlon', 'davines', 'alfaparf', 'nioxin',
  'tangleteezer', 'tangle-teezer', 'invisiblebobble', 'invisible-bobble',
  'ghd', 'dyson', 'babyliss', 'cnd', 'cndc', 'opi', 'essie', 'gelish',
  'shellac', 'dermalogica', 'bioeffect', 'filorga', 'juvederm', 'restylane',
  'soprano', 'candela', 'cynosure', 'alma', 'lumenis',
  // payment / platform badges that show up in footers wearing "logo" in the name
  'visa', 'mastercard', 'paypal', 'stripe', 'viva-wallet', 'vivawallet',
  'wordpress', 'woocommerce', 'elementor', 'wix', 'squarespace', 'shopify',
  'facebook', 'instagram', 'tiktok', 'youtube', 'tripadvisor', 'booksy',
  'easyrantevou', 'easyrantevou-gr',
];

/** Filename stems that mean "this is the site's own mark". */
const OWN_MARK_NAMES = [
  'logo', 'logotype', 'wordmark', 'brandmark', 'site-logo', 'sitelogo',
  'main-logo', 'header-logo', 'logo-header', 'logo-main', 'custom-logo',
  'brand', 'emblem', 'monogram',
];

/** Things that are logo-shaped but are not a logo. */
const NEGATIVE_NAMES = [
  'banner', 'placeholder', 'sprite', 'spinner', 'loader', 'loading',
  'arrow', 'chevron', 'close', 'menu-icon', 'hamburger', 'search-icon',
  'cart', 'star', 'rating', 'badge-', 'award', 'certificate', 'sticker',
  'payment', 'cookie', 'gdpr', 'flag-', 'lang-', 'whatsapp', 'messenger',
];

/**
 * Image hosts that belong to nobody in particular. A business's mark served
 * from one of these arrived via an embed, a widget or a forum paste — it is not
 * the site publishing its own identity.
 */
const GENERIC_IMAGE_HOSTS = [
  'ibb.co', 'i.ibb.co', 'imgbb.com', 'imgur.com', 'i.imgur.com',
  'postimg.cc', 'i.postimg.cc', 'imageshack.us', 'tinypic.com',
  'photobucket.com', 'cloudinary.com', 'imagekit.io',
];

/**
 * The last two labels of a hostname — a cheap stand-in for the registrable
 * domain. `cdn.salon.gr` and `salon.gr` compare equal, which is the point: a
 * business serving its logo from its own CDN must not be penalised as
 * off-site. It is deliberately not a public-suffix implementation; a wrong
 * answer on `co.uk`-style suffixes costs a few points of score, never a
 * correctness bug, and the alternative is a dependency and a suffix list to
 * keep current.
 */
export function registrableTail(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/** Lowercased haystack of everything the markup said about a candidate. */
function haystack(c: LogoCandidate): string {
  let path = c.url;
  try {
    path = new URL(c.url).pathname;
  } catch { /* keep the raw string; a relative URL still has a usable tail */ }
  return `${path} ${c.alt} ${c.attrs} ${c.via}`.toLowerCase();
}

/** The filename without directories or extension, lowercased. */
export function fileStem(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch { /* relative URL: the raw string is already close enough */ }
  const base = path.split('/').filter(Boolean).pop() ?? '';
  return base.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
}

/**
 * Scores one candidate. Higher is more likely to be the business's own mark.
 *
 * The weights are ordered by how much each signal can be trusted, not by how
 * often it fires: a `<link rel="icon">` is the site ITSELF saying "this is my
 * mark" and outranks any amount of filename guessing, while a partner-brand
 * name is the only signal strong enough to push a header image below zero.
 */
export function scoreLogoCandidate(c: LogoCandidate, opts: { siteHost?: string | null } = {}): { score: number; reasons: string[] } {
  const hay = haystack(c);
  const stem = fileStem(c.url);
  const reasons: string[] = [];
  let score = 0;

  const add = (n: number, why: string) => { score += n; reasons.push(`${n >= 0 ? '+' : ''}${n} ${why}`); };

  // ── Origin: is this file even the site's own? ───────────────────────────
  //
  // The signal that saves Elegant Hairdesign. Its "logo" is `margilogo.webp` on
  // `i.ibb.co` — an image host used by the third-party booking widget the salon
  // embeds. By name and shape it is a perfect logo; the only thing wrong with it
  // is that it belongs to somebody else, and that is visible only in the host.
  //
  // A CDN on a sibling domain is normal and must not be punished, so the
  // comparison is on the registrable-ish tail rather than the exact host.
  if (opts.siteHost) {
    const own = registrableTail(opts.siteHost);
    let host = '';
    try { host = new URL(c.url).hostname.toLowerCase(); } catch { /* relative: same-origin by construction */ }
    if (host && own && registrableTail(host) !== own) {
      // A generic image host (imgbb, imgur, postimg) hosting a "logo" for a
      // business is almost always a third-party embed, never the site's mark.
      const generic = GENERIC_IMAGE_HOSTS.some((g) => host === g || host.endsWith(`.${g}`));
      add(generic ? -35 : -18, `hosted off-site on ${host}${generic ? ' (generic image host)' : ''}`);
    } else if (host && own) {
      add(8, 'served from the business\'s own domain');
    }
  }

  // ── Position: the strongest structural signal ───────────────────────────
  switch (c.position) {
    case 'declared':
      // og:logo / schema.org Organization.logo / rel=icon. Not a guess: the
      // site is naming its own mark, and no partner brand is ever declared here.
      add(55, `declared by the page itself (${c.via})`);
      break;
    case 'header':
      add(30, 'inside the page header/nav');
      break;
    case 'footer':
      // Many small sites only put the mark in the footer; worth something,
      // but footers are also where payment and CMS badges live.
      add(10, 'in the footer');
      break;
    case 'partner_strip':
      // A uniformly-sized row of marks is a "brands we stock" strip. This is
      // what eight of The Parlor's nine "logos" actually are.
      add(-40, 'in a uniform row of marks (partner/brand strip)');
      break;
    case 'body':
      break;
  }

  // ── Name: what the file is called ──────────────────────────────────────
  const partner = PARTNER_BRANDS.find((b) => stem.includes(b) || hay.includes(`/${b}`) || hay.includes(`${b}_logo`) || hay.includes(`${b}-logo`));
  if (partner) {
    // Strong enough to bury a header hit, not absolute: a salon really named
    // after one of these keeps the chance to win on its other signals.
    add(-45, `filename names a stocked brand / platform ("${partner}")`);
  }

  if (stem === 'logo' || OWN_MARK_NAMES.includes(stem)) {
    add(25, `filename is exactly "${stem}"`);
  } else if (OWN_MARK_NAMES.some((n) => stem.startsWith(`${n}-`) || stem.startsWith(`${n}_`) || stem.endsWith(`-${n}`) || stem.endsWith(`_${n}`))) {
    add(15, 'filename is a logo variant (logo-2x, header-logo, ...)');
  } else if (/logo|brand/.test(hay)) {
    add(6, 'markup mentions logo/brand somewhere');
  } else if (c.position === 'declared') {
    // `apple-touch-icon.png`, `mark.svg`, `icon-512.png` — a declared mark is
    // not obliged to have "logo" in its name, and requiring one would leave the
    // strongest evidence class scoring like an anonymous body image.
    add(12, 'declared mark (name carries no logo keyword, and need not)');
  }

  const negative = NEGATIVE_NAMES.find((n) => stem.includes(n));
  if (negative) add(-25, `filename looks like UI furniture / promo ("${negative}")`);

  // A WordPress `custom-logo` class is the theme's own logo slot — as close to
  // a declaration as an <img> gets.
  if (/\bcustom-logo\b|\bsite-logo\b|\blogo-link\b|\bnavbar-brand\b/.test(c.attrs.toLowerCase())) {
    add(20, 'sits in the theme\'s dedicated logo slot');
  }

  // Alt text naming the business is a good sign; alt text naming a product is
  // already covered by the partner penalty.
  if (/logo/.test(c.alt.toLowerCase())) add(5, 'alt text says "logo"');

  // ── Shape ──────────────────────────────────────────────────────────────
  if (c.width && c.height) {
    const ratio = c.width / c.height;
    const edge = Math.max(c.width, c.height);
    if (ratio >= 1.6 && ratio <= 8) {
      add(10, `wordmark aspect ratio (${ratio.toFixed(1)}:1)`);
    } else if (ratio >= 0.8 && ratio <= 1.25) {
      add(8, 'square-ish mark (icon/emblem)');
    } else if (ratio > 8 || ratio < 0.4) {
      // A 1400x120 strip is a banner, not a mark.
      add(-15, `extreme aspect ratio (${ratio.toFixed(1)}:1) — banner, not a mark`);
    }
    if (edge < 40) add(-20, `tiny (${c.width}x${c.height}) — favicon-grade only`);
    else if (edge >= 200) add(6, `usable size (${c.width}x${c.height})`);
  }

  // SVG is a real advantage: it scales into a hero at any size and is almost
  // always the mark rather than a photograph.
  if (c.svg) add(12, 'vector (SVG) — the mark itself, not a raster of it');

  return { score, reasons };
}

/**
 * Ranks candidates and keeps the plausible ones, best first.
 *
 * The floor exists so that "we found nothing convincing" stays a possible
 * answer. A business with no mark must produce a `logo_missing` gap, not the
 * least-bad image on its homepage — a wrong logo on a demo is worse than none,
 * because the owner sees their competitor's brand on their own page.
 */
export function rankLogoCandidates(
  candidates: LogoCandidate[],
  opts: { minScore?: number; limit?: number; siteHost?: string | null } = {},
): LogoCandidate[] {
  const minScore = opts.minScore ?? 20;
  const limit = opts.limit ?? 2;

  const scored = candidates.map((c) => {
    const { score, reasons } = scoreLogoCandidate(c, { siteHost: opts.siteHost });
    return { ...c, score, reasons };
  });

  // Dedupe by URL, keeping the best-scoring appearance: the same file often
  // appears in both the header and the footer, and the header hit is the one
  // that describes it.
  const byUrl = new Map<string, LogoCandidate>();
  for (const c of scored) {
    const prev = byUrl.get(c.url);
    if (!prev || (c.score ?? 0) > (prev.score ?? 0)) byUrl.set(c.url, c);
  }

  return [...byUrl.values()]
    .filter((c) => (c.score ?? 0) >= minScore)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

// ── HTML extraction (pure) ──────────────────────────────────────────────────

/** Resolves a possibly-relative URL against the page. Null when unusable. */
export function resolveUrl(raw: string, base: string): string | null {
  const src = raw.trim().replace(/&amp;/g, '&');
  if (!src || src.startsWith('data:') || src.startsWith('javascript:')) return null;
  try {
    const u = new URL(src, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** `srcset="a.png 1x, a@2x.png 2x"` → the largest-descriptor URL. */
export function largestFromSrcset(srcset: string): string | null {
  const entries = srcset.split(',').map((part) => {
    const [url, descriptor = ''] = part.trim().split(/\s+/);
    const w = /^(\d+)w$/.exec(descriptor);
    const x = /^([\d.]+)x$/.exec(descriptor);
    const weight = w ? Number(w[1]) : x ? Number(x[1]) * 1000 : 1;
    return { url, weight };
  }).filter((e) => e.url);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.weight - a.weight);
  return entries[0]!.url ?? null;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)
    ?? new RegExp(`${name}\\s*=\\s*([^\\s>"']+)`, 'i').exec(tag);
  return m?.[1] ?? '';
}

function numAttr(tag: string, name: string): number | null {
  const v = attr(tag, name).replace(/px$/i, '');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The section of the document an offset falls in.
 *
 * Regex over raw HTML rather than a DOM walk, for one reason worth stating: the
 * captured evidence is a STRING in object storage, and re-parsing it in a
 * browser would mean launching Playwright for every backfill. The approximation
 * is honest — it takes the LAST opening tag before the offset with no matching
 * close — and it is only ever one input to a score, never a verdict on its own.
 */
export function sectionAt(html: string, offset: number): LogoPosition {
  const before = html.slice(0, offset).toLowerCase();
  const zones: Array<[LogoPosition, RegExp, RegExp]> = [
    ['header', /<header\b|<nav\b|class=["'][^"']*\b(?:site-header|masthead|navbar|topbar|main-nav)\b/g, /<\/header>|<\/nav>/g],
    ['footer', /<footer\b|class=["'][^"']*\b(?:site-footer|colophon)\b/g, /<\/footer>/g],
  ];
  for (const [zone, open, close] of zones) {
    const opens = [...before.matchAll(open)].map((m) => m.index!);
    const closes = [...before.matchAll(close)].map((m) => m.index!);
    const lastOpen = opens.length ? opens[opens.length - 1]! : -1;
    const lastClose = closes.length ? closes[closes.length - 1]! : -1;
    if (lastOpen > lastClose) return zone;
  }
  return 'body';
}

/**
 * Every logo candidate a captured page declares or displays.
 *
 * Three tiers, matching how much the page is actually telling us:
 *   1. DECLARATIONS — `og:logo`, schema.org `Organization.logo`, `rel=icon` /
 *      `apple-touch-icon`. The site naming its own mark.
 *   2. HEADER/FOOTER `<img>` — the mark in place.
 *   3. Anything else logo-shaped, kept only so the scorer can reject it on the
 *      record rather than silently.
 *
 * `baseUrl` is the page's final URL, so relative `src` values resolve.
 */
export function logoCandidatesFromHtml(html: string, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const push = (c: LogoCandidate | null) => { if (c) out.push(c); };

  const make = (raw: string, via: string, position: LogoPosition, extra: Partial<LogoCandidate> = {}): LogoCandidate | null => {
    const url = resolveUrl(raw, baseUrl);
    if (!url) return null;
    return {
      url, via, position,
      width: extra.width ?? null,
      height: extra.height ?? null,
      alt: extra.alt ?? '',
      attrs: extra.attrs ?? '',
      svg: /\.svg(?:$|[?#])/i.test(url) || (extra.attrs ?? '').includes('image/svg'),
    };
  };

  // ── 1. Declarations ─────────────────────────────────────────────────────
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0];
    const prop = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (prop !== 'og:logo' && prop !== 'twitter:image:src' && prop !== 'og:image') continue;
    const content = attr(tag, 'content');
    if (!content) continue;
    // og:image is the share card, not necessarily the mark. It is admitted as a
    // candidate ONLY when it names itself a logo — otherwise it is a photo, and
    // photo collection already handles it.
    if (prop === 'og:image' && !/logo/i.test(content)) continue;
    push(make(content, prop, 'declared', { attrs: prop }));
  }

  // schema.org Organization/LocalBusiness logo, in JSON-LD.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1] ?? '';
    for (const lm of body.matchAll(/"logo"\s*:\s*(?:"([^"]+)"|\{[^{}]*"url"\s*:\s*"([^"]+)")/gi)) {
      const url = (lm[1] ?? lm[2] ?? '').replace(/\\\//g, '/');
      push(make(url, 'schema.org logo', 'declared', { attrs: 'ld+json' }));
    }
  }

  // rel=icon / apple-touch-icon. The biggest declared `sizes` wins on score
  // through its width/height, so all of them are offered.
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const tag = m[0];
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/\b(?:icon|apple-touch-icon|shortcut icon|mask-icon)\b/.test(rel)) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    const sizes = /(\d+)x(\d+)/.exec(attr(tag, 'sizes'));
    push(make(href, `link rel="${rel}"`, 'declared', {
      width: sizes ? Number(sizes[1]) : null,
      height: sizes ? Number(sizes[2]) : null,
      attrs: `${rel} ${attr(tag, 'type')}`,
    }));
  }

  // ── 2 + 3. <img> elements, positioned ───────────────────────────────────
  const imgs: Array<{ tag: string; offset: number }> = [];
  for (const m of html.matchAll(/<img[^>]+>/gi)) imgs.push({ tag: m[0], offset: m.index! });

  // A "partner strip" is a run of three or more images sharing exact
  // dimensions — the styled row a CMS emits for "brands we stock". The Parlor's
  // eight partner marks are all 300x170; its own logo is 458x458.
  const dimCount = new Map<string, number>();
  for (const { tag } of imgs) {
    const w = numAttr(tag, 'width'); const h = numAttr(tag, 'height');
    if (w && h) dimCount.set(`${w}x${h}`, (dimCount.get(`${w}x${h}`) ?? 0) + 1);
  }

  for (const { tag, offset } of imgs) {
    const src = attr(tag, 'src') || attr(tag, 'data-src')
      || (attr(tag, 'srcset') ? largestFromSrcset(attr(tag, 'srcset')) ?? '' : '');
    if (!src) continue;
    const alt = attr(tag, 'alt');
    const attrs = `${attr(tag, 'class')} ${attr(tag, 'id')} ${attr(tag, 'data-type')}`;
    const width = numAttr(tag, 'width');
    const height = numAttr(tag, 'height');
    const hay = `${src} ${alt} ${attrs}`.toLowerCase();

    let position = sectionAt(html, offset);
    if (position === 'body' && width && height && (dimCount.get(`${width}x${height}`) ?? 0) >= 3) {
      position = 'partner_strip';
    }
    // Only logo-shaped things are worth carrying: an unrelated gallery photo is
    // a PHOTO candidate, handled elsewhere, and admitting it here would only
    // give the scorer noise to reject.
    const looksLogo = /logo|brand|wordmark|emblem|monogram/.test(hay)
      || /\bcustom-logo\b|\bnavbar-brand\b/.test(attrs.toLowerCase())
      || (position === 'header' && !!width && !!height && width / height >= 1.5 && width / height <= 8);
    if (!looksLogo) continue;

    push(make(src, '<img>', position, { alt, attrs, width, height }));
  }

  return out;
}
