/**
 * The motion reference pack as data (`references/motion/`).
 *
 * The pack is 60MB of video and 17 long `notes.md` files. Neither fits in a
 * structured agent call, so this module does two things:
 *
 *   1. parses `references/motion/README.md` into the slug→mood index the art
 *      director chooses FROM (a closed vocabulary, so `referenceSlug` can be
 *      code-verified rather than trusted);
 *   2. condenses each `notes.md` down to the two sections that carry the
 *      mechanics — "What makes the wow" and "Reproduce with our stack" — plus
 *      "Don't borrow", which is the part that keeps a premium reference from
 *      shipping a multi-second preloader to a salon owner on 4G.
 *
 * Nothing here calls a model, and the pack is read-only: the pipeline copies
 * `notes.md`, `hero.jpg` and `full.jpg` into a workspace, never the `.webm`
 * (a video the builder cannot watch is 2-6MB of dead weight per build).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const MOTION_REFS_DIR = path.resolve('references', 'motion');

export interface MotionRefIndexEntry {
  /** Directory name under `references/motion/`, e.g. `vero-studio`. */
  slug: string;
  url: string;
  mood: string;
  /** The three headline mechanics from the index table. */
  topMechanics: string[];
  bestFor: string;
}

/**
 * Mechanics named by the art direction map onto template components. This is the
 * vocabulary the design contract and BUILD-TASK.md share; `motionComponents` are
 * the ones the `template-motion` work adds under `components/motion/`, the rest
 * come from the existing pool or are plain CSS/GSAP.
 *
 * Kept as a list rather than an enum so an art direction naming a component that
 * does not exist yet is a *warning in the build task*, not a schema rejection —
 * the pack documents more mechanics than the template will ever ship.
 */
export const MOTION_COMPONENTS = [
  'VideoHero',
  'KenBurnsImage',
  'SpecTags',
  'MaskWipe',
  'Preloader',
  'SplitHeadline',
  'HorizontalRail',
  'MagneticButton',
  'CustomCursor',
  'SplitScreenWipe',
] as const;
export type MotionComponent = (typeof MOTION_COMPONENTS)[number];

/** Photo-grade utility classes shipped in `globals.css` by the motion pack. */
export const PHOTO_GRADES = ['grade-warm', 'grade-cold', 'grade-bronze', 'grade-mono'] as const;

/**
 * Hero motion devices. `none` is deliberately allowed but expensive: the rubric
 * scores it 0 on the hero-motion axis and the critic fails a page whose hero
 * does not move, so choosing it requires a justification the direction states.
 */
export const HERO_MOTION_KINDS = ['video', 'kenburns', 'mask', 'split', 'none'] as const;
export type HeroMotionKind = (typeof HERO_MOTION_KINDS)[number];

/** Which motion component implements each hero device, for the build task. */
export const HERO_MOTION_COMPONENT: Record<HeroMotionKind, string> = {
  video: 'VideoHero',
  kenburns: 'KenBurnsImage',
  mask: 'MaskWipe',
  split: 'SplitScreenWipe',
  none: '(static hero — requires justification)',
};

/**
 * Parse the index table of `references/motion/README.md`.
 *
 * Rows look like:
 * `| **vero-studio** | verostudio.com | Warm editorial… | a; b; c | **Hair salon**… |`
 * The slug is bolded and matches the directory name, which is what makes it
 * usable as a code-checked identifier.
 */
export function parseMotionIndex(readme: string): MotionRefIndexEntry[] {
  const entries: MotionRefIndexEntry[] = [];
  for (const line of readme.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const slugCell = cells[0]!;
    const m = /^\*\*([a-z0-9-]+)\*\*$/.exec(slugCell);
    if (!m) continue; // header row, separator, or the file-listing table
    entries.push({
      slug: m[1]!,
      url: cells[1]!,
      mood: cells[2]!,
      topMechanics: cells[3]!.split(';').map((s) => s.trim()).filter(Boolean),
      bestFor: cells[4]!.replace(/\*\*/g, ''),
    });
  }
  return entries;
}

/** Read + parse the on-disk index. Empty if the pack is absent. */
export async function loadMotionIndex(dir = MOTION_REFS_DIR): Promise<MotionRefIndexEntry[]> {
  const readmePath = path.join(dir, 'README.md');
  if (!existsSync(readmePath)) return [];
  return parseMotionIndex(await readFile(readmePath, 'utf8'));
}

/** Compact index for a prompt: one line per reference, ~150 chars each. */
export function renderMotionIndexForPrompt(entries: MotionRefIndexEntry[]): string {
  return entries
    .map((e) => `- **${e.slug}** — ${e.mood}. Mechanics: ${e.topMechanics.join('; ')}. Best for: ${e.bestFor}`)
    .join('\n');
}

/**
 * Shortlist the references whose `notes.md` is worth sending in full.
 *
 * The full index (17 lines, ~3.3KB) always goes to the art director so it can
 * choose any slug; condensed notes cost ~4-6KB each, and all seventeen would be
 * ~75KB on top of the 24KB niche pack — enough to make a structured call run out
 * of turns mid-answer, which is how this stage fails in practice.
 *
 * Selection is deterministic: references whose `bestFor` text overlaps the
 * business category, then the index order (which the pack sorts by usefulness for
 * single-location service businesses), until `limit` is reached.
 */
export function shortlistReferences(
  entries: MotionRefIndexEntry[],
  business: { category?: string | null; name?: string | null },
  limit = 5,
): MotionRefIndexEntry[] {
  const haystack = `${business.category ?? ''} ${business.name ?? ''}`.toLowerCase();
  const words = [...new Set(haystack.split(/[^a-zα-ω]+/i).filter((w) => w.length >= 4))];

  const scored = entries.map((e, index) => {
    const bestFor = e.bestFor.toLowerCase();
    const hits = words.filter((w) => bestFor.includes(w)).length;
    return { entry: e, hits, index };
  });
  // Index order is the tie-break, so a business with no category match still gets
  // the pack's own top picks rather than an arbitrary five.
  scored.sort((a, b) => b.hits - a.hits || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.entry);
}

const KEEP_SECTIONS = ['What makes the wow', 'Reproduce with our stack', "Don't borrow"];

/**
 * Cut a `notes.md` down to the sections that describe MECHANICS and how to build
 * them, dropping timing/palette/mobile/performance prose. Typically 7-15KB → 3-5KB.
 *
 * The heading text is matched loosely (`##  What makes the wow`, curly
 * apostrophes) because these files are hand-written.
 */
export function condenseNotes(notes: string, maxChars = 6_000): string {
  const lines = notes.split('\n');
  const kept: string[] = [];

  // The lead block (title + URL/mood/award bullets) identifies the reference.
  for (const line of lines) {
    if (line.startsWith('## ')) break;
    kept.push(line);
  }

  let capturing = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const heading = line.replace(/^##\s+/, '').replace(/[’']/g, "'").trim();
      capturing = KEEP_SECTIONS.some((k) => heading.toLowerCase().startsWith(k.toLowerCase()));
      if (capturing) kept.push('', line);
      continue;
    }
    if (capturing) kept.push(line);
  }

  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n\n…(condensed)` : out;
}

/** Absolute path of one reference directory. */
export function motionRefDir(slug: string, dir = MOTION_REFS_DIR): string {
  return path.join(dir, slug);
}

/** Condensed notes for one slug, or null when the reference does not exist. */
export async function loadCondensedNotes(slug: string, dir = MOTION_REFS_DIR): Promise<string | null> {
  const file = path.join(motionRefDir(slug, dir), 'notes.md');
  if (!existsSync(file)) return null;
  return condenseNotes(await readFile(file, 'utf8'));
}

/**
 * The wow rubric, in one place, so the art director, the direction critic and the
 * visual critic are all judged against the same six axes (motion pack README,
 * "Wow checklist"). 0 = absent, 1 = token, 2 = solid, 3 = genuinely striking.
 */
export const WOW_AXES = [
  {
    key: 'heroMotion',
    label: 'Hero motion',
    three: 'the first screen moves before the visitor touches anything — video, slow zoom, a scroll-linked reveal — and the motion is tied to the content',
    zero: 'a static hero, or a decorative loop unrelated to the subject',
  },
  {
    key: 'scrollChoreography',
    label: 'Scroll choreography',
    three: 'at least one pinned or scrub-linked sequence where scrolling DRIVES the animation',
    zero: 'everything is a uniform fade-up-on-enter',
  },
  {
    key: 'typeAsDesign',
    label: 'Type as design element',
    three: 'display type above 8vw somewhere, deliberate size contrast (~10:1), a cropped or overflowing wordmark, or roman/italic mixing',
    zero: 'one size doing every job; headline and body indistinguishable',
  },
  {
    key: 'photoTreatment',
    label: 'Photo treatment',
    three: 'a consistent grade across all photos; full-bleed or masked; crops chosen (macro/edge-bleed) rather than accepted',
    zero: 'photos dropped into equal rounded cards with shadows',
  },
  {
    key: 'microInteraction',
    label: 'Micro-interaction',
    three: 'hover states that scale/mask/reveal within a cropped container; a considered cursor or custom control',
    zero: 'default link underlines and colour changes only',
  },
  {
    key: 'performanceReducedMotion',
    label: 'Performance & reduced motion',
    three: 'smooth; nothing left at opacity 0 under reduced motion; infinite loops actually disabled; video has a poster',
    zero: 'jank, pop-in, or content invisible when motion is off',
  },
] as const;

export type WowAxisKey = (typeof WOW_AXES)[number]['key'];

/** Max total across the six axes. */
export const WOW_MAX = WOW_AXES.length * 3; // 18
/** Below this the page reads as a default AI template (motion README gating). */
export const WOW_FAIL_THRESHOLD = 9;

/**
 * Axes that measure DESIGN AMBITION rather than hygiene.
 *
 * `performanceReducedMotion` is excluded deliberately: it is a correctness axis,
 * and a page can score 3/3 on it by doing nothing at all (nothing animates, so
 * nothing is broken under reduced motion). The total alone therefore lets a
 * quiet page pass on hygiene points.
 *
 * Measured, not assumed: the Pagoulatos demo Roman rejected scores 10/18 — over
 * the 9 floor — while scoring 1/3 on scroll choreography, photo treatment AND
 * micro-interaction, with a 3/3 for reduced motion doing the lifting. The total
 * is the wrong shape to catch that, so a second condition looks at the ambition
 * axes on their own.
 */
export const WOW_AMBITION_AXES = [
  'heroMotion', 'scrollChoreography', 'typeAsDesign', 'photoTreatment', 'microInteraction',
] as const;

/**
 * A page must be at least "solid" (2) on average across the five ambition axes.
 * 10/15 rather than 9/18: Pagoulatos scores 7/15 here and correctly fails, while
 * a page that is genuinely striking on two axes and solid on the rest clears it.
 */
export const WOW_AMBITION_THRESHOLD = 10;

/** The six axes as prompt text, identical for every consumer of the rubric. */
export function renderWowRubric(): string {
  return WOW_AXES
    .map((a) => `- **${a.key}** (${a.label}) — 3: ${a.three}. 0-1: ${a.zero}.`)
    .join('\n');
}

/**
 * The gate in one sentence, so the art director, the direction critic, the build
 * task and the visual critic all state the same rule. Written once here because
 * four hand-copied versions is four chances to drift from what the code does.
 */
export function renderWowGate(): string {
  return `ALL THREE must hold to pass: total ≥ ${WOW_FAIL_THRESHOLD}/${WOW_MAX}; `
    + `design ambition ≥ ${WOW_AMBITION_THRESHOLD}/${WOW_AMBITION_MAX} across ${WOW_AMBITION_AXES.join(', ')} `
    + `(performanceReducedMotion is EXCLUDED there — a page where nothing animates scores 3/3 on it for free, `
    + `so it cannot be used to buy a pass); and heroMotion > 0.`;
}

/** Sum of the six axes, tolerating a partial object. */
export function wowTotal(scores: Partial<Record<WowAxisKey, number>>): number {
  return WOW_AXES.reduce((sum, a) => sum + (scores[a.key] ?? 0), 0);
}

/** Sum of the five ambition axes only — hygiene excluded. */
export function wowAmbitionTotal(scores: Partial<Record<WowAxisKey, number>>): number {
  return WOW_AMBITION_AXES.reduce((sum, key) => sum + (scores[key] ?? 0), 0);
}

/** Max across the ambition axes. */
export const WOW_AMBITION_MAX = WOW_AMBITION_AXES.length * 3; // 15

/**
 * The gate both the design rubric and the visual critic apply. Three conditions,
 * all of which must hold:
 *
 *   1. total ≥ 9/18 — the pack's own proposed floor;
 *   2. ambition ≥ 10/15 — the five axes that measure design intent rather than
 *      hygiene, because `performanceReducedMotion` scores 3/3 on a page where
 *      nothing animates and can carry a quiet page over the total on its own;
 *   3. hero motion > 0 — a static first screen is the defect Roman rejected, and
 *      it fails whatever the other axes say.
 */
export function wowVerdict(scores: Partial<Record<WowAxisKey, number>>): {
  total: number;
  ambition: number;
  passed: boolean;
  reasons: string[];
} {
  const total = wowTotal(scores);
  const ambition = wowAmbitionTotal(scores);
  const reasons: string[] = [];
  if (total < WOW_FAIL_THRESHOLD) {
    reasons.push(
      `wow total ${total}/${WOW_MAX} is below the ${WOW_FAIL_THRESHOLD}/${WOW_MAX} floor — the page reads as a default AI template`,
    );
  }
  if (ambition < WOW_AMBITION_THRESHOLD) {
    const weak = WOW_AMBITION_AXES.filter((k) => (scores[k] ?? 0) <= 1);
    reasons.push(
      `design ambition ${ambition}/${WOW_AMBITION_MAX} is below the ${WOW_AMBITION_THRESHOLD}/${WOW_AMBITION_MAX} floor`
      + (weak.length ? ` — ${weak.join(', ')} at 0-1. Correct reduced-motion handling does not make a page striking.` : ''),
    );
  }
  if ((scores.heroMotion ?? 0) === 0) {
    reasons.push('hero motion is 0: the first screen does not move, which is the defect this pack exists to prevent');
  }
  return { total, ambition, passed: reasons.length === 0, reasons };
}
