# Vero — custom wedding dress atelier

- **URL:** https://www.verostudio.com/
- **Captured:** 2026-08-18 (desktop 1440×900, mobile 390×844)
- **Mood:** Warm editorial with motion — amber studio light, couture restraint
- **Award:** Awwwards Site of the Day, Aug 8 2026 (Rodéo studio)

**This is the single strongest reference in the pack for a beauty/hair/nail business.** It is
a one-location artisan service business — exactly our shape — and it reaches Awwwards level
using photography, type and scroll choreography rather than WebGL.

## What makes the wow

- **Percentage preloader that is itself the type layout.** The load screen is not a spinner:
  it sets the actual headline "WHERE *your* WEDDING DRESS BECOMES *art*." on cream, with a
  thin rule and a right-aligned `19% → 96%` counter creeping along the bottom. A small
  rounded photo sits inline *inside* the headline where a word would be. By the time the
  site opens you have already read the positioning statement.
- **Roman/italic mixing inside a single headline.** "WHERE" in serif roman caps, "your" in a
  much smaller italic dropped onto the same baseline, "DRESS BECOMES" roman caps again,
  "art." in italic lowercase. Four weights of meaning in two families. This is the cheapest,
  highest-leverage editorial device in the whole pack and needs no JavaScript at all.
- **A photograph inlined into the headline as a word.** A ~120×80px rounded-corner crop of
  skin/fabric sits between "WEDDING" and "DRESS" as if it were a glyph. It reappears in the
  closing "will FOREVER be a MASTERPIECE." headline.
- **Vertical split-screen wipe between two art directions.** Mid-page the viewport divides
  into a warm amber half (model, dress on plinth) and a cool grey half (white sculptural
  dress form), with the caption "From DRESS, to DATA, to SCULPTURE." straddling the seam,
  each word landing in the half it describes. The divider is a hard vertical edge, not a fade.
- **Consistent amber studio grade over every photograph.** Every hero image is lit with the
  same warm orange gradient backdrop; the desaturated grey/white product shots then read as a
  deliberate second act rather than as inconsistent client photography.
- **Closing mosaic gallery.** The page ends on a dense grid of ~15 small images at mixed
  aspect ratios (interiors, fabric, a hand, a landscape) — a moodboard, not a portfolio grid.

## Timing & easing

Section entrances are triggered-and-play rather than scrub-linked; each headline settles in
roughly 0.6–0.9s with a long ease-out tail (movement decelerates well before it stops). The
split-screen divider does appear scroll-linked — it tracks scroll position directly. Nothing
bounces or overshoots. The overall cadence is slow and confident: roughly one idea per
viewport, no compound entrances where five things animate at once.

## Typography

A high-contrast display serif (Didone-adjacent, sharp unbracketed serifs and a true italic
with calligraphic descenders) for every headline, at roughly `clamp(2.5rem, 6vw, 5rem)`. A
small neutral sans for the two nav items — "MENU" left, "Start your COMMISSION" right — at
about 11–12px with wide tracking. That is the entire type system: two families, and the
italic doing the work that a third family would otherwise do.

## Palette

Cream/bone ground `#f2ede8`, warm amber-to-burnt-orange photographic backdrop `#c8621f` →
`#8a3a10`, near-black text `#1a1512`, and a cool grey `#9a9a98` used only in the split-screen
right half. **One accent** (the amber), and it lives inside the photography rather than in
flat UI blocks.

## Layout rhythm & photo treatment

Alternates hard: a tall full-bleed photographic viewport, then a quiet cream type-only band
with enormous margins, then full-bleed again. The cream sections are genuinely sparse — one
headline and nothing else — which is what makes the photographic sections hit. Photos are
full-bleed or edge-anchored, never boxed in a card with a shadow. Two crops recur: a full
standing figure at a distance, and an extreme macro (a shoulder, an ear, folded fabric).

## Mobile behaviour

The split-screen becomes a vertical stack; the headline drops to roughly `2.2rem` and keeps
the roman/italic mixing intact, which is the main reason the mobile version still reads as
designed. The inline-photo-in-headline device survives. Type-only sections keep their
generous vertical padding rather than collapsing, so the rhythm is preserved.

## Performance notes

Smooth throughout the recording; no dropped frames or pop-in visible. No WebGL. The cost is
the preloader — the site holds you on the load screen while large photographs stream in, so
the perceived wait is real, and it is only acceptable here because the load screen carries
the headline. Image weight is the main budget item.

## Reproduce with our stack

- **Roman/italic headline mixing** — pure markup. One `next/font` family loaded with both
  `style: ['normal','italic']`, then `<em>` spans at a smaller `font-size` with their own
  `line-height`. For Greek, **EB Garamond** has both a Greek subset and a real italic, so
  this device survives translation. GFS Didot is single-weight roman only — it cannot do
  this, so pick EB Garamond when the art direction depends on the italic.
- **Photo inlined into a headline** — `<span>` with `display:inline-block`,
  `vertical-align:middle`, fixed `width/height`, `border-radius:6px`, `object-fit:cover`.
  No JS. Only ever use a real business photo here.
- **Percentage preloader** — a fixed overlay with the headline plus a `NumberTicker` from the
  pool for the counter, dismissed on `window.load`, then GSAP fades the overlay out.
  **Cap it at ~1.2s and always allow it to be skipped** — see "Don't borrow".
- **Vertical split-screen wipe** — one `ScrollTrigger` with `pin: true` and
  `scrub: 1` over ~1.5 viewports, animating a `clip-path: inset(0 X% 0 0)` on the top layer
  from `100%` to `0%`. The caption is three spans whose `color` flips at the seam via a
  second tween on the same timeline.
- **Section headline entrances** — `SplitText` by `lines`, `y: 100%` → `0` inside an
  `overflow: hidden` wrapper, `stagger: 0.08`, `duration: 0.9`, `ease: 'power3.out'`,
  `ScrollTrigger` `start: 'top 75%'`, `once: true`. Wrap in `motionSafe()` from `lib/gsap.ts`.
- **Consistent amber grade** — a single `filter: sepia(0.25) saturate(1.25) hue-rotate(-8deg)`
  applied to every hero `<img>` via one utility class, which is how you make mixed-quality
  client photos look like one shoot.
- **Closing mosaic** — CSS grid with varied `grid-row`/`grid-column` spans plus `BlurFade`
  with an index-based `delay`.

Pool components used: `NumberTicker`, `BlurFade`. Two of four — leaves headroom.

## Gaps

- No **clip-path mask-reveal utility** — the split-screen wipe has to be hand-written each
  time. Worth extracting as `<MaskWipe direction axis>`.
- No **preloader component** with a load-progress counter and a hard timeout.
- No **photo-grade utility class** in `globals.css`; the amber grade is a one-line filter that
  should be a named token, e.g. `.grade-warm`.
- No **inline-image-in-headline** primitive (trivial, but nobody will think of it unaided).

## Don't borrow

- **The full preloader as-is.** It holds the page for several seconds. On a demo we send cold
  to a salon owner who may open it on 4G, a long load screen reads as a broken site. Keep the
  *idea* (typographic load screen), cap it at ~1.2s, and skip it entirely under reduced motion.
- **Hiding navigation behind "MENU".** A local salon needs services and prices in one click.
  Keep the typographic restraint, expose 4–5 real links.
- **The near-empty cream sections at this scale.** Vero can afford one sentence per viewport
  because it sells one product at a high price. A salon page still has to state services,
  prices and location before the visitor loses patience.
