# BEAUTY IN STEM — skincare / serum brand

- **URL:** https://beautyinstem.com/
- **Captured:** 2026-08-18 (desktop 1440×900, mobile 390×844)
- **Mood:** Soft wellness, clinical-luminous, near-white
- **Award:** Awwwards Honorable Mention, Jun 5 2026 (Olha Lazarieva)

The **soft-wellness** anchor of the pack, and the best reference for a spa, facial studio or
nail salon that wants to read calm and clean rather than dark and dramatic. It proves a page
can be almost entirely white and still feel expensive and alive.

## What makes the wow

- **A glass bubble that grows from the preloader into the hero.** The load screen is a single
  soap-bubble/lens sphere at centre with the STEM wordmark inside it. As the page opens the
  sphere scales up and a photograph of a face resolves *through* it, refracted and soft — the
  bubble becomes the lens you see the model through. Preloader and hero are one continuous
  object, which is the whole trick.
- **A wordmark with a custom ligature.** The "TE" in STEM is drawn as a single swash glyph, a
  looping stem form that doubles as the brand mark. It appears at ~200px in the header and at
  roughly `10vw` in the footer. **A distinctive letterform is doing the work a logo file would
  do** — reproducible with a display face plus one hand-tuned glyph.
- **Numbered process steps revealed against floating bubbles.** `2) ACTIVATE — RESET SERUM`
  with a paragraph, set against a cluster of translucent spheres drifting slowly. The step
  number is oversized, tinted pale pink, and sits behind/beside the label rather than in a
  circle badge.
- **A near-invisible pale-grey headline that fades up.** "OUR PRODUCTS ARE DESIGNED AS" is
  captured mid-reveal — the type ramps from near-background-white to near-black as it enters.
  A very low-contrast start state is the entire effect.
- **Product bottles suspended inside the bubble.** Two dark bottles float within a large
  translucent sphere with a `SHOP` outline button beneath. Product photography treated as
  something held in a lens.

## Timing & easing

Slow and floaty — the defining quality. The bubbles drift continuously with a long
sinusoidal ease, several seconds per cycle, never snapping. Text reveals are gentle opacity
ramps of roughly 0.8–1.2s with little or no `y` translation, which is what makes it read as
"calm" rather than "energetic". Nothing overshoots; there is no bounce anywhere on the page.

## Typography

A display serif with sharp high-contrast stems and the custom TE ligature for the wordmark,
used at very large sizes only. Everything else is a light neutral sans: section headings at
roughly 2–2.5rem in caps with moderate tracking, body at 13–14px, nav at ~11px letterspaced.
Two families, and the serif appears perhaps four times on the whole page.

## Palette

Near-white ground `#f7f6f4`, warm dark brown for the wordmark and footer bar `#3a2318`,
soft mid-grey body text `#6b6b6b`, and a very pale rose `#e8cfc9` used only for the step
numbers. Glass/bubble highlights are transparency and blur rather than a colour. **One
accent**, and it is barely saturated.

## Layout rhythm & photo treatment

Long, calm, generous. Sections are tall with a great deal of vertical air; the page never
gets dense. Photography is always seen *through* something — a sphere, a blur, a soft mask —
never presented as a flat rectangle. The one hard edge on the page is the dark brown footer
bar, which lands as a deliberate full stop after all that white.

## Mobile behaviour

The bubble hero survives, scaled down and centred, and remains the focal object. Step
sections stack with the oversized numbers retained. The giant footer wordmark shrinks to
roughly `18vw` and still spans nearly the full width. The floaty drift animation is kept,
which on a mid-range phone is the main performance risk to watch.

## Performance notes

Smooth in the recording. The bubble refraction is likely a combination of transparent PNG/WebP
overlays and `backdrop-filter: blur()` rather than a WebGL shader — no canvas artefacts are
visible at frame boundaries. `backdrop-filter` is nonetheless expensive on mid-range Android;
keep the blurred areas small and few. Long continuously-animating elements must be shut off
under reduced motion.

## Reproduce with our stack

- **Bubble/lens over a photo** — a `<div>` with `backdrop-filter: blur(6px) saturate(1.2)`,
  `border-radius: 50%`, a subtle `box-shadow: inset` rim highlight and a soft radial-gradient
  specular. Layer it over an `<img>`. No WebGL needed; this is the single most valuable trick
  on the page and it is pure CSS.
- **Preloader-to-hero continuity** — one element that persists across both states. Render the
  sphere once, animate `scale` and `top` with a GSAP timeline on `window.load`; do not
  cross-fade two different elements. Cap at ~1.2s and skip under reduced motion.
- **Drifting bubbles** — `motion/react` with `animate={{ y: [0,-18,0], x: [0,9,0] }}`,
  `transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}`, each sphere given a
  different duration so they never sync up. **Must be disabled under reduced motion** — an
  infinite loop at `0.01ms` still burns CPU (see `globals.css` reduced-motion block).
- **Low-contrast fade-up headline** — `BlurFade` from the pool, or GSAP
  `opacity: 0.06 → 1` with `duration: 1.1`, `ease: 'power2.out'`, `ScrollTrigger`
  `start: 'top 80%'`, `once: true`. Never leave the end state below `opacity: 1`.
- **Oversized step numbers** — a `<span>` at `clamp(3rem,7vw,6rem)` in the pale rose,
  `position: absolute`, `z-index: 0`, with the label text above it.
- **Custom ligature wordmark** — pick a Greek-safe display face and set the business name at
  size; do not attempt to draw a custom glyph. **GFS Didot** gives comparable high-contrast
  character for Greek names.

Pool components: `BlurFade`, optionally `Ripple` behind a contact block. Two of four.

## Gaps

- No **glass/lens overlay component** (`backdrop-filter` sphere with rim + specular). Cheap to
  build, very high visual payoff, and reusable across every spa/wellness build.
- No **float/drift animation helper** with per-instance desynchronised durations and an
  automatic reduced-motion off-switch.
- No **preloader that hands its element off to the hero** (shared-element transition).
- No **oversized-background-number** pattern for process/step sections.

## Don't borrow

- **The near-total absence of concrete information above the fold.** Beautiful, but a Patras
  salon needs services, location and a phone number reachable fast. Keep the calm; add facts.
- **Commerce furniture** (`ACCOUNT`, `SHOPPING CART`) — irrelevant for a service business.
- **Bubbles everywhere.** One or two lens moments read as art direction; a page full of
  floating spheres reads as a screensaver.
