/**
 * Deterministic rubric: the LLM explains, CODE decides (SPEC §2.1 postulate,
 * §4 stage 9 "рубрика обирає").
 *
 * A separate critique call fills in the numeric fields of `DirectionScore`; this
 * module turns those numbers into a winner with a fixed, auditable formula, and
 * applies hard code-side vetoes the critic cannot override (Greek font subset,
 * hero asset that does not exist, more than 4 pool components).
 *
 * Nothing here calls a model. It is unit-testable and produces the same answer
 * for the same inputs, which is why the choice survives in the QA report.
 */
import type { ArtDirection, DirectionScore } from './schemas.js';
import { fromHex } from '../enrichment/colorExtract.js';
import { GREEK_SAFE_BODY, GREEK_SAFE_DISPLAY } from './schemas.js';
import { WOW_FAIL_THRESHOLD, WOW_MAX, wowTotal, wowVerdict } from './motionRefs.js';
import type { BuildSnapshot } from './snapshot.js';

/**
 * Weights sum to 1.0 over the positive axes; penalties are subtracted after.
 *
 * `wow` joins them as a first-class axis rather than a tie-breaker: Roman
 * rejected a demo that scored respectably on every other axis because nothing on
 * it moved. It is normalised from 0-18 to 0-10 in `scoreDirection` so all axes
 * share one scale, and it is weighted above everything except distinctiveness.
 */
const WEIGHTS = {
  structuralDistinctiveness: 0.20,
  evidenceFit: 0.17,
  typographicCraft: 0.14,
  referenceGrounding: 0.09,
  motionRestraint: 0.08,
  wow: 0.20,
  // Roman's second rejection was not about motion: "Чого всі демо в одному
  // стилі? … Береш їхні кольори, айдентику?" A direction that ignores the
  // measured brand palette produces a page that is competent and
  // interchangeable, which is the exact failure. Weighted alongside
  // distinctiveness because it is the same failure seen from the other side:
  // distinctiveness asks "is this page unlike a template", brandFit asks "is it
  // unlike the OTHER pages this factory made".
  brandFit: 0.12,
} as const;

/** Slop is the failure mode this whole design stack exists to prevent, so it bites hardest. */
const SLOP_PENALTY = 1.1;
const BUILD_RISK_PENALTY = 0.5;

/** Fonts on the DESIGN.md ban-list: they mark a page as machine-made on sight. */
const BANNED_DISPLAY_FONTS = ['inter', 'poppins', 'montserrat', 'roboto', 'open sans', 'lato', 'nunito'];

export interface RubricVerdict {
  chosen: ArtDirection;
  chosenScore: number;
  /** Every direction with its computed score and any hard vetoes, for the report. */
  ranking: Array<{
    name: string;
    score: number;
    vetoes: string[];
    /** Per-axis contribution, so a decision can be re-read months later. */
    breakdown: Record<string, number>;
    /** Estimated wow for this direction: total /18, ambition /15, and the gate. */
    wow: { total: number; ambition: number; passed: boolean; reasons: string[] };
    /** Set when the direction walked away from an available brand palette. */
    brandNeglect: string | null;
  }>;
  /** Deterministic, human-readable justification stored with the design contract. */
  rationale: string;
  /** The winner's estimated wow, surfaced for `site_projects.wow_scores`. */
  chosenWow: {
    total: number; ambition: number; passed: boolean; reasons: string[];
    axes: DirectionScore['wow'];
  };
}

/**
 * Every colour the brand extraction actually measured for this business, as
 * plain hexes. Order is authority order: the chosen primary/accent first, then
 * the palettes they were drawn from.
 */
export function brandPaletteHexes(snapshot: BuildSnapshot): string[] {
  // Tolerates a MISSING brand section, not just an empty one. Snapshots frozen
  // to storage before this feature existed have no `brand` key at all, and a
  // rebuild of one of those must degrade to "no brand evidence" rather than
  // crashing the rubric — reproducing an old build is the point of freezing it.
  const brand = snapshot.brand as BuildSnapshot['brand'] | undefined;
  if (!brand) return [];
  const out: string[] = [];
  const push = (hex: string | null | undefined) => {
    if (!hex) return;
    const norm = hex.toLowerCase();
    if (!out.includes(norm)) out.push(norm);
  };
  push(brand.primary?.hex);
  push(brand.accent?.hex);
  push(brand.accent?.onLight);
  push(brand.accent?.onDark);
  // The agent-named grounds are measured colours too — grounded against the
  // file that was cited for them — so a direction that keys on the brand's own
  // off-white is echoing the brand, not ignoring it.
  push(brand.background?.hex);
  push(brand.onDark?.hex);
  for (const pal of [brand.logoColors, brand.avatarColors, brand.siteColors, brand.photoColors]) {
    for (const c of pal?.colors ?? []) push(c.hex);
  }
  return out;
}

/**
 * True when at least one palette role is recognisably one of the measured brand
 * colours.
 *
 * The tolerance is deliberately generous (60 units of RGB distance, roughly "a
 * designer would call these the same colour family"). The direction is expected
 * to CORRECT the brand colour for contrast and to build tints from it — an
 * exact-match test would fail every competent use and reward copy-paste. What
 * it catches is the case it is aimed at: a palette with no relationship to the
 * brand at all, described as though it had one.
 */
export function paletteEchoesBrand(
  palette: { background: string; foreground: string; accent: string },
  brandHexes: readonly string[],
  tolerance = 60,
): boolean {
  const brandRgb = brandHexes.map(fromHex).filter((c): c is NonNullable<typeof c> => c !== null);
  if (brandRgb.length === 0) return false;
  for (const role of [palette.accent, palette.background, palette.foreground]) {
    const rgb = fromHex(role.trim());
    // A non-hex role (a Tailwind token, a CSS variable name) cannot be compared;
    // it is not evidence of a miss, so it simply does not count as a hit.
    if (!rgb) continue;
    if (brandRgb.some((b) => Math.hypot(b.r - rgb.r, b.g - rgb.g, b.b - rgb.b) <= tolerance)) return true;
  }
  return false;
}

/**
 * Why this direction is failing to use the business's own identity, or null
 * when it is not.
 *
 * Deliberately NOT a veto. A veto means "this cannot be built" (a font that
 * fails next/font, a hero photo that does not exist) and costs 3 points. Walking
 * away from the brand palette is a judgement call a designer can legitimately
 * make — a logo colour can fight every photograph, an accent can be
 * uncorrectable against the only usable background. So it carries its own
 * smaller penalty and travels into the build task as a note, which keeps the
 * decision visible without pretending it is a defect.
 */
export function brandNeglect(direction: ArtDirection, snapshot: BuildSnapshot): string | null {
  const brandHexes = brandPaletteHexes(snapshot);
  if (brandHexes.length === 0 || !snapshot.brand) return null;     // nothing to neglect
  if (direction.palette.paletteSource === 'brand') return null;    // claimed; checked by vetoesFor
  // A direction that never touches the measured colours AND does not claim to
  // is the case Roman named: the page could be for any business in the campaign.
  if (paletteEchoesBrand(direction.palette, brandHexes)) return null;
  return `the business has a measured brand palette (${brandHexes.slice(0, 4).join(', ')}, from `
    + `${snapshot.brand.paletteSource}) and this direction's palette echoes none of it, `
    + `declaring paletteSource "${direction.palette.paletteSource}"`;
}

/**
 * How much a direction loses for ignoring an available brand palette. Sized
 * between a wow-gate failure (2.5) and nothing: enough that a brand-grounded
 * direction beats an equally-scored generic one, small enough that a genuinely
 * better design still wins and can explain itself in `brandAlignment`.
 */
const BRAND_NEGLECT_PENALTY = 1.2;

/** Normalise `GFS_Didot`, `GFS Didot`, `gfs-didot` to one comparable form. */
function normFont(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Hard vetoes applied by code regardless of what the critic thought.
 * A vetoed direction can still win if every direction is vetoed — but the veto
 * text travels into the build task so the agent fixes it rather than shipping it.
 */
export function vetoesFor(
  direction: ArtDirection,
  snapshot: BuildSnapshot,
  /**
   * Slugs that actually exist under `references/motion/`. Passed in rather than
   * read from disk so this function stays pure; omitted (or empty) skips the
   * slug check, which is what the unit tests and any caller without the pack want.
   */
  knownReferenceSlugs: readonly string[] = [],
): string[] {
  const vetoes: string[] = [];
  const isGreek = snapshot.language.toLowerCase().startsWith('el');

  if (isGreek) {
    const safeDisplay = GREEK_SAFE_DISPLAY.map(normFont);
    const safeBody = GREEK_SAFE_BODY.map(normFont);
    if (!safeDisplay.includes(normFont(direction.typography.displayFont))) {
      vetoes.push(
        `display font "${direction.typography.displayFont}" is not on the verified Greek-subset list ` +
        `(${GREEK_SAFE_DISPLAY.join(', ')}); next/font would fail the build`,
      );
    }
    if (!safeBody.includes(normFont(direction.typography.bodyFont))) {
      vetoes.push(
        `body font "${direction.typography.bodyFont}" is not on the verified Greek-subset list ` +
        `(${GREEK_SAFE_BODY.join(', ')}); next/font would fail the build`,
      );
    }
  }

  if (BANNED_DISPLAY_FONTS.includes(direction.typography.displayFont.toLowerCase().replace(/[_-]/g, ' '))) {
    vetoes.push(`display font "${direction.typography.displayFont}" is on the anti-slop ban-list`);
  }

  // Hero promises a photo: the file must actually exist in the snapshot.
  if (direction.heroTreatment.assetFile) {
    const known = snapshot.assets.some((a) => a.file === direction.heroTreatment.assetFile
      || a.file.endsWith(`/${direction.heroTreatment.assetFile}`));
    if (!known) {
      vetoes.push(`hero asset "${direction.heroTreatment.assetFile}" is not in the snapshot assets`);
    } else {
      const asset = snapshot.assets.find((a) => a.file === direction.heroTreatment.assetFile
        || a.file.endsWith(`/${direction.heroTreatment.assetFile}`))!;
      if (asset.aiGenerated && direction.heroTreatment.kind.startsWith('real-photo')) {
        vetoes.push(
          `hero asset "${asset.file}" is ai_generated and cannot be presented as a real photo of the business`,
        );
      }
    }
  } else if (direction.heroTreatment.kind.startsWith('real-photo')) {
    vetoes.push(`hero kind "${direction.heroTreatment.kind}" promises a real photo but names no asset file`);
  }

  // The video brief must start from a REAL photo that exists — an imagined
  // start frame sends Roman hunting for a picture that is not there.
  const realFiles = snapshot.assets.filter((a) => !a.aiGenerated).map((a) => a.file);
  if (direction.heroVideoBrief && !direction.heroVideoStartFrame) {
    vetoes.push('heroVideoBrief is set but heroVideoStartFrame names no file');
  }
  if (direction.heroVideoStartFrame) {
    const known = realFiles.some((f) => f === direction.heroVideoStartFrame
      || f.endsWith(`/${direction.heroVideoStartFrame}`));
    if (!known) {
      vetoes.push(
        `heroVideoStartFrame "${direction.heroVideoStartFrame}" is not a real (non-AI) photo in the snapshot`,
      );
    }
  }
  if (!direction.heroVideoBrief && realFiles.length > 0) {
    vetoes.push('the snapshot has real photographs but heroVideoBrief is null — write the brief');
  }

  if (direction.poolComponents.length > 4) {
    vetoes.push(`uses ${direction.poolComponents.length} pool components; the cap is 4 (component-demo look)`);
  }

  // Reviews section planned with no reviews in evidence.
  const plansReviews = direction.layoutSkeleton.some((s) => /review|testimonial|μαρτυρ|κριτικ/i.test(s.sectionId));
  if (plansReviews && snapshot.reviews.length === 0) {
    vetoes.push('layout includes a reviews/testimonials section but the snapshot has no verified reviews');
  }

  // ── brand palette ─────────────────────────────────────────────────────────
  //
  // `paletteSource: 'brand'` is a CLAIM, and this is where code checks it. A
  // direction that says it started from the business's identity, while naming
  // colours that appear nowhere in the measured palette, has written the words
  // without doing the work — and free-prose `derivedFrom` made exactly that
  // undetectable before.
  const brandHexes = brandPaletteHexes(snapshot);
  // `paletteSource` is absent on design contracts written before the field
  // existed; an old contract cannot be judged against a rule it predates.
  if (direction.palette.paletteSource === 'brand') {
    if (brandHexes.length === 0) {
      vetoes.push(
        'palette claims paletteSource "brand" but the snapshot carries no measured brand colours; '
        + 'use "photos" or "reference-fallback" and say so honestly',
      );
    } else if (!paletteEchoesBrand(direction.palette, brandHexes)) {
      vetoes.push(
        `palette claims paletteSource "brand" but none of its colours (bg ${direction.palette.background}, `
        + `fg ${direction.palette.foreground}, accent ${direction.palette.accent}) is within reach of any `
        + `measured brand colour (${brandHexes.join(', ')})`,
      );
    }
  }

  // ── motion pack ───────────────────────────────────────────────────────────
  // The slug must name a real directory: the workspace copies its stills, and
  // the visual critic compares the built page against them. An invented slug
  // would silently leave the critic with no bar to judge against.
  if (knownReferenceSlugs.length && !knownReferenceSlugs.includes(direction.referenceSlug)) {
    vetoes.push(
      `motion reference slug "${direction.referenceSlug}" is not in references/motion/ ` +
      `(available: ${knownReferenceSlugs.join(', ')})`,
    );
  }

  // A static hero is the defect Roman rejected. It is still allowed — some
  // businesses have one usable photo and no clip — but only stated out loud.
  if (direction.heroMotion === 'none' && !direction.heroMotionJustification?.trim()) {
    vetoes.push('heroMotion is "none" with no justification: a first screen that does not move fails the wow gate');
  }

  // A video hero with no video is a promise the builder cannot keep.
  if (direction.heroMotion === 'video') {
    const hasClip = snapshot.assets.some((a) => /\.(mp4|webm|mov)$/i.test(a.file));
    if (!hasClip) {
      vetoes.push('heroMotion is "video" but the snapshot contains no video asset; use "kenburns" over a real photo instead');
    }
  }

  // Ken Burns and mask/split heroes animate a photograph; without one they degrade
  // to a moving colour block, which is decoration rather than content reveal.
  if ((direction.heroMotion === 'kenburns' || direction.heroMotion === 'mask' || direction.heroMotion === 'split')
    && !snapshot.assets.some((a) => !a.aiGenerated)) {
    vetoes.push(
      `heroMotion "${direction.heroMotion}" animates a photograph, but the snapshot has no real (non-AI) photo`,
    );
  }

  return vetoes;
}

/**
 * Deterministic repeat penalties (MOTION-PLAN D2): the campaign-level half of
 * distinctiveness. The prompt already ASKS for variety; this is the part the
 * model cannot talk its way around. Calibration against the existing scale:
 * brand neglect costs 1.2 and a veto 3.0 — repetition is real but weaker than
 * either, because a business whose material genuinely calls for a used slug
 * must still be able to win by arguing it (the penalty is a bal, not a veto).
 */
export interface CampaignUsageForRubric {
  recentSlugs: string[];
  slugCounts: Record<string, number>;
  recentDisplayFonts: string[];
}

const RECENT_SLUG_PENALTY = 0.6;
const SLUG_SPREAD_PENALTY_STEP = 0.15; // per prior campaign use, on top of recency
const SLUG_SPREAD_PENALTY_CAP = 0.6;
const RECENT_FONT_PENALTY = 0.3;

export function repeatPenalty(
  direction: ArtDirection,
  usage: CampaignUsageForRubric | undefined,
): { total: number; reasons: string[] } {
  if (!usage) return { total: 0, reasons: [] };
  let total = 0;
  const reasons: string[] = [];
  if (usage.recentSlugs.includes(direction.referenceSlug)) {
    total += RECENT_SLUG_PENALTY;
    reasons.push(`motion reference \"${direction.referenceSlug}\" was used by a recent neighbour (-${RECENT_SLUG_PENALTY})`);
  }
  const priorUses = usage.slugCounts[direction.referenceSlug] ?? 0;
  if (priorUses > 0) {
    const spread = Math.min(priorUses * SLUG_SPREAD_PENALTY_STEP, SLUG_SPREAD_PENALTY_CAP);
    total += spread;
    reasons.push(`\"${direction.referenceSlug}\" already used ${priorUses}x in this campaign (-${spread.toFixed(2)})`);
  }
  const font = normFont(direction.typography.displayFont);
  if (usage.recentDisplayFonts.some((f) => normFont(f) === font)) {
    total += RECENT_FONT_PENALTY;
    reasons.push(`display font \"${direction.typography.displayFont}\" matches a recent neighbour (-${RECENT_FONT_PENALTY})`);
  }
  return { total: Number(total.toFixed(3)), reasons };
}

/**
 * How much a direction loses for failing the wow gate. Sized to outweigh the
 * entire wow axis (2.2) plus a comfortable margin, so a direction that clears
 * the floor beats one that does not even when the critic liked the loser more
 * on taste — but it stays below a hard veto (3.0), because a weak-wow direction
 * is buildable and a broken one is not.
 */
const WOW_GATE_PENALTY = 2.5;

/** Weighted sum minus penalties, clamped to a readable 0-10 range. */
export function scoreDirection(
  score: DirectionScore,
  vetoCount: number,
  /** True when `brandNeglect()` fired for this direction. */
  neglectsBrand = false,
  /** Deterministic campaign repeat penalty, from `repeatPenalty()`. */
  repeat = 0,
): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;
  // Wow arrives as six 0-3 axes; every other axis is already 0-10.
  // A missing axis scores 0 rather than NaN. The schema makes every axis
  // required, so this only bites on hand-built scores (tests) and on critiques
  // stored before an axis existed — and one silent NaN would propagate through
  // the whole weighted sum and make EVERY direction unrankable.
  const axisValue = (axis: keyof typeof WEIGHTS): number => {
    if (axis === 'wow') return (wowTotal(score.wow) / WOW_MAX) * 10;
    const raw = score[axis] as number | undefined;
    return Number.isFinite(raw) ? raw as number : 0;
  };
  for (const [axis, weight] of Object.entries(WEIGHTS)) {
    const raw = axisValue(axis as keyof typeof WEIGHTS);
    const contribution = raw * weight;
    breakdown[axis] = Number(contribution.toFixed(3));
    total += contribution;
  }
  // Penalties are expressed on the same 0-10 scale as the weighted sum: a
  // maximum-slop direction loses 3.3 points, which outweighs any single axis.
  const slopPenalty = Number((score.slopRisk / 10 * SLOP_PENALTY * 3).toFixed(3));
  const buildPenalty = Number((score.buildRisk / 10 * BUILD_RISK_PENALTY * 3).toFixed(3));
  // A veto is a hard defect (a font that fails the build, a hero photo that does
  // not exist), not a matter of taste. One veto must outweigh any plausible gap
  // in critic scores, so a confidently-described broken direction cannot win.
  const vetoPenalty = Number((vetoCount * 3).toFixed(3));
  // The wow gate: heroMotion 0, or a total under 9/18, is the "default AI
  // template" failure. It is scored once here so the design stage rejects it
  // before the builder spends 20 minutes on it, and again in stage 11 against
  // the built page — a direction can promise motion and still not deliver it.
  const wowGatePenalty = wowVerdict(score.wow).passed ? 0 : WOW_GATE_PENALTY;
  const brandPenalty = neglectsBrand ? BRAND_NEGLECT_PENALTY : 0;
  breakdown.slopPenalty = -slopPenalty;
  breakdown.buildPenalty = -buildPenalty;
  breakdown.vetoPenalty = -vetoPenalty;
  breakdown.wowGatePenalty = -wowGatePenalty;
  breakdown.brandNeglectPenalty = -brandPenalty;
  breakdown.repeatPenalty = -repeat;
  const finalTotal = total - slopPenalty - buildPenalty - vetoPenalty - wowGatePenalty - brandPenalty - repeat;
  return { total: Number(finalTotal.toFixed(3)), breakdown };
}

/**
 * Pick the winning direction. Ties break on structuralDistinctiveness, then on
 * the order the art director produced them — never randomly, so a rerun of the
 * same inputs reproduces the same site.
 */
export function chooseDirection(
  directions: ArtDirection[],
  scores: DirectionScore[],
  snapshot: BuildSnapshot,
  knownReferenceSlugs: readonly string[] = [],
  campaignUsage?: CampaignUsageForRubric,
): RubricVerdict {
  if (directions.length === 0) throw new Error('chooseDirection: no directions supplied');

  const rows = directions.map((direction, index) => {
    const score = scores.find((s) => s.name.trim().toLowerCase() === direction.name.trim().toLowerCase())
      ?? scores[index];
    if (!score) throw new Error(`chooseDirection: no critique score for direction "${direction.name}"`);
    const vetoes = vetoesFor(direction, snapshot, knownReferenceSlugs);
    const neglect = brandNeglect(direction, snapshot);
    const repeat = repeatPenalty(direction, campaignUsage);
    const { total, breakdown } = scoreDirection(score, vetoes.length, neglect !== null, repeat.total);
    return { direction, score, vetoes, neglect, repeat, total, breakdown, index };
  });

  const ranked = [...rows].sort((a, b) =>
    b.total - a.total
    || b.score.structuralDistinctiveness - a.score.structuralDistinctiveness
    || a.index - b.index);

  const winner = ranked[0]!;
  const winnerWow = wowVerdict(winner.score.wow);
  const rationale = [
    `Chosen: "${winner.direction.name}" (score ${winner.total.toFixed(2)}).`,
    `Ranking: ${ranked.map((r) => `${r.direction.name}=${r.total.toFixed(2)}`).join(', ')}.`,
    `Drivers: distinctiveness ${winner.score.structuralDistinctiveness}/10, evidence fit ${winner.score.evidenceFit}/10, ` +
    `typographic craft ${winner.score.typographicCraft}/10, reference grounding ${winner.score.referenceGrounding}/10, ` +
    `motion restraint ${winner.score.motionRestraint}/10; penalties: slop ${winner.score.slopRisk}/10, build risk ${winner.score.buildRisk}/10.`,
    `Wow (estimated from the direction): ${winnerWow.total}/${WOW_MAX}, ambition ${winnerWow.ambition}/15 — ` +
    `${winnerWow.passed ? `clears the ${WOW_FAIL_THRESHOLD}/${WOW_MAX} floor` : winnerWow.reasons.join('; ')}. ` +
    `Motion reference: ${winner.direction.referenceSlug}, hero motion: ${winner.direction.heroMotion}.`,
    `Brand: palette source "${winner.direction.palette.paletteSource ?? 'unstated'}" — `
    + `${winner.direction.palette.brandAlignment ?? 'not stated'} `
    + `(measured identity: ${!snapshot.brand || snapshot.brand.paletteSource === 'none'
      ? 'none available'
      : `${snapshot.brand.paletteSource}, primary ${snapshot.brand.primary?.hex ?? '—'}, accent ${snapshot.brand.accent?.hex ?? '—'}`}).`,
    winner.neglect ? `Brand neglect penalty applied: ${winner.neglect}.` : '',
    winner.repeat.total > 0 ? `Campaign repeat penalty applied: ${winner.repeat.reasons.join('; ')}.` : '',
    winner.vetoes.length
      ? `Open vetoes carried into the build task: ${winner.vetoes.join('; ')}.`
      : 'No hard vetoes.',
  ].filter(Boolean).join(' ');

  return {
    chosen: winner.direction,
    chosenScore: winner.total,
    ranking: ranked.map((r) => ({
      name: r.direction.name,
      score: r.total,
      vetoes: r.vetoes,
      breakdown: r.breakdown,
      wow: wowVerdict(r.score.wow),
      brandNeglect: r.neglect,
    })),
    rationale,
    chosenWow: { ...winnerWow, axes: winner.score.wow },
  };
}
