# SPA (Special Production Agency) — fashion/beauty film production

- **URL:** https://www.specialproduction.agency/
- **Captured:** 2026-08-18 (desktop 1440×900, mobile 390×844)
- **Mood:** Brutalist fashion, black-on-white, video-forward
- **Award:** Awwwards Honorable Mention, Jul 19 2026 (OB_Studio)

The **brutalist-fashion** pole of the pack, and the best reference for a business whose real
asset is a body of visual work — a hair colourist, a makeup artist, a tattoo studio. Its
clients are Fendi, Byredo and Savage x Fenty, so the photography is beauty-adjacent
throughout.

## What makes the wow

- **A wordmark so large it is cropped by the viewport.** "SPA" is set in an ultra-heavy
  grotesque at roughly `40vw` — the letterforms are clipped at the left edge and run off the
  bottom of the first screen. Overflowing the viewport deliberately is the single loudest,
  cheapest art-direction signal available, and it needs no JavaScript.
- **A horizontal rail of autoplaying video thumbnails.** Rather than a static gallery, work
  appears as a row of muted looping video cards that slide horizontally as you scroll
  vertically. Each carries a small label (`Fendi (NYC)`, `Boy Smells (NYC) Fragrance`,
  `Savage x Fenty (NYC) Runway '24`) and a tiny eye glyph.
- **Cards that grow to full-bleed as they reach centre.** A thumbnail expands from a small
  card to nearly the full viewport width as it passes the middle of the screen, then contracts
  again — the scale is scroll-position-linked, so the visitor is scrubbing the animation.
- **Label type that sits over the video, half-obscured.** Titles are placed low-left across
  the footage with no scrim, deliberately allowing the imagery to interfere with legibility.
- **A three-item nav and nothing else.** `SPECIAL PRODUCTION AGENCY` split across the top, with
  `ABOUT` and `(EMAIL US)` right. No search, no menu, no CTA pill.

## Timing & easing

The horizontal rail is scrub-linked to scroll — motion stops the instant scrolling stops,
which is what makes it feel physical. The scale-up on the centre card is continuous and
proportional to position rather than a triggered animation. Videos loop at their own pace,
independent of scroll, so there is always ambient motion even at rest. Nothing eases in
slowly; transitions are immediate and mechanical, consistent with the brutalist tone.

## Typography

One ultra-heavy grotesque for the wordmark at extreme size, and one regular-weight sans for
everything else at roughly 11–12px in caps with wide tracking. **Two sizes, one family
family-feel, and the entire hierarchy comes from the ~40:1 size ratio.** Labels over video use
a mix of roman and italic at the same small size.

## Palette

Pure white `#ffffff` ground, pure black `#000000` type. **Zero accent colours.** All colour on
the page comes from the video content itself (skin tones, a yellow chair, an orange lens
flare). This is the most disciplined palette in the pack and the easiest to execute — if the
work is good, the page needs no colour of its own.

## Layout rhythm & photo treatment

Alternates between a huge type statement and a dense band of moving imagery. Videos are
presented at mixed aspect ratios and mixed sizes within one row — never a uniform grid of
equal cards. Nothing is rounded, nothing has a shadow, nothing is boxed. Footage is
ungraded, presented as shot.

## Mobile behaviour

The wordmark stays cropped, sized to overflow the narrower viewport. The horizontal rail
remains horizontal — it becomes a touch-scrollable strip rather than stacking, which keeps the
page short and preserves the mechanic. Labels shrink but stay over the footage.

## Performance notes

Multiple simultaneously playing videos is the obvious cost. In the recording playback stays
smooth, but this pattern demands short, small, muted, `playsInline` clips and ideally pausing
those outside the viewport. On a demo site with 3–4 clips it is fine; with 12 it would not be.

## Reproduce with our stack

- **Viewport-cropped wordmark** — `font-size: 40vw`, `line-height: 0.75`, negative
  `margin-left`, parent `overflow: hidden`. Pure CSS. For Greek, **GFS Didot** is too light
  for this; use a heavy sans such as **Manrope** at weight 800 for the brutalist read.
- **Horizontal rail driven by vertical scroll** — the canonical GSAP pattern:
  ```js
  ScrollTrigger.create({
    trigger: section, pin: true, scrub: 1,
    end: () => '+=' + rail.scrollWidth,
    animation: gsap.to(rail, { x: () => -(rail.scrollWidth - innerWidth), ease: 'none' })
  })
  ```
  Wrap in `motionSafe()`; on mobile use `gsap.matchMedia()` to fall back to native
  `overflow-x: auto` with `scroll-snap-type: x mandatory` rather than pinning.
- **Card scale tied to distance from centre** — a per-card `ScrollTrigger` with
  `containerAnimation` pointing at the rail tween, scrubbing `scale` from `0.8` to `1` and
  back. `containerAnimation` is the specific feature that makes this work inside a horizontal
  rail; it is available in our GSAP 3.15.
- **Autoplaying video cards** — `<video autoPlay muted loop playsInline preload="metadata">`
  with a `poster`. Under reduced motion, render the poster only.
- **Labels over footage** — absolutely positioned, no scrim. Only acceptable when the
  underlying frame is dark/low-detail in that corner; otherwise add a subtle gradient.

Pool components: none strictly needed — `Marquee` could stand in for the rail if you want
continuous motion instead of scrub-linked. Zero to one of four.

## Gaps

- No **horizontal-pin rail helper**. This is the second-highest-value addition after the video
  hero: `<HorizontalRail>` wrapping the pin + scrub + `containerAnimation` + matchMedia mobile
  fallback, which is fiddly to get right and currently must be rewritten from scratch each time.
- No **video card component** (poster, muted/loop/playsInline, viewport pause, reduced-motion
  fallback).
- No **viewport-overflow type utility** — trivial CSS, but the builder will not attempt it
  unprompted because it looks like a bug.

## Don't borrow

- **Zero explanatory copy.** SPA can afford a page that is only work and a name because its
  clients already know it. A Patras salon must state what it does, where it is and what it
  costs.
- **Labels deliberately hard to read** over busy footage — fine as an art statement, a
  usability defect on a business demo where the label may be a service name and its price.
- **Video-only content strategy.** If the business has no video, do not fake it; the same rail
  works with still photography.
