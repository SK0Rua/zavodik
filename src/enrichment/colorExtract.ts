/**
 * Deterministic dominant-colour extraction from raster images.
 *
 * WHY IT LIVES HERE AND WHY IT LOOKS LIKE THIS. Roman's finding: every demo
 * came out in the same style, because the only thing grounding the palette was
 * the art director's taste plus a shared motion-reference pack. The palette has
 * to start from the business's OWN identity — its logo, its Instagram avatar,
 * its photographs — and that means measuring pixels, in code, with a
 * reproducible answer. An LLM guessing "warm terracotta" from a description is
 * exactly the thing this module replaces.
 *
 * DECODING. There is no `sharp`/`jimp` in this project and adding a native
 * dependency to every worker image for one feature is a bad trade. Playwright
 * is already installed and already runs in the enrich containers, so the decode
 * happens in the browser that is already there: a data: URL into an `Image`,
 * drawn onto a downscaled canvas, `getImageData` back. That handles JPEG, PNG,
 * WebP, GIF and AVIF with the platform's own codecs — the same decoders that
 * will render the photo on the demo.
 *
 * QUANTISATION. Median cut over the downscaled pixel set, then one refinement
 * pass that recomputes each box's centroid. Median cut is chosen over k-means
 * because it has no random seed: the same image always yields the same palette,
 * byte for byte, which is what makes `scripts/test-brand-identity.ts` a real
 * regression test rather than a smoke test.
 *
 * Everything in this file is pure except `decodeImage`, which needs a page.
 */
import type { Browser, Page } from 'playwright';

export interface Rgb { r: number; g: number; b: number }

export interface DecodedImage {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

export interface PaletteEntry {
  hex: string;
  /** Share of the counted (opaque, non-near-duplicate) pixels, 0-1. */
  share: number;
  hsl: { h: number; s: number; l: number };
}

/**
 * Longest edge the decode downscales to. 160px is ~25k pixels — enough that a
 * logo's accent colour survives, small enough that a 3000px photo costs
 * milliseconds and the median cut stays instant.
 */
export const SAMPLE_EDGE = 160;

/**
 * Browser-side decode. Passed as a STRING, not a closure: tsx/esbuild compiles
 * this file with `keepNames`, which injects a `__name(...)` helper into named
 * functions; Playwright serialises the closure and the helper is undefined in
 * the page, so a closure form dies with "ReferenceError: __name is not defined".
 * Same trap as `capture.ts` — see the note there.
 */
const DECODE_JS = `(async (dataUrl, maxEdge) => {
  const img = new Image();
  await new Promise(function (resolve, reject) {
    img.onload = resolve;
    img.onerror = function () { reject(new Error('decode failed')); };
    img.src = dataUrl;
  });
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error('zero dimensions');
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  return { width: w, height: h, naturalWidth: w0, naturalHeight: h0, pixels: Array.from(d) };
})`;

/**
 * Decodes one image buffer to downscaled RGBA pixels using the browser's own
 * codecs. Returns null for anything the browser cannot decode (SVG without an
 * intrinsic size, a truncated download, an HTML error page served as an image) —
 * a failed decode is a gap, never a guessed colour.
 */
export async function decodeImage(
  page: Page,
  buf: Buffer,
  contentType: string,
  maxEdge = SAMPLE_EDGE,
): Promise<DecodedImage | null> {
  // 8 MB of base64 in one evaluate call is already generous for a logo or a
  // gallery photo; beyond that the asset is not something we want to sample.
  if (buf.length > 8 * 1024 * 1024) return null;
  const mime = contentType.startsWith('image/') ? contentType.split(';')[0]!.trim() : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  try {
    const out = await page.evaluate(
      `(${DECODE_JS})(${JSON.stringify(dataUrl)}, ${maxEdge})`,
    ) as { width: number; height: number; naturalWidth: number; naturalHeight: number; pixels: number[] };
    return {
      width: out.width,
      height: out.height,
      naturalWidth: out.naturalWidth,
      naturalHeight: out.naturalHeight,
      data: Uint8ClampedArray.from(out.pixels),
    };
  } catch {
    return null;
  }
}

/** Opens a throwaway page for decoding. Caller closes the browser. */
export async function newDecodePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } });
  return ctx.newPage();
}

// ── colour space helpers ────────────────────────────────────────────────────

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function fromHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1]!;
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Nudges a colour's lightness until it clears `target` contrast against `on`,
 * preserving hue and saturation. Returns the original when no lightness in
 * range reaches the target (a mid-grey accent on mid-grey can be impossible),
 * so the caller can see it failed rather than receiving a silently wrong value.
 */
export function contrastCorrect(colour: Rgb, on: Rgb, target = 4.5): Rgb {
  if (contrastRatio(colour, on) >= target) return colour;
  const { h, s } = rgbToHsl(colour);
  const onIsDark = luminance(on) < 0.18;
  // Walk lightness away from the background, 1% at a time: the first hit is the
  // smallest change that satisfies the requirement, which keeps the corrected
  // colour recognisably the brand's.
  const start = rgbToHsl(colour).l;
  for (let step = 1; step <= 100; step++) {
    const l = onIsDark ? start + step / 100 : start - step / 100;
    if (l < 0 || l > 1) break;
    const cand = hslToRgb(h, s, l);
    if (contrastRatio(cand, on) >= target) return cand;
  }
  // Try the other direction before giving up — a light accent on a light
  // background can still be rescued by going very dark.
  for (let step = 1; step <= 100; step++) {
    const l = onIsDark ? start - step / 100 : start + step / 100;
    if (l < 0 || l > 1) break;
    const cand = hslToRgb(h, s, l);
    if (contrastRatio(cand, on) >= target) return cand;
  }
  return colour;
}

// ── median cut ──────────────────────────────────────────────────────────────

interface Sample { r: number; g: number; b: number; count: number }

/**
 * Buckets the RGBA buffer into 5-bit-per-channel cells and drops pixels that
 * carry no colour information:
 *   - alpha below 128 (a logo's transparent field is not a brand colour);
 *   - near-white and near-black, unless `keepExtremes` — a photo is mostly
 *     highlights and shadows, and reporting "#ffffff, 40%" as a brand colour is
 *     true and useless.
 */
export function quantiseSamples(
  data: Uint8ClampedArray,
  opts: { keepExtremes?: boolean } = {},
): { samples: Sample[]; counted: number; skippedTransparent: number; skippedExtreme: number } {
  const bins = new Map<number, Sample>();
  let counted = 0, skippedTransparent = 0, skippedExtreme = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) { skippedTransparent++; continue; }
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (!opts.keepExtremes) {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      // Near-white / near-black *and* unsaturated: a saturated dark navy is a
      // brand colour, a #0a0a0a shadow is not.
      if ((max > 244 || max < 16) && max - min < 20) { skippedExtreme++; continue; }
    }
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = bins.get(key);
    if (hit) {
      hit.r += r; hit.g += g; hit.b += b; hit.count++;
    } else {
      bins.set(key, { r, g, b, count: 1 });
    }
    counted++;
  }
  // Store bin means, not the first pixel seen.
  const samples = [...bins.values()].map((s) => ({
    r: s.r / s.count, g: s.g / s.count, b: s.b / s.count, count: s.count,
  }));
  return { samples, counted, skippedTransparent, skippedExtreme };
}

interface Box { samples: Sample[]; count: number }

function boxRange(box: Box): { channel: 'r' | 'g' | 'b'; span: number } {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const s of box.samples) {
    if (s.r < rMin) rMin = s.r; if (s.r > rMax) rMax = s.r;
    if (s.g < gMin) gMin = s.g; if (s.g > gMax) gMax = s.g;
    if (s.b < bMin) bMin = s.b; if (s.b > bMax) bMax = s.b;
  }
  const spans: Array<{ channel: 'r' | 'g' | 'b'; span: number }> = [
    { channel: 'r', span: rMax - rMin },
    { channel: 'g', span: gMax - gMin },
    { channel: 'b', span: bMax - bMin },
  ];
  // Deterministic tie-break: r before g before b, always.
  spans.sort((a, b) => b.span - a.span || a.channel.localeCompare(b.channel));
  return spans[0]!;
}

/**
 * Median-cut quantisation. Fully deterministic — no seeds, no shuffling — so
 * the same image always produces the same palette. Boxes are split
 * longest-range-first; ties break on pixel count, then on the box's mean, so
 * even a pathological input has one answer.
 */
export function medianCut(samples: Sample[], maxColours: number): Array<{ rgb: Rgb; share: number }> {
  if (samples.length === 0) return [];
  const total = samples.reduce((n, s) => n + s.count, 0);
  let boxes: Box[] = [{ samples, count: total }];

  while (boxes.length < maxColours) {
    // Split the box with the widest colour range; that is what makes median cut
    // find a rare-but-vivid accent rather than three shades of the background.
    let bestIndex = -1, bestSpan = -1, bestCount = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.samples.length < 2) continue;
      const { span } = boxRange(box);
      if (span > bestSpan || (span === bestSpan && box.count > bestCount)) {
        bestIndex = i; bestSpan = span; bestCount = box.count;
      }
    }
    if (bestIndex < 0 || bestSpan <= 0) break;

    const box = boxes[bestIndex]!;
    const { channel } = boxRange(box);
    const sorted = [...box.samples].sort((a, b) => a[channel] - b[channel]
      || a.r - b.r || a.g - b.g || a.b - b.b);
    // Split at the weighted median so both halves carry comparable pixel mass.
    //
    // The cut index is clamped to [0, length-2] so BOTH halves are non-empty.
    // Without the clamp a two-sample box whose first sample holds less than
    // half the mass produces an empty right half — and a 60/30/10 image stops
    // at two colours, losing exactly the rare-but-vivid accent this function
    // exists to find. (Observed on the test fixture before the clamp.)
    const half = box.count / 2;
    let acc = 0, cut = 0;
    for (; cut < sorted.length - 1; cut++) {
      acc += sorted[cut]!.count;
      if (acc >= half) break;
    }
    cut = Math.min(cut, sorted.length - 2);
    const left = sorted.slice(0, cut + 1);
    const right = sorted.slice(cut + 1);
    boxes.splice(bestIndex, 1,
      { samples: left, count: left.reduce((n, s) => n + s.count, 0) },
      { samples: right, count: right.reduce((n, s) => n + s.count, 0) });
  }

  const out = boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const s of box.samples) { r += s.r * s.count; g += s.g * s.count; b += s.b * s.count; }
    return {
      rgb: { r: r / box.count, g: g / box.count, b: b / box.count },
      share: box.count / total,
    };
  });
  // Largest share first; ties by hex so the order never depends on Map order.
  out.sort((a, b) => b.share - a.share || toHex(a.rgb).localeCompare(toHex(b.rgb)));
  return out;
}

/**
 * Merges palette entries that are visually the same colour. Two centroids 6
 * units apart in RGB are indistinguishable on screen but read as "two brand
 * colours" in a design contract, which is worse than reporting one.
 */
export function mergeNear(entries: Array<{ rgb: Rgb; share: number }>, threshold = 26): Array<{ rgb: Rgb; share: number }> {
  const out: Array<{ rgb: Rgb; share: number }> = [];
  for (const e of entries) {
    const hit = out.find((o) => Math.hypot(o.rgb.r - e.rgb.r, o.rgb.g - e.rgb.g, o.rgb.b - e.rgb.b) < threshold);
    if (hit) {
      const total = hit.share + e.share;
      hit.rgb = {
        r: (hit.rgb.r * hit.share + e.rgb.r * e.share) / total,
        g: (hit.rgb.g * hit.share + e.rgb.g * e.share) / total,
        b: (hit.rgb.b * hit.share + e.rgb.b * e.share) / total,
      };
      hit.share = total;
    } else {
      out.push({ ...e });
    }
  }
  out.sort((a, b) => b.share - a.share || toHex(a.rgb).localeCompare(toHex(b.rgb)));
  return out;
}

/**
 * The full pipeline for one decoded image: quantise → median cut → merge →
 * format. `keepExtremes` is for logos, where a deliberate pure-black wordmark
 * IS the brand colour; photographs pass false so the palette is not three
 * shades of daylight.
 */
export function paletteFromImage(
  img: DecodedImage,
  opts: { maxColours?: number; keepExtremes?: boolean } = {},
): { palette: PaletteEntry[]; countedPixels: number; transparentShare: number } {
  const maxColours = opts.maxColours ?? 6;
  const { samples, counted, skippedTransparent } = quantiseSamples(img.data, { keepExtremes: opts.keepExtremes });
  const totalPixels = img.data.length / 4;
  if (samples.length === 0) {
    return { palette: [], countedPixels: 0, transparentShare: totalPixels ? skippedTransparent / totalPixels : 0 };
  }
  const cut = mergeNear(medianCut(samples, maxColours)).slice(0, maxColours);
  return {
    palette: cut.map((c) => ({
      hex: toHex(c.rgb),
      share: Number(c.share.toFixed(4)),
      hsl: (() => {
        const h = rgbToHsl(c.rgb);
        return { h: Number(h.h.toFixed(1)), s: Number(h.s.toFixed(3)), l: Number(h.l.toFixed(3)) };
      })(),
    })),
    countedPixels: counted,
    transparentShare: totalPixels ? Number((skippedTransparent / totalPixels).toFixed(4)) : 0,
  };
}

/**
 * Picks the entry most usable as an ACCENT: saturated, mid-lightness, and
 * carrying enough of the image to be deliberate rather than a JPEG artefact.
 * Returns null when nothing qualifies — a monochrome logo genuinely has no
 * accent, and inventing one is the failure mode this whole module exists to
 * prevent.
 */
export function pickAccent(palette: PaletteEntry[], opts: { minShare?: number } = {}): PaletteEntry | null {
  const minShare = opts.minShare ?? 0.02;
  const scored = palette
    .filter((p) => p.share >= minShare && p.hsl.s >= 0.18 && p.hsl.l >= 0.12 && p.hsl.l <= 0.88)
    // An accent is a colour used SPARINGLY at a lightness that reads against
    // both a light and a dark ground. Saturation is the main term, but
    // mid-lightness is what separates an accent from a brand's ground colour:
    // a deep teal at L=0.18 covering 60% of a logo is that logo's field, and
    // the gold at L=0.47 covering 10% is the thing keyed on top of it.
    // Scoring on saturation alone picked the teal, which is a true statement
    // about the image and the wrong answer for a design contract.
    .map((p) => ({
      p,
      score: p.hsl.s * 2
        + (1 - Math.abs(p.hsl.l - 0.5) * 2) * 0.9
        // A small share is mildly positive — accents are used sparingly — but
        // the term is weak enough that a genuinely dominant brand colour with
        // nothing else in the palette still wins by default.
        + (p.share <= 0.35 ? 0.15 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.p.hex.localeCompare(b.p.hex));
  return scored[0]?.p ?? null;
}

/** The darkest / lightest entries, used to propose foreground and background. */
export function pickNeutrals(palette: PaletteEntry[]): { darkest: PaletteEntry | null; lightest: PaletteEntry | null } {
  if (palette.length === 0) return { darkest: null, lightest: null };
  const byL = [...palette].sort((a, b) => a.hsl.l - b.hsl.l || a.hex.localeCompare(b.hex));
  return { darkest: byL[0]!, lightest: byL[byL.length - 1]! };
}
