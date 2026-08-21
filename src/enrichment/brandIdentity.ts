/**
 * Brand identity extraction — the business's OWN visual language, measured.
 *
 * WHY THIS EXISTS. Roman, looking at the first batch of demos: "Чого всі демо в
 * одному стилі? Ти досліджуєш соцмережі бізнесу? Береш їхні кольори, айдентику?
 * Щоб у цьому стилі будувати і сайт." He was right about the cause. Stage 9's
 * art director was told to derive a palette "from something real", but the only
 * real thing in its context was a list of photo FILENAMES and a shared motion
 * reference pack. With no measured colours to start from, three directions for
 * three different salons converge on whatever the reference pack suggests —
 * which is exactly why every demo looked like a sibling of the last one.
 *
 * WHAT IT DOES. It reads evidence that is ALREADY captured — no new network
 * work is required for the deterministic half — and measures:
 *
 *   1. `brand.logo_colors`   — median-cut palette of the logo asset, if one was
 *                              collected. Highest-authority colour evidence a
 *                              business has: someone chose it on purpose.
 *   2. `brand.avatar_colors` — same, from the Instagram/Facebook profile picture
 *                              found in the captured profile HTML. For a
 *                              social-only business this IS the logo.
 *   3. `brand.site_colors` /
 *      `brand.fonts_seen`    — colours and font families literally declared in
 *                              the captured website HTML (inline styles, style
 *                              blocks, meta theme-color, Google Fonts links).
 *   4. `brand.photo_colors`  — the palette of the photo set, which is the
 *                              fallback when there is no logo, no avatar and no
 *                              site. This is what stage 9 had before, except
 *                              now it is measured instead of imagined.
 *   5. `brand.voice`         — ONE structured agent call over the profile bio,
 *                              captured post text and category. The only
 *                              non-mechanical judgement in the module, and every
 *                              field it returns cites the source block it read.
 *
 * INVARIANTS (CLAUDE.md). Every fact written carries a `source_id` pointing at
 * an immutable capture. A colour that cannot be traced to a decoded asset or a
 * captured page is not written — there is no "reasonable default" path. Nothing
 * here throws into the caller: a total failure produces `brand_unresolved` and
 * the pipeline proceeds with the evidence it does have.
 */
import type { Browser, Page } from 'playwright';
import { and, eq, like } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getObject } from '../lib/storage.js';
import { runAgent, z } from '../agents/agent.js';
import { log } from '../lib/logger.js';
import { safeFetchImage } from '../lib/safeFetch.js';
import {
  contrastCorrect, contrastRatio, decodeImage, fromHex, luminance, newDecodePage, paletteFromImage,
  pickAccent, pickNeutrals, rgbToHsl, toHex, type PaletteEntry,
} from './colorExtract.js';
import { runBrandAgent, type GroundedRole } from './brandAgent.js';

// ── the fact shape written to business_facts ────────────────────────────────

export interface BrandPaletteFact {
  /** Where the pixels came from, in words a person can check. */
  from: string;
  colors: PaletteEntry[];
}

export interface BrandVoice {
  /** playful | luxury | minimal | warm | clinical | bold | traditional | ... */
  tone: string;
  formality: 'formal' | 'neutral' | 'casual';
  /** Words the business itself uses about itself, verbatim from the evidence. */
  selfDescribedAs: string[];
  /** Brand elements the text explicitly names (a slogan, a colour, a symbol). */
  statedBrandElements: string[];
  /** Which source block each field was read in. */
  sourceRef: string;
  reasoning: string;
}

/**
 * The designer's reading of the material, when the agent produced one that
 * survived grounding. Colours here are ALSO written as `primary`/`accent`, so
 * every consumer that predates the agent keeps working unchanged; this section
 * carries what only an agent can say.
 */
export interface BrandAgentReading {
  /** serif/sans/…, weight, case — with the captures the reading came from. */
  typography: {
    family: string | null; weight: string | null; case: string | null;
    notes: string; sourceIds: number[];
  } | null;
  /** Two to five words for the register the material projects. */
  mood: string[];
  photographyStyle: { text: string; sourceIds: number[] } | null;
  /** The agent's own confidence. Low is a correct answer for generic material. */
  confidence: number;
  /** The workspace files it looked at. */
  files: string[];
}

export interface BrandIdentity {
  businessId: string;
  /** The palette the design must start from, and which evidence produced it. */
  primary: { hex: string; sourceId: number; from: string } | null;
  accent: { hex: string; sourceId: number; from: string } | null;
  /** The page ground the identity implies, when the agent named a grounded one. */
  background: { hex: string; sourceId: number; from: string } | null;
  onDark: { hex: string; sourceId: number; from: string } | null;
  /** Non-colour readings from the agent, or null when it did not lead. */
  agent: BrandAgentReading | null;
  /** Contrast-corrected accent for use on the proposed background. */
  accentOnLight: string | null;
  accentOnDark: string | null;
  logoColors: { colors: PaletteEntry[]; sourceId: number; from: string } | null;
  avatarColors: { colors: PaletteEntry[]; sourceId: number; from: string } | null;
  siteColors: { colors: PaletteEntry[]; sourceId: number; from: string } | null;
  photoColors: { colors: PaletteEntry[]; sourceId: number; from: string } | null;
  fontsSeen: { fonts: string[]; sourceId: number } | null;
  voice: (BrandVoice & { sourceId: number }) | null;
  /**
   * Rank of the evidence the palette rests on. `agent` means a designer agent
   * read it off the material and code re-derived every hex from the file it
   * cited; the other values are the deterministic measurement, which is both
   * the cross-check and the fallback.
   */
  paletteSource: 'agent' | 'logo' | 'avatar' | 'site' | 'photos' | 'none';
  notes: string[];
  /** Set when nothing usable could be measured. */
  gap: string | null;
}

// ── HTML mining (pure, unit-tested) ─────────────────────────────────────────

/**
 * Colours literally declared in a page's own markup. Deliberately narrow: this
 * reads DECLARATIONS, not rendered pixels, so a colour it returns is one
 * somebody wrote down. External stylesheets are not fetched — a colour we never
 * captured is not evidence we hold.
 *
 * Ordered by authority: `theme-color` (an explicit brand statement) first, then
 * CSS custom properties (a design system's own tokens), then ordinary
 * declarations by frequency.
 */
/**
 * Colours that ship with a CMS or CSS framework and therefore say nothing about
 * a brand.
 *
 * The WordPress/Gutenberg default palette is the whole reason this set exists:
 * it is emitted into the `<style>` of EVERY WordPress site whether or not the
 * theme uses it, and it dominated the extraction on both of the Patras sites
 * with a site (`#00d084` "vivid green cyan" came out as TRENDY HAIR's primary
 * brand colour, which it plainly is not). Treating a stock swatch as evidence
 * would give a dozen unrelated businesses the same "brand", which is precisely
 * the sameness this module was built to remove.
 */
const FRAMEWORK_DEFAULT_COLORS = new Set([
  // WordPress / Gutenberg core palette
  '#eeeeee', '#f78da7', '#cf2e2e', '#ff6900', '#fcb900', '#7bdcb5', '#00d084',
  '#8ed1fc', '#0693e3', '#abb8c3', '#313131', '#9b51e0',
  // Bootstrap 5 defaults
  '#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#dc3545', '#fd7e14', '#ffc107',
  '#198754', '#20c997', '#0dcaf0', '#6c757d', '#212529', '#f8f9fa',
  // Tailwind's most-copied blues/greys
  '#3b82f6', '#2563eb', '#1f2937', '#111827', '#6b7280', '#9ca3af', '#e5e7eb',
]);

/**
 * True for CSS custom properties that belong to a CMS or framework rather than
 * to the site's own design. Matching on the token NAMESPACE rather than on a
 * list of hexes is what makes this hold up: WordPress ships dozens of these and
 * a theme update changes the values, not the prefixes.
 */
export function isFrameworkToken(name: string): boolean {
  return /^--(?:wp|bs|tw|elementor|et|jet|astra|oceanwp|generate|kadence|blocksy|neve)[-_]/.test(name)
    || name.startsWith('--wp--')
    || /^--(?:bootstrap|tailwind|mui|chakra|antd|ion)-/.test(name);
}

export function colorsFromHtml(html: string): Array<{ hex: string; weight: number; where: string }> {
  const found = new Map<string, { hex: string; weight: number; where: string }>();
  const add = (raw: string, weight: number, where: string) => {
    const rgb = fromHex(raw);
    if (!rgb) return;
    const hex = toHex(rgb);
    const hsl = rgbToHsl(rgb);
    // Pure white/black and near-neutrals are in every stylesheet ever written;
    // they say nothing about THIS brand.
    if (hsl.s < 0.08 && (hsl.l > 0.93 || hsl.l < 0.07)) return;
    if (FRAMEWORK_DEFAULT_COLORS.has(hex)) return;
    const hit = found.get(hex);
    if (hit) { hit.weight += weight; } else { found.set(hex, { hex, weight, where }); }
  };

  // 1. <meta name="theme-color"> — the most deliberate colour statement a site makes.
  for (const m of html.matchAll(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/gi)) {
    add(m[1]!, 100, 'meta theme-color');
  }
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/gi)) {
    add(m[1]!, 100, 'meta theme-color');
  }

  // 2. CSS custom properties: `--brand: #c8a15a`. A named token is a decision —
  //    but only when the TOKEN belongs to this site rather than to its CMS.
  //
  //    WordPress inlines its whole editor chrome into the front-end `<style>`:
  //    `--wp-admin-theme-color: #007cba`, `--wp-block-synced-color: #7a00df`,
  //    plus the full `--wp--preset--color--*` swatch set. None of it is ever
  //    painted on the page a visitor sees. Before this filter, M.K Hair
  //    Studio's "brand colour" came out as #7a00df — the purple WordPress uses
  //    to outline a synced block in its own admin UI.
  for (const m of html.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) {
    const name = m[1]!.toLowerCase();
    if (isFrameworkToken(name)) continue;
    const named = /(?:brand|primary|accent|main|theme|color|colour)/.test(name);
    add(m[2]!.slice(0, 7), named ? 60 : 20, 'css variable');
  }

  // 3. Plain declarations, weighted by how often they appear.
  for (const m of html.matchAll(/(?:^|[;{"'\s])(?:background(?:-color)?|color|border-color|fill|stroke)\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/gi)) {
    add(m[1]!, 3, 'css declaration');
  }
  for (const m of html.matchAll(/(?:^|[;{"'\s])(?:background(?:-color)?|color|border-color|fill|stroke)\s*:\s*rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    add(toHex({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }), 3, 'css declaration');
  }

  return [...found.values()]
    .sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex))
    .slice(0, 8);
}

/** Generic families and system stacks — present everywhere, chosen by nobody. */
const GENERIC_FONTS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
  'ui-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'revert',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'helvetica', 'helvetica neue',
  'arial', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji',
  'sans', 'tahoma', 'verdana', 'times', 'times new roman', 'courier', 'courier new',
]);

/**
 * Font families the captured page actually asks for, in the order the page
 * itself ranks them. A Google Fonts `<link>` is the strongest signal (the site
 * paid a network round-trip for it); `@font-face` and `font-family` follow.
 *
 * Generic fallbacks are dropped: "sans-serif" is not this business's typeface.
 */
export function fontsFromHtml(rawHtml: string): string[] {
  // Entities are decoded FIRST, before any matching. An escaped stylesheet
  // writes `font-family:&quot;Playfair Display&quot;`, and the declaration
  // matcher's `[^;}"']+` class stops dead at the semicolon INSIDE `&quot;` —
  // so the family came out as the literal string `&quot` and the real typeface
  // was never seen. (Observed on trendyhair.gr.)
  const html = decodeEntities(rawHtml);
  const scored = new Map<string, number>();
  const add = (raw: string, weight: number) => {
    const name = raw.trim()
      // HTML-escaped stylesheets yield `&quot;Playfair Display&quot;`; splitting
      // that on the comma leaves a bare `&quot` as a "font family".
      .replace(/&quot;|&#0?34;|&apos;|&#0?39;/g, '')
      .replace(/^["']|["']$/g, '')
      .replace(/\+/g, ' ')
      .trim();
    if (!name || name.length > 48) return;
    if (GENERIC_FONTS.has(name.toLowerCase())) return;
    if (/^var\(|^\d/.test(name)) return;
    // A family name is words, not a fragment: `dl-icon` and `FontAwesome` are
    // icon fonts, not typefaces the brand chose to read in.
    if (!/\p{L}{2}/u.test(name)) return;
    if (/^(?:fa|fontawesome|icomoon|glyphicons|material icons|dashicons|[\w-]*-?icons?)$/i.test(name)) return;
    scored.set(name, (scored.get(name) ?? 0) + weight);
  };

  // Google Fonts / Adobe Fonts links: `family=EB+Garamond:wght@400;700&family=...`
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'<>]+)/gi)) {
    for (const fam of m[1]!.matchAll(/family=([^&:"']+)/gi)) add(decodeURIComponent(fam[1]!), 50);
  }
  for (const m of html.matchAll(/@font-face[^}]*?font-family\s*:\s*([^;}]+)/gi)) add(m[1]!, 30);
  // Quotes are INSIDE the class, not terminators: `font-family:"Noto Sans",…`
  // is one declaration, and excluding `"` would truncate it to nothing.
  for (const m of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    // Only the FIRST family in a stack is the intended face; the rest are fallbacks.
    add(m[1]!.split(',')[0]!, 5);
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
    .slice(0, 6);
}

/**
 * The profile picture URL out of a captured Instagram/Facebook page.
 *
 * `og:image` on a profile page IS the avatar on both networks (verified against
 * the captured pages of the Patras run), and it is the one image URL that
 * survives in the static HTML — the rendered <img> src lives behind their
 * hydration. Returns null rather than a guess when the tag is absent.
 */
export function avatarUrlFromHtml(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /"profile_pic_url_hd"\s*:\s*"([^"]+)"/i,
    /"profile_pic_url"\s*:\s*"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (!m) continue;
    const url = m[1]!.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

/**
 * The business's own words about itself, out of a captured page.
 *
 * Meta description first: on Instagram and Facebook it carries the bio
 * verbatim. But the meta tags alone are frequently NOT enough — measured on the
 * real Patras captures, Instagram's og:description for `@extehairdesign` is
 * "297 ακόλουθοι, ακολουθεί 374 χρήστες, 5 δημοσιεύσεις", i.e. follower counts,
 * and M.K Hair Studio's whole website description is "Αρχική". Classifying a
 * brand voice from that is not possible, and the model correctly answered null
 * for all three businesses when this function returned only the meta tags.
 *
 * So visible body copy is included too, with the platform chrome that surrounds
 * it stripped. Body text is what a visitor actually reads, which is exactly the
 * register the classification is trying to name.
 */
export function bioFromHtml(html: string): string {
  const out: string[] = [];
  for (const re of [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  ]) {
    const m = re.exec(html);
    if (m?.[1]) out.push(decodeEntities(m[1]));
  }
  const body = visibleTextFromHtml(html);
  if (body) out.push(body);
  return [...new Set(out)].join('\n').slice(0, 6_000);
}

/**
 * Platform boilerplate that appears on every Instagram/Facebook page and every
 * cookie-consent banner. It is not the business's voice and, left in, it is the
 * loudest text on the page.
 */
const CHROME_LINES = new RegExp([
  // English platform / consent chrome
  '^(?:log ?in|sign ?up|about|help|press|api|jobs|privacy|terms|locations|popular|',
  'meta(?: ai| verified)?|threads|instagram lite|contact uploading|non-users|cookie|accept|',
  'skip to content|shopping cart|start typing|shop now|home|blog|gallery|shop|search|',
  'view more posts|©|besbswy)',
  // Greek equivalents, which is what these captures are actually in
  '|^(?:σύνδεση|εγγραφή|πληροφορίες|ιστολόγιο|θέσεις εργασίας|βοήθεια|απόρρητο|',
  'όροι χρήσης|τοποθεσίες|δημοφιλή|ελληνικά|απαραίτη|δέχομαι|αποδοχή|μενού|',
  'μετάβαση στο περιεχόμενο|εμφάνιση περισσότερων|ανέβασμα επαφών|',
  'κανένα προϊόν|καλάθι|αναζήτηση)',
  // Follower/post counters: a number and a platform noun, never a voice
  '|\\d+\\s*(?:posts|followers|following|δημοσιεύσεις|ακόλουθοι|ακολουθεί|χρήστες)',
].join(''), 'i');

/**
 * Visible copy from captured HTML, without script/style/nav noise.
 *
 * A regex stripper rather than a DOM parse: the captured HTML is already
 * post-hydration (Playwright stored `page.content()`), there is no DOM library
 * in this project, and the consumer is an LLM that tolerates rough text. It
 * only has to be good enough to judge register.
 */
export function visibleTextFromHtml(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block-level tags become line breaks so headings do not fuse into prose.
    .replace(/<\/?(?:p|div|br|h[1-6]|li|tr|section|article|header|footer|nav)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(stripped)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3 && l.length <= 300)
    .filter((l) => !CHROME_LINES.test(l))
    // A line of pure punctuation or digits carries no register.
    .filter((l) => /\p{L}{3}/u.test(l));
  return [...new Set(lines)].slice(0, 60).join('\n').slice(0, 5_000);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// ── the voice call ──────────────────────────────────────────────────────────

const VoiceSchema = z.object({
  /**
   * One or two words. Free-form rather than an enum on purpose: a business can
   * be "warm-traditional" and forcing it into the nearest of five buckets is a
   * worse answer than letting the model say so, since nothing downstream
   * branches on the exact string.
   */
  tone: z.string().min(2).max(40).nullable(),
  formality: z.enum(['formal', 'neutral', 'casual']).nullable(),
  /** Phrases the business uses about ITSELF, copied from the evidence. */
  selfDescribedAs: z.array(z.string()).max(8),
  /** Brand elements the text explicitly names: a slogan, a colour, a symbol. */
  statedBrandElements: z.array(z.string()).max(8),
  /** Which SOURCE block the answer was read in. */
  sourceRef: z.string().nullable(),
  reasoning: z.string().min(1),
});

const VOICE_SYSTEM = `You classify the BRAND VOICE of a local business from its own published words.

You are not writing copy and not describing the business. You are naming the register its
own text is written in, so a designer can match it.

ABSOLUTE RULES:
1. Use ONLY the text in the SOURCE blocks. You have no other knowledge of this business.
2. \`sourceRef\` must name the block you read the answer in ("S1", "S2"...). No block, no answer.
3. \`selfDescribedAs\` and \`statedBrandElements\` are QUOTES or near-quotes from the evidence.
   Never paraphrase them into marketing language, and never add one that is not there.
4. If the evidence is too thin to judge (an empty bio, a name and nothing else), return null
   for tone and formality and say so in \`reasoning\`. An honest null is a correct answer;
   a confident guess is a wrong one.
5. \`tone\` is one or two words for the register — e.g. playful, luxury, minimal, warm,
   clinical, bold, traditional, editorial, street. Judge the WORDS, not the business type:
   a barber whose bio is three emoji and a booking link is playful, not traditional.`;

// ── evidence loading ────────────────────────────────────────────────────────

interface SourceRow { id: number; sourceType: string; url: string; rawObjectKey: string | null; capturedAt: Date }

/** Most recent capture per source type — an older version is superseded evidence. */
function latestPerType(rows: SourceRow[], type: string): SourceRow | null {
  const of = rows.filter((r) => r.sourceType === type && r.rawObjectKey);
  if (of.length === 0) return null;
  return of.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0]!;
}

/**
 * The social capture that is actually THIS business's profile.
 *
 * Social discovery captures every candidate it checked, including the ones it
 * REJECTED — that record is deliberate (it is how "why did you miss X?" stays
 * answerable). But it means `business_sources` holds several instagram rows for
 * one business, and only one of them is the business.
 *
 * Found for real on `exte hair design`: six instagram captures, of which the
 * newest was `@giannismolfetas` — a customer who posted from the venue and was
 * scored `weak`. Taking "the latest instagram capture" put a stranger's profile
 * picture forward as the salon's brand colour. Reading the palette off a
 * different person's avatar is exactly the class of invention the evidence
 * rules exist to prevent, so the source is now chosen by the VERIFIED contact
 * row, and a business with no verified profile gets no avatar palette at all.
 */
function ownProfileSource(
  rows: SourceRow[],
  contacts: Array<{ channel: string; value: string; sourceId: number | null; verified: boolean }>,
  platform: 'instagram' | 'facebook',
): SourceRow | null {
  const verified = contacts.filter((c) => c.channel === platform && c.verified && c.sourceId);
  for (const c of verified) {
    const hit = rows.find((r) => r.id === c.sourceId && r.rawObjectKey);
    if (hit) return hit;
  }
  return null;
}

async function readHtml(key: string): Promise<string | null> {
  try {
    return (await getObject('raw', key)).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Palette of a stored asset. `keepExtremes` for logos: a wordmark that is
 * deliberately pure black has black as its brand colour, and dropping it would
 * report the anti-aliasing halo instead.
 */
async function paletteOfAsset(
  page: Page,
  objectKey: string,
  contentType: string | null,
  opts: { keepExtremes?: boolean; maxColours?: number },
): Promise<PaletteEntry[] | null> {
  let buf: Buffer;
  try {
    buf = await getObject('assets', objectKey);
  } catch {
    return null;
  }
  const decoded = await decodeImage(page, buf, contentType ?? 'image/jpeg');
  if (!decoded) return null;
  const { palette } = paletteFromImage(decoded, opts);
  return palette.length ? palette : null;
}

/**
 * Downloads a remote image (a social avatar) and returns its palette.
 *
 * The URL comes out of SCRAPED HTML — an `og:image` tag whose value is chosen
 * by whoever controls the captured page. Fetching it from a worker that sits
 * inside the compose network, next to `minio` (every raw evidence object),
 * `postgres` and the gosom API, is a server-side request forgery primitive, so
 * it goes through `safeFetchImage`: http/https only, DNS resolved and checked
 * against the private/loopback/link-local ranges, redirects revalidated per
 * hop, and the body capped at 10 MB and `image/*`.
 *
 * Returns the reason on a block instead of a bare null, so the caller can
 * record WHY the avatar was not read — a silent null here would be
 * indistinguishable from "the CDN link expired".
 */
async function paletteOfUrl(
  page: Page,
  url: string,
): Promise<{ palette: PaletteEntry[] } | { blocked: string }> {
  const res = await safeFetchImage(url, { maxBytes: 10 * 1024 * 1024, timeoutMs: 15_000 });
  if ('blocked' in res) return res;
  const decoded = await decodeImage(page, res.buffer, res.contentType);
  if (!decoded) return { blocked: 'image could not be decoded' };
  const { palette } = paletteFromImage(decoded, { keepExtremes: true, maxColours: 5 });
  return palette.length ? { palette } : { blocked: 'image yielded no usable colours' };
}

// ── main entry point ────────────────────────────────────────────────────────

export interface BrandIdentityOptions {
  /** Reuse an already-open browser (enrich has one). */
  browser?: Browser;
  /** Skip the single agent call; the deterministic half still runs. */
  skipVoice?: boolean;
  /**
   * Skip the agent-led read and use the deterministic measurement only.
   *
   * For tests and for any caller that must not spend a subscription call. It is
   * NOT how a colours-only refresh works: `refresh-brand` deliberately re-runs
   * the agent, because re-ranking a logo is exactly the case where a designer's
   * reading changes.
   */
  skipAgent?: boolean;
  /** Compute without writing facts — used by the verification script. */
  dryRun?: boolean;
  /** Cap on photographs sampled for the fallback palette. */
  maxPhotos?: number;
  /**
   * Keep an existing `brand.voice` fact instead of dropping it.
   *
   * `collect-assets` re-runs the extraction the moment the logo file lands,
   * with `skipVoice` on — a second subscription call would buy nothing, because
   * downloading photographs changes no bio. Without this flag the rewrite would
   * delete the voice the enrich pass paid for.
   */
  preserveVoice?: boolean;
}

/**
 * Extracts and (unless `dryRun`) persists the brand identity for one business.
 *
 * Never throws for ordinary failure. An unreadable capture, an undecodable
 * logo, a rate-limited voice call — each degrades to a note plus a narrower
 * result, and a total miss returns `gap: 'brand_unresolved'`.
 */
export async function extractBrandIdentity(
  businessId: string,
  opts: BrandIdentityOptions = {},
): Promise<BrandIdentity> {
  const out: BrandIdentity = {
    businessId,
    primary: null, accent: null, background: null, onDark: null,
    accentOnLight: null, accentOnDark: null,
    agent: null,
    logoColors: null, avatarColors: null, siteColors: null, photoColors: null,
    fontsSeen: null, voice: null,
    paletteSource: 'none',
    notes: [],
    gap: null,
  };

  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);

  const sourceRows = await db.select().from(schema.businessSources)
    .where(eq(schema.businessSources.businessId, businessId)) as SourceRow[];
  const assetRows = await db.select().from(schema.assets)
    .where(eq(schema.assets.businessId, businessId));
  const contactRows = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));

  const ownBrowser = !opts.browser;
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const { launchBrowser } = await import('./capture.js');
    browser = opts.browser ?? await launchBrowser();
    page = await newDecodePage(browser);

    // ── 1. Logo asset — the highest-authority colour evidence ───────────────
    //
    // The logo's own `source_id` is not stored on `assets`, so the fact cites
    // the capture that OFFERED it: the owned-website capture when the logo came
    // off the site, the gosom listing otherwise. That is the honest answer —
    // it names the page a person can open to see the logo in place.
    const logoAsset = assetRows.find((a) => a.intendedUsage === 'logo' && !a.aiGenerated);
    const siteSource = latestPerType(sourceRows, 'owned_website');
    const gosomSource = sourceRows.find((r) => r.sourceType === 'google_maps');
    if (logoAsset) {
      const colors = await paletteOfAsset(page, logoAsset.objectKey, logoAsset.contentType, {
        keepExtremes: true, maxColours: 5,
      });
      const sourceId = (logoAsset.sourceType === 'owned_website' ? siteSource?.id : gosomSource?.id)
        ?? siteSource?.id ?? gosomSource?.id ?? null;
      // A wordmark drawn in white (or black) on transparency decodes to a
      // single near-neutral, which is true and unusable: "this brand's colour
      // is #ffffff" would send the art director nowhere. Observed on M.K Hair
      // Studio, whose logo is a white PNG. Re-read it WITHOUT keepExtremes so
      // any real colour in the mark surfaces; if there is none, the logo is
      // genuinely monochrome and the palette falls through to the next
      // evidence rather than reporting white as an identity.
      if (!colors) {
        out.notes.push(`logo asset ${logoAsset.objectKey} could not be decoded`);
      } else {
        const hasColour = (pal: PaletteEntry[]) => pal.some((c) => c.hsl.s >= 0.12 && c.hsl.l > 0.08 && c.hsl.l < 0.94);
        // Re-read without keepExtremes only when the first pass was all
        // near-neutrals: a real colour may be hiding under a dominant white
        // field. Any colour it finds is the mark's colour.
        const finalColors = hasColour(colors)
          ? colors
          : await paletteOfAsset(page, logoAsset.objectKey, logoAsset.contentType, { maxColours: 4 })
            .then((pal) => (pal && hasColour(pal) ? pal : null));
        if (!finalColors) {
          out.notes.push('logo is monochrome (no saturated colour) — falling through to the next evidence');
        } else if (sourceId) {
          out.logoColors = { colors: finalColors, sourceId, from: `logo asset ${logoAsset.objectKey.split('/').pop()}` };
        } else {
          out.notes.push('logo decoded but no capture to cite as its source — not written');
        }
      }
    }

    // ── 2. Social avatar — the logo of a business that has no logo file ─────
    for (const type of ['instagram', 'facebook'] as const) {
      if (out.avatarColors) break;
      const src = ownProfileSource(sourceRows, contactRows, type);
      if (!src?.rawObjectKey) {
        if (sourceRows.some((r) => r.sourceType === type)) {
          out.notes.push(`${type} pages were captured but none is a verified profile of this business — no avatar read`);
        }
        continue;
      }
      const html = await readHtml(src.rawObjectKey);
      if (!html) { out.notes.push(`${type} capture unreadable (${src.rawObjectKey})`); continue; }
      const avatarUrl = avatarUrlFromHtml(html);
      if (!avatarUrl) { out.notes.push(`${type} capture carries no profile image URL`); continue; }
      const read = await paletteOfUrl(page, avatarUrl);
      if ('palette' in read) {
        out.avatarColors = { colors: read.palette, sourceId: src.id, from: `${type} profile picture` };
      } else {
        // Instagram CDN URLs expire, and a scraped URL can also be refused by
        // the SSRF guard. Both are facts about the evidence, never a reason to
        // invent a colour — and the reason is recorded so a refusal is legible
        // rather than looking like an expired link.
        out.notes.push(`${type} profile image not read: ${read.blocked}`);
      }
    }

    // ── 3. The site's own declared colours and fonts ────────────────────────
    if (siteSource?.rawObjectKey) {
      const html = await readHtml(siteSource.rawObjectKey);
      if (html) {
        const declared = colorsFromHtml(html);
        if (declared.length) {
          out.siteColors = {
            sourceId: siteSource.id,
            from: `colours declared in ${siteSource.url}`,
            // `share` here means "relative weight among declarations", not pixel
            // share; the field is reused so the fact shape stays one thing.
            colors: declared.map((d) => {
              const rgb = fromHex(d.hex)!;
              const hsl = rgbToHsl(rgb);
              const totalWeight = declared.reduce((n, x) => n + x.weight, 0);
              return {
                hex: d.hex,
                share: Number((d.weight / totalWeight).toFixed(4)),
                hsl: { h: Number(hsl.h.toFixed(1)), s: Number(hsl.s.toFixed(3)), l: Number(hsl.l.toFixed(3)) },
              };
            }),
          };
        }
        const fonts = fontsFromHtml(html);
        if (fonts.length) out.fontsSeen = { fonts, sourceId: siteSource.id };
      } else {
        out.notes.push(`owned-website capture unreadable (${siteSource.rawObjectKey})`);
      }
    }

    // ── 4. Photograph palette — the fallback, now measured ──────────────────
    const photos = assetRows
      .filter((a) => !a.aiGenerated && (a.contentType ?? '').startsWith('image/') && a.intendedUsage !== 'logo')
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
      .slice(0, opts.maxPhotos ?? 6);
    if (photos.length) {
      const merged: PaletteEntry[] = [];
      for (const p of photos) {
        const pal = await paletteOfAsset(page, p.objectKey, p.contentType, { maxColours: 4 });
        if (!pal) continue;
        // Each photo contributes equally, so one oversized image cannot decide
        // the palette of a whole gallery.
        for (const c of pal) merged.push({ ...c, share: c.share / photos.length });
      }
      if (merged.length) {
        const byHex = new Map<string, PaletteEntry>();
        for (const c of merged) {
          const hit = byHex.get(c.hex);
          if (hit) hit.share = Number((hit.share + c.share).toFixed(4));
          else byHex.set(c.hex, { ...c });
        }
        const colors = [...byHex.values()]
          .sort((a, b) => b.share - a.share || a.hex.localeCompare(b.hex))
          .slice(0, 6);
        const sourceId = gosomSource?.id ?? siteSource?.id ?? null;
        if (sourceId) {
          out.photoColors = { colors, sourceId, from: `${photos.length} collected photograph(s)` };
        } else {
          out.notes.push('photo palette computed but no capture to cite as its source — not written');
        }
      }
    }

    // ── 5. Choose the palette the design must start from ────────────────────
    //
    // AGENT FIRST (Roman, 2026-08-21: "Айдентику і кольори має формувати
    // агент... Агент зробить це краще"). A designer agent looks at the same
    // material the steps above measured — the logo file, the profile
    // screenshot, the site as rendered, the photographs — and names the roles.
    // Every hex it names is re-derived from the file it cited before anything
    // is written (`brandAgent.ts`), so the difference from the deterministic
    // path is WHICH real colour becomes the accent, never whether the colour
    // is real.
    //
    // The measurement below is not deleted by this: `logoColors`,
    // `avatarColors`, `siteColors` and `photoColors` are still written, so the
    // design contract keeps its full scales and a person can see what the
    // agent chose FROM. When the agent fails or every hex it named is
    // ungrounded, the deterministic ranking runs exactly as it always did.
    if (!opts.skipAgent) {
      const outcome = await runBrandAgent(businessId, biz.name, {
        browser: browser ?? undefined,
        maxPhotos: opts.maxPhotos,
      });
      if (outcome) {
        const role = (name: GroundedRole['role']) => outcome.roles.find((r) => r.role === name) ?? null;
        const asFact = (r: GroundedRole | null) =>
          (r ? { hex: r.hex, sourceId: r.sourceId, from: `${r.why} (read from ${r.file})` } : null);
        const primary = role('primary') ?? role('accent');
        if (primary) {
          out.paletteSource = 'agent';
          out.primary = asFact(primary);
          out.accent = asFact(role('accent') ?? primary);
          out.background = asFact(role('background'));
          out.onDark = asFact(role('onDark'));
          if (out.accent) {
            const rgb = fromHex(out.accent.hex)!;
            // `accentOnLight` / `accentOnDark` are named for the GROUND, and
            // every consumer reads them that way. So a ground the agent named
            // is used only for the side it actually is: an agent that calls a
            // near-black its `background` supplies the dark correction, not the
            // light one, and the other side keeps the standard ground. Sorting
            // by luminance rather than by field name is what keeps the two
            // labels honest.
            const named = [out.background, out.onDark]
              .map((r) => (r ? fromHex(r.hex) : null))
              .filter((c): c is NonNullable<typeof c> => c !== null);
            const lightGround = named.filter((c) => luminance(c) >= 0.4)
              .sort((a, b) => luminance(b) - luminance(a))[0] ?? { r: 250, g: 249, b: 246 };
            const darkGround = named.filter((c) => luminance(c) < 0.4)
              .sort((a, b) => luminance(a) - luminance(b))[0] ?? { r: 18, g: 18, b: 20 };
            out.accentOnLight = toHex(contrastCorrect(rgb, lightGround, 4.5));
            out.accentOnDark = toHex(contrastCorrect(rgb, darkGround, 4.5));
          }
          out.agent = {
            typography: outcome.typography
              ? {
                  family: outcome.typography.family, weight: outcome.typography.weight,
                  case: outcome.typography.case, notes: outcome.typography.notes,
                  sourceIds: outcome.typography.sourceIds,
                }
              : null,
            mood: outcome.mood,
            photographyStyle: outcome.photographyStyle,
            confidence: outcome.confidence,
            files: outcome.inputs.map((i) => i.file),
          };
          out.notes.push(...outcome.notes);
        } else {
          out.notes.push('brand agent named no primary colour that survived grounding');
        }
      }
    }

    // Authority order, not quality order: a logo is a decision somebody made,
    // a photograph is a room somebody stood in. Both are real; only one is
    // an identity. This runs only when the agent did not produce a palette.
    const ranked: Array<[BrandIdentity['paletteSource'], BrandIdentity['logoColors']]> = [
      ['logo', out.logoColors],
      ['avatar', out.avatarColors],
      ['site', out.siteColors],
      ['photos', out.photoColors],
    ];
    // A palette can outrank a lower one on authority and still be useless: M.K
    // Hair Studio's website declares nothing but greys, while its photographs
    // carry a real warm range. Authority decides between two palettes that can
    // both key a design; a palette with NO accent at all loses to one that has
    // one, because "the brand colour is #32373c" gives the art director nothing
    // to build with and silently reintroduces the sameness this fixes.
    const withAccent = ranked.filter(([, hit]) => hit && pickAccent(hit.colors));
    const order = out.primary ? [] : (withAccent.length ? withAccent : ranked);
    for (const [kind, hit] of order) {
      if (!hit) continue;
      const accent = pickAccent(hit.colors);
      const { darkest, lightest } = pickNeutrals(hit.colors);
      // A palette with no usable accent (a pure greyscale wordmark) still gives
      // a real primary; it just does not give the design an accent to key on,
      // and saying so beats inventing one.
      const primary = accent ?? hit.colors[0] ?? null;
      if (!primary) continue;
      out.paletteSource = kind;
      out.primary = { hex: primary.hex, sourceId: hit.sourceId, from: hit.from };
      if (accent) {
        out.accent = { hex: accent.hex, sourceId: hit.sourceId, from: hit.from };
        const rgb = fromHex(accent.hex)!;
        out.accentOnLight = toHex(contrastCorrect(rgb, { r: 250, g: 249, b: 246 }, 4.5));
        out.accentOnDark = toHex(contrastCorrect(rgb, { r: 18, g: 18, b: 20 }, 4.5));
      } else {
        out.notes.push(`${kind} palette has no colour saturated enough to be an accent`);
      }
      // Neutrals are reported as notes rather than facts: they are a reading of
      // the same palette, and a second fact would imply second evidence.
      if (darkest && lightest) {
        out.notes.push(`${kind} range: darkest ${darkest.hex} (L=${darkest.hsl.l}), lightest ${lightest.hex} (L=${lightest.hsl.l})`);
      }
      break;
    }

    // ── 6. Voice — the one non-mechanical call ──────────────────────────────
    if (!opts.skipVoice) {
      const voiceBlocks: Array<{ ref: string; sourceId: number; label: string; text: string }> = [];
      let n = 0;
      for (const type of ['instagram', 'facebook', 'owned_website'] as const) {
        // Same rule as the avatar: a rejected candidate's bio is somebody
        // else's voice, and classifying it as this business's register would
        // be worse than returning nothing.
        const src = type === 'owned_website'
          ? latestPerType(sourceRows, type)
          : ownProfileSource(sourceRows, contactRows, type);
        if (!src?.rawObjectKey) continue;
        const html = await readHtml(src.rawObjectKey);
        if (!html) continue;
        const bio = bioFromHtml(html);
        if (bio.trim().length < 12) continue;
        voiceBlocks.push({ ref: `S${++n}`, sourceId: src.id, label: `${type} — ${src.url}`, text: bio });
      }
      // The listing's own description is the business's words too, and for a
      // Maps-only business it is the only text there is.
      const descFact = await db.select().from(schema.businessFacts).where(and(
        eq(schema.businessFacts.businessId, businessId),
        eq(schema.businessFacts.key, 'identity.description'),
      ));
      if (descFact[0]?.sourceId && typeof descFact[0].value === 'string') {
        voiceBlocks.push({
          ref: `S${++n}`, sourceId: descFact[0].sourceId,
          label: 'extracted identity description', text: String(descFact[0].value),
        });
      }

      if (voiceBlocks.length === 0) {
        out.notes.push('no bio or description text captured — brand voice not classified');
      } else {
        try {
          const voice = await runAgent(
            'brand-voice',
            VOICE_SYSTEM,
            [
              `Business: ${biz.name}`,
              `Category: ${biz.category ?? 'unknown'}`,
              '',
              ...voiceBlocks.map((b) => `=== SOURCE ${b.ref} (${b.label}) ===\n${b.text}`),
            ].join('\n'),
            VoiceSchema,
            { kind: 'enrichment', timeoutMs: 5 * 60_000 },
          );
          const cited = voiceBlocks.find((b) => b.ref === voice.sourceRef?.trim().toUpperCase());
          if (!cited) {
            // Same rule as every other fact in the pipeline: a claim that cannot
            // name its evidence is dropped, not stored with a shrug.
            out.notes.push(`brand voice cited unknown source "${voice.sourceRef}" — dropped`);
          } else if (!voice.tone && !voice.formality) {
            out.notes.push(`brand voice not determinable: ${voice.reasoning.slice(0, 160)}`);
          } else {
            out.voice = {
              tone: voice.tone ?? 'unstated',
              formality: voice.formality ?? 'neutral',
              selfDescribedAs: voice.selfDescribedAs,
              statedBrandElements: voice.statedBrandElements,
              sourceRef: voice.sourceRef!,
              reasoning: voice.reasoning,
              sourceId: cited.sourceId,
            };
          }
        } catch (err) {
          // A rate-limited or failed voice call must not cost the palette.
          out.notes.push(`brand voice call failed: ${String(err).slice(0, 160)}`);
        }
      }
    }

    // Carry the previously-classified voice through a colours-only refresh, so
    // the rewrite in `persistBrandFacts` does not delete it.
    if (opts.skipVoice && opts.preserveVoice && !out.voice) {
      const prior = await db.select().from(schema.businessFacts).where(and(
        eq(schema.businessFacts.businessId, businessId),
        eq(schema.businessFacts.key, 'brand.voice'),
      ));
      const v = prior[0];
      if (v?.sourceId && v.value && typeof v.value === 'object') {
        const val = v.value as Record<string, unknown>;
        out.voice = {
          tone: String(val.tone ?? 'unstated'),
          formality: (val.formality as BrandVoice['formality']) ?? 'neutral',
          selfDescribedAs: Array.isArray(val.selfDescribedAs) ? val.selfDescribedAs.map(String) : [],
          statedBrandElements: Array.isArray(val.statedBrandElements) ? val.statedBrandElements.map(String) : [],
          sourceRef: 'carried-forward',
          reasoning: String(val.reasoning ?? ''),
          sourceId: v.sourceId,
        };
      }
    }

    if (!out.primary && !out.voice && !out.fontsSeen) {
      out.gap = 'brand_unresolved';
    }

    if (!opts.dryRun) await persistBrandFacts(out);
    return out;
  } catch (err) {
    log.warn('brand identity extraction failed', { businessId, err: String(err).slice(0, 300) });
    out.gap = 'brand_unresolved';
    out.notes.push(`brand extraction error: ${String(err).slice(0, 200)}`);
    return out;
  } finally {
    if (ownBrowser && browser) await browser.close().catch(() => {});
  }
}

/**
 * Writes the brand facts, replacing any previous `brand.*` rows for this
 * business. Replacement rather than append: a re-extraction after a new capture
 * is a better reading of the same identity, and two contradictory palettes in
 * the table would make the snapshot's answer depend on row order.
 */
export async function persistBrandFacts(brand: BrandIdentity): Promise<number> {
  const rows: (typeof schema.businessFacts.$inferInsert)[] = [];
  const add = (key: string, value: unknown, sourceId: number, confidence: number, method = 'deterministic') => {
    rows.push({
      businessId: brand.businessId, key, value: value as never, sourceId,
      extractionMethod: method, confidence, verified: true,
    });
  };

  // `agent_grounded` is a third extraction method next to `deterministic` and
  // `llm_structured`, and it means something narrower than either: a model
  // named the value, and CODE re-derived it from the cited evidence before it
  // was written. A reader can tell at a glance which path produced a palette.
  const method = brand.paletteSource === 'agent' ? 'agent_grounded' : 'deterministic';
  if (brand.primary) {
    add('brand.palette_primary', {
      hex: brand.primary.hex, from: brand.primary.from, paletteSource: brand.paletteSource,
    }, brand.primary.sourceId, 1, method);
  }
  if (brand.accent) {
    add('brand.palette_accent', {
      hex: brand.accent.hex, from: brand.accent.from,
      onLight: brand.accentOnLight, onDark: brand.accentOnDark,
      contrastOnLight: brand.accentOnLight
        ? Number(contrastRatio(fromHex(brand.accentOnLight)!, { r: 250, g: 249, b: 246 }).toFixed(2)) : null,
    }, brand.accent.sourceId, 1, method);
  }
  // The agent-led additions. Each carries the source_id of the capture behind
  // the file its reading came from, exactly like every measured colour above,
  // and `extractionMethod` says which of the two paths produced it.
  if (brand.background) {
    add('brand.palette_background', { hex: brand.background.hex, from: brand.background.from },
      brand.background.sourceId, 1, 'agent_grounded');
  }
  if (brand.onDark) {
    add('brand.palette_on_dark', { hex: brand.onDark.hex, from: brand.onDark.from },
      brand.onDark.sourceId, 1, 'agent_grounded');
  }
  if (brand.agent?.typography && brand.agent.typography.sourceIds[0]) {
    const t = brand.agent.typography;
    add('brand.typography', {
      family: t.family, weight: t.weight, case: t.case, notes: t.notes,
    }, t.sourceIds[0], brand.agent.confidence, 'agent_grounded');
  }
  if (brand.agent?.mood.length) {
    // Mood is a reading of ALL the material, so it cites the first capture the
    // agent was shown rather than pretending one file produced it; `files`
    // records the full set.
    const sourceId = brand.primary?.sourceId ?? brand.accent?.sourceId ?? null;
    if (sourceId) {
      add('brand.mood', { mood: brand.agent.mood, files: brand.agent.files },
        sourceId, brand.agent.confidence, 'agent_grounded');
    }
  }
  if (brand.agent?.photographyStyle && brand.agent.photographyStyle.sourceIds[0]) {
    add('brand.photography_style', {
      style: brand.agent.photographyStyle.text, files: brand.agent.files,
    }, brand.agent.photographyStyle.sourceIds[0], brand.agent.confidence, 'agent_grounded');
  }

  if (brand.logoColors) add('brand.logo_colors', { from: brand.logoColors.from, colors: brand.logoColors.colors }, brand.logoColors.sourceId, 1);
  if (brand.avatarColors) add('brand.avatar_colors', { from: brand.avatarColors.from, colors: brand.avatarColors.colors }, brand.avatarColors.sourceId, 1);
  if (brand.siteColors) add('brand.site_colors', { from: brand.siteColors.from, colors: brand.siteColors.colors }, brand.siteColors.sourceId, 0.9);
  if (brand.photoColors) add('brand.photo_colors', { from: brand.photoColors.from, colors: brand.photoColors.colors }, brand.photoColors.sourceId, 0.8);
  if (brand.fontsSeen) add('brand.fonts_seen', { fonts: brand.fontsSeen.fonts }, brand.fontsSeen.sourceId, 0.9);
  if (brand.voice) {
    add('brand.voice', {
      tone: brand.voice.tone,
      formality: brand.voice.formality,
      selfDescribedAs: brand.voice.selfDescribedAs,
      statedBrandElements: brand.voice.statedBrandElements,
      reasoning: brand.voice.reasoning,
    }, brand.voice.sourceId, 0.75, 'llm_structured');
  }

  await db.delete(schema.businessFacts).where(and(
    eq(schema.businessFacts.businessId, brand.businessId),
    // Every fact this module owns starts `brand.`, and nothing else in the
    // pipeline writes that namespace — so the prefix is a safe scope.
    like(schema.businessFacts.key, 'brand.%'),
  ));
  if (rows.length) await db.insert(schema.businessFacts).values(rows);
  return rows.length;
}

