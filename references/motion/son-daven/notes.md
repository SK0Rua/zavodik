# Son Daven — design resort hotel, Yaremche

- **URL:** https://sondaven.com/en
- **Captured:** 2026-08-18 (desktop 1440×900, mobile 390×844)
- **Mood:** Dark bronze, textural, slow-luxury retreat
- **Award:** Awwwards Site of the Month, Jun 2026 (The First The Last)

The closest structural match in the pack to **a hospitality business with rooms, services and
a location** — a resort hotel, which is a taverna/spa/guesthouse with more budget. If a Patras
business has good interior photography and a sense of place, this is the reference.

## What makes the wow

- **A dithered/ASCII rendering of the photography as a transitional state.** Images resolve
  through a coarse vertical-line halftone: a photograph of sheep in a field first appears as
  dense vertical strokes, then sharpens into the real image. The same treatment is applied to
  a walking sheep during the load sequence. **A single consistent image treatment applied
  everywhere is what unifies mixed-quality photography**, which is exactly our problem with
  client photos.
- **A huge stencil wordmark clipped by the viewport.** "SON DAVEN" runs the full 1440px in a
  heavy slab/stencil face, letterforms cut by horizontal gaps, cropped at both edges. It
  reappears at the page foot over a dark architectural render.
- **A loading state that is content, not a spinner.** During load: the logomark, "I AM A
  VALLEY OF PEACE / SEE YOU IN THE DREAMS", a dithered walking sheep animation, and
  "LOADING THE WEBSITE / PLEASE WAIT" in small caps bottom-right. The brand voice arrives
  before the site does.
- **A dotted-arc drag control.** A circular dashed track with two round handles labelled
  "HOLD AND MOVE" — a physical-feeling custom control for browsing seasons/content rather
  than arrows or dots.
- **Rooms presented as an offset two-up with a spec list.** A pale interior photo beside a
  column of small bordered tags (`90 SQ METERS`, `PANORAMIC LIVING AREA`, `OPEN PLAN KITCHEN`,
  `VIEWS OF THE FOREST, MOUNTAINS AND WINERY WATERFALL`, `SUMMER TERRACE`, `EQUIPPED COOKING
  SPACE`), then a paragraph and a `TAGLINE ABOUT PRICING` button with a small play control.
  **This is the single most reusable block for a local business** — real specifics, set as
  typographic tags, doing the work that a bland paragraph would do badly.

## Timing & easing

Slow and deliberate throughout, consistent with a retreat. The dither-to-sharp resolve takes
roughly 0.8–1.2s and appears scroll-triggered rather than scrubbed. The load sequence is
genuinely long — several seconds — which is a real cost. The arc control responds directly to
pointer position with slight inertia. Section entrances are quiet fades; nothing snaps.

## Typography

A heavy stencil/slab display face for the wordmark, cropped and oversized. A small serif for
the poetic lines ("I am a valley of peace"). A neutral sans at ~10–11px in caps with wide
tracking for every label, tag and nav item. Three roles, clearly separated by size and case
rather than by weight.

## Palette

Dark olive-bronze ground `#2e2a20`, warm sand/khaki type `#c9bfa4`, near-black `#14120e`, and
pale cream `#f0ece2` for the light room sections. Greens arrive only through photography. **No
saturated accent at all** — the entire page is one warm neutral hue at different values, which
is why it reads expensive.

## Layout rhythm & photo treatment

Very long (roughly 32,000px). Alternates dark textural full-bleed bands with pale, calm,
information-dense room sections. Photographs are either full-bleed with the dither treatment
or clean product-style interiors on cream. Small photos are frequently offset and overlapped
rather than aligned to a grid.

## Mobile behaviour

The stencil wordmark stays cropped and full-width. The room two-up stacks with the spec tags
becoming a wrapped tag cloud rather than a single column — a good pattern for a services list.
The dither treatment is retained, which suggests it is a CSS/canvas filter rather than
pre-rendered per-breakpoint assets.

## Performance notes

The 32,000px page and the long preloader are the two real costs. In the recording the scroll
is smooth. The dither effect is likely canvas- or SVG-filter-based; applied to many large
images it would be expensive, and the site limits it to a few key moments. The full-page
screenshot could not be captured because the page exceeds Chrome's ~16,384px limit — noted
here because it also signals a page far longer than a demo should be.

## Reproduce with our stack

- **Dither/halftone image treatment** — reproducible without WebGL. Either an SVG filter
  (`<feTurbulence>` + `<feColorMatrix>`, or a `<pattern>` of lines used as a mask), or a small
  canvas pass that samples the image and draws vertical bars whose thickness maps to
  luminance. Apply as a `filter: url(#dither)` on the `<img>`, then animate a CSS variable to
  fade the filter out on scroll. **Budget: this is the most involved item here.**
- **Cropped stencil wordmark** — `font-size: clamp(3rem, 13vw, 12rem)`, `line-height: 0.8`,
  parent `overflow: hidden`. For Greek, use **Manrope 800**; no stencil face has a verified
  Greek subset, so get the effect from size and cropping rather than from the face.
- **Spec-tag list** — a flex-wrap row of `<span>`s with `border: 1px solid`,
  `border-radius: 999px`, `padding: 6px 14px`, `font-size: 11px`, `letter-spacing: 0.12em`,
  uppercase. **Only ever populated from real snapshot facts** — this block is powerful
  precisely because every tag is a verifiable specific, and it is the fastest way to make a
  services section look designed instead of like a bullet list.
- **Load sequence** — keep the typographic idea (a real brand line, not a spinner), cap it at
  ~1.2s, skip under reduced motion. Do not reproduce the multi-second version.
- **Dotted-arc drag control** — an SVG path with `stroke-dasharray`, plus a pointer handler
  mapping angle to index. Achievable but fiddly; a horizontal scroll-snap row is the
  pragmatic substitute.
- **Dither-to-sharp reveal** — GSAP tween on a CSS custom property driving filter intensity,
  `ScrollTrigger` `start: 'top 75%'`, `once: true`, `duration: 1.0`, `ease: 'power2.out'`.

Pool components: `BlurFade` for section entrances; the rest is bespoke. One of four.

## Gaps

- No **dither/halftone image filter**. Highest-effort item in the whole pack, but it is the
  one treatment that would make mixed-quality client photography look art-directed — worth
  building once as a reusable SVG filter plus a `<DitherImage>` wrapper.
- No **spec-tag list component**. Lowest effort, highest immediate value; should exist as
  `<SpecTags items={...}>` and be wired to snapshot facts.
- No **typographic preloader** with a hard cap.
- No **arc/dial drag control**.

## Don't borrow

- **The multi-second preloader and the 32,000px page length.** Both are luxuries of a
  destination brand people already intend to visit. A cold demo gets a few seconds of
  attention.
- **"TAGLINE ABOUT PRICING"** — visible placeholder copy in the live site. Our `placeholders`
  QA gate would fail this correctly.
- **Poetic-only hero copy.** "I am a valley of peace" works above a real booking flow; on its
  own it tells a visitor nothing about what is being sold.
