# Component pool

> **Scene wiring**: use `@/lib/scenes` (`loadScene`/`enterScene`/`scrubScene`/`pinScene`, tokens `EASE`/`DUR`) for every scene-map trigger — one motion system, shared ScrollTrigger defaults, reduced-motion safe. Components below provide the visuals; scenes.ts provides the choreography wiring.

Two pools, deliberately separate:

- **`components/ui/`** — 29 copy-paste components from **Aceternity UI** and **Magic UI**
  (both MIT), vendored here. Backgrounds, text effects, cards, buttons. Yours to edit — this
  is a copy-paste library, not a dependency.
- **`components/motion/`** — 10 hand-built components implementing the mechanics that make the
  sites in `../references/motion/` feel premium: video hero, Ken Burns, spec tags, clip-path
  wipes, split headline, pinned horizontal rail, capped preloader. **These are the ones that
  carry the "wow".** Documented at the bottom of this file.

**Read `../DESIGN.md` before composing a page.** This file tells you what exists; DESIGN.md
tells you what makes the result good rather than generic.

All 39 typecheck clean and are exercised by a real static-export build.

## How to use

```tsx
import { BentoGrid, BentoGridItem } from '@/components/ui/bento-grid';
import { cn } from '@/lib/utils';
```

Every component is a client component (`"use client"`). Class merging goes through
`cn()` from `@/lib/utils`.

**Do not use more than 3-4 of these on one page, and count both pools together.** The pool
is a menu, not a checklist. A page stacking Aurora + Lamp + Beams + Spotlight + Marquee looks
like a component demo, not a business. Pick the one effect that suits the art direction and let
the typography and photography carry the rest.

The starter `app/page.tsx` deliberately breaks this rule — it is a build harness that has to
exercise the pack. Your page is not.

## Animations live in CSS

Several components depend on keyframes defined in `app/globals.css` under `@theme`
(`--animate-marquee`, `--animate-aurora`, `--animate-scroll`, `--animate-spotlight`,
`--animate-gradient`, `--animate-ripple`, `--animate-shimmer-slide`, `--animate-spin-around`,
`--animate-shine`, `--animate-shiny-text`). Deleting one silently disables that component's
motion. The reduced-motion block at the bottom of globals.css switches all of them off.

---

## Backgrounds & atmosphere

| Component | File | What it's for | Key props |
|---|---|---|---|
| `Spotlight` | `spotlight.tsx` | SVG cone of light sweeping into a dark hero. Absolutely positioned; parent needs `relative overflow-hidden`. | `className`, `fill` |
| `Spotlight` (new) | `spotlight-new.tsx` | Motion-driven dual-beam variant. Needs no keyframes — safer pick. Import alias it to avoid a name clash with `spotlight.tsx`. | `gradientFirst/Second/Third`, `translateY`, `duration` |
| `AuroraBackground` | `aurora-background.tsx` | Slow drifting aurora gradient wash behind content. Renders its own `<main>` wrapper. | `showRadialGradient`, `className` |
| `BackgroundBeams` | `background-beams.tsx` | Animated SVG beam paths, subtle dark-mode texture. | `className` |
| `LampContainer` | `lamp.tsx` | Dramatic conic "lamp" glow that reveals a heading beneath it. Also exports a `LampDemo` default — upstream demo scaffolding, don't ship it. | `className`, `children` |
| `Ripple` | `ripple.tsx` | Concentric pulsing circles, good behind a contact/CTA block. | `mainCircleSize`, `numCircles` |
| `GridPattern` | `grid-pattern.tsx` | SVG grid texture. Mask it (`[mask-image:radial-gradient(...)]`) or it reads as graph paper. | `width`, `height`, `strokeDasharray`, `squares` |
| `DotPattern` | `dot-pattern.tsx` | Dot-field texture, optional glow. Same masking advice. | `width`, `height`, `glow`, `cr` |
| `BackgroundGradient` | `background-gradient.tsx` | Animated gradient ring wrapping a card. | `animate`, `className` |

## Text & headings

| Component | File | What it's for | Key props |
|---|---|---|---|
| `TextGenerateEffect` | `text-generate-effect.tsx` | Word-by-word fade-in for a lead paragraph. Best used **once**, on the hero sub-line. | `words` (string), `filter`, `duration` |
| `TextAnimate` | `text-animate.tsx` | Versatile text entrance: by character/word/line, many presets. | `children`, `animation`, `by`, `delay`, `once` |
| `TypewriterEffect` / `TypewriterEffectSmooth` | `typewriter-effect.tsx` | Typed-out headline. Use sparingly — reads gimmicky on a premium salon site. | `words` ({text, className}[]), `cursorClassName` |
| `AnimatedShinyText` | `animated-shiny-text.tsx` | Sweeping shine across small text; suits an eyebrow/badge. | `shimmerWidth` |
| `AnimatedGradientText` | `animated-gradient-text.tsx` | Gradient-animated inline text. **Ban-list risk** — trivially becomes the purple-gradient cliché. Only with a palette-derived gradient. | `speed`, `colorFrom`, `colorTo` |
| `NumberTicker` | `number-ticker.tsx` | Counts a number up when scrolled into view. **Only for figures the snapshot proves** (rating, review count, years). | `value`, `decimalPlaces`, `delay`, `startValue` |

## Layout & content

| Component | File | What it's for | Key props |
|---|---|---|---|
| `BentoGrid` / `BentoGridItem` | `bento-grid.tsx` | Asymmetric grid for services/features. Vary `md:col-span-*` — equal cells recreate the three-identical-cards cliché. | `title`, `description`, `header`, `icon`, `className` |
| `StickyScroll` | `sticky-scroll-reveal.tsx` | Pinned panel that swaps content as you scroll. Good for a process/treatment walkthrough. | `content` ({title, description, content}[]), `contentClassName` |
| `CardContainer`/`CardBody`/`CardItem` | `3d-card.tsx` | Card that tilts in 3D on pointer move. One per page maximum. | `containerClassName`, `translateZ`, `rotateX/Y` |
| `MagicCard` | `magic-card.tsx` | Card with a gradient/orb that tracks the cursor. Locally patched (see below). | `gradientSize`, `gradientFrom/To`, `mode` |
| `GlowingEffect` | `glowing-effect.tsx` | Cursor-following glow along a container border. Wrap any card. | `spread`, `proximity`, `disabled`, `borderWidth` |

## Testimonials & social proof

| Component | File | What it's for | Key props |
|---|---|---|---|
| `AnimatedTestimonials` | `animated-testimonials.tsx` | Photo + quote carousel with stacked image rotation. Needs a real portrait per entry (`src`) — **only real photos, or drop the component**. Uses `@tabler/icons-react`. | `testimonials` ({quote,name,designation,src}[]), `autoplay` |
| `InfiniteMovingCards` | `infinite-moving-cards.tsx` | Continuous horizontal quote ticker. Good when you have 3+ real reviews. | `items` ({quote,name,title}[]), `direction`, `speed`, `pauseOnHover` |
| `Marquee` | `marquee.tsx` | Generic infinite scroller for logos/words/images. | `reverse`, `pauseOnHover`, `vertical`, `repeat`, `[--duration:40s]` |

## Buttons & accents

| Component | File | What it's for | Key props |
|---|---|---|---|
| `HoverBorderGradient` | `hover-border-gradient.tsx` | Button/link with a gradient tracing its border on hover. `as` prop retargets the element. | `as`, `containerClassName`, `duration`, `clockwise` |
| `ShimmerButton` | `shimmer-button.tsx` | Button with a rotating shimmer edge. | `shimmerColor`, `shimmerSize`, `background`, `borderRadius` |
| `Button` / `MovingBorder` | `moving-border.tsx` | Button with a light travelling its perimeter. | `borderRadius`, `duration`, `as`, `containerClassName` |
| `BorderBeam` | `border-beam.tsx` | Beam travelling a container's border. Drop inside a `relative` box. | `size`, `duration`, `colorFrom/To`, `reverse` |
| `ShineBorder` | `shine-border.tsx` | Animated shining border overlay. | `shineColor`, `duration`, `borderWidth` |
| `BlurFade` | `blur-fade.tsx` | Scroll-triggered blur+slide reveal wrapper. The workhorse for section entrances. | `delay`, `inView`, `direction`, `offset`, `blur` |

---

# Motion pack — `components/motion/`

Hand-built, MIT-clean, no new dependencies (gsap, motion, lenis, clsx, tailwind-merge only).
Every one is a client component and every one has a reduced-motion branch.

```tsx
import { VideoHero, SplitHeadline, MaskWipe, SpecTags } from '@/components/motion';
```

**Read `../DESIGN.md` §6b before composing** — it carries the 3-4-mechanics rule, the
reference-mood → component mapping, and the performance budget.

## Hero & imagery

| Component | File | What it's for | Key props |
|---|---|---|---|
| `VideoHero` | `video-hero.tsx` | Full-bleed looping video hero — the cheapest wow in the pack (omr-beauty, special-production). Autoplays only in view, pauses off-screen, `preload="none"`. **Poster is required.** No `sources` → falls back to `KenBurnsImage` on the poster, which is the normal case for a business with no footage. Reduced motion mounts no `<video>` at all. | `sources` ({src,type}[]), `poster` **(req)**, `posterAlt` **(req)**, `overlay` ('none'\|'gradient'\|'scrim'\|'grain'), `overlayOpacity`, `gradeClassName`, `contentClassName` |
| `KenBurnsImage` | `ken-burns-image.tsx` | Slow scale/pan on a still photo — what makes one photograph cinematic (izanami, mont-fort). Linear on purpose: an eased zoom has a visible arrival. `direction="out"` is izanami's calmer settle. | `src` **(req)**, `alt` **(req)**, `direction` ('in'\|'out'\|'left'\|'right'\|'up'\|'down', def 'in'), `duration` (def 20s), `scale` (def 1.08), `loop`, `imageClassName`, `width`, `height`, `priority` |

## Scroll mechanics

| Component | File | What it's for | Key props |
|---|---|---|---|
| `MaskWipe` | `mask-wipe.tsx` | Clip-path reveal on a **hard** edge — the most-repeated motion mechanic in the pack. `mode="scrub"` makes the seam position the scroll position (vero-studio); `once` is the cheaper section entrance. `torn` swaps in a hand-torn SVG edge (serotoninn) — a fine wander with whiskers, not a zig-zag. | `direction` ('left'\|'right'\|'up'\|'down'\|'diagonal'), `mode` ('once'\|'scrub'), `torn`, `duration`, `ease`, `start`, `end` |
| `SplitScreenWipe` | `split-screen-wipe.tsx` | Pinned vertical split transition between two full-bleed panels (vero-studio). The caption **travels with the seam** on the same timeline — that detail is what makes it read as one object. Reduced motion stacks both panels vertically (a layout branch, not the same markup held still). | `base` **(req)**, `overlay` **(req)**, `caption`, `direction` ('left'\|'right'), `scrollDistance` (def '+=120%'), `showSeam` |
| `HorizontalRail` + `RailPanel` | `horizontal-rail.tsx` | Vertical scroll drives horizontal motion — GSAP pin + scrub with the `end` distance recomputed from `scrollWidth` on resize (special-production, floema). `scaleAtCentre` grows panels as they cross centre via `containerAnimation`. Below `mobileBreakpoint`, **and under reduced motion**, the pin is dropped for native `snap-x` scrolling. Give panels **different widths** — a uniform grid reads as a carousel. | `scaleAtCentre`, `minScale` (def 0.86), `gapClassName`, `mobileBreakpoint` (def 768), `trackClassName` |

## Type & chrome

| Component | File | What it's for | Key props |
|---|---|---|---|
| `SplitHeadline` | `split-headline.tsx` | GSAP **SplitText** stagger reveal, masked so lines rise from behind an edge (vero-studio: by line, `y: 100%`, stagger 0.08, duration 0.9, `power3.out`, once). Roman/italic mixing is **markup** — pass italic `<span>`s as children and they survive the split. `start={null}` plays on mount for a hero. Reduced motion renders plain static text. | `as` ('h1'..'p', def 'h2'), `by` ('chars'\|'words'\|'lines', def 'lines'), `duration`, `stagger`, `delay`, `ease`, `start` (string\|null) |
| `SpecTags` | `spec-tags.tsx` | Facts as an art-directed spec block, not a bullet list — the highest payoff-per-line item for a local business. `pills` = son-daven's ragged wrapped row of hairline uppercase tags (11px, 0.12em tracking); `list` = hairline-divided rows with an index column and right-aligned values, for services with prices. **Feed straight from snapshot facts.** No motion of its own — compose inside `BlurFade`/`MaskWipe`. | `items` ({label,value?,note?}[]) **(req)**, `variant` ('pills'\|'list'), `showIndex`, `caption` |
| `Preloader` | `preloader.tsx` | Typographic load screen with a **hard cap** (8 of 17 references have one; every one of them is too long for a cold demo). Fixed overlay over an already-painting page, dismissed at `window.load` or `maxDuration`, whichever is first. Skipped entirely under reduced motion and on repeat visits in the tab. `aria-hidden` + `inert`. | `wordmark` **(req)**, `caption`, `showCounter`, `maxDuration` (def **1200ms** — do not exceed ~1500), `exitDirection`, `oncePerSession` |
| `MagneticButton` | `magnetic-button.tsx` | A link that leans toward the cursor within a small radius. Renders an `<a>`, so it needs a real `href`. Bound only under `(hover: hover) and (pointer: fine)`. Deliberately modest — one per page, normally the CTA. | `strength` (def 16px), `radius` (def 90px), plus all `<a>` props |
| `CustomCursor` | `custom-cursor.tsx` | Dot cursor that grows over interactive elements, `mix-blend-mode: difference` by default. Never mounts on touch or under reduced motion, and **never hides the native cursor**. Note that essentially none of the 17 references buys its polish this way — garnish, not mechanic. | `size` (def 10), `hoverSize` (def 44), `blend` |

## Helpers — `lib/motion/`

`import { gsap, ScrollTrigger, SplitText, motionSafe, useReducedMotion, useInView, gsapRegister } from '@/lib/motion';`

One import surface. `gsap`/`ScrollTrigger`/`SplitText`/`useGSAP`/`motionSafe` are **re-exports**
of `@/lib/gsap` (still the single plugin-registration point) and `useReducedMotion` /
`prefersReducedMotion` re-export `@/lib/use-reduced-motion` — nothing is duplicated.

- `useInView<T>({ once, rootMargin, threshold })` → `[ref, inView]`. Unlike motion/react's
  `useInView({ once: true })`, with `once: false` it reports the **leaving** edge too, which is
  what pausing off-screen video needs.
- `gsapRegister()` — idempotent no-op-after-first registration, for defensively-written code.

## Photo grades — `app/globals.css`

`.grade-warm` (vero-studio amber) · `.grade-bronze` (son-daven) · `.grade-cool` (izanami) ·
`.grade-mono` · `.grade-noir` (omr-beauty) · `.grade-reveal` (grayscale → colour on hover/focus) ·
`.grain` (inline SVG noise overlay; needs a `relative` parent).

**One grade, on every photo on the page.** Apply to the `<img>` — i.e. `imageClassName` on
`KenBurnsImage` — not to a wrapper.

---

## Local patches

Four upstream files were modified. Keep these changes if you edit the files.

1. **`number-ticker.tsx`** — upstream rendered `startValue` in markup, so the exported
   static HTML shipped `0` and only became correct once JS ran; a visitor with JS
   blocked read a *wrong* number. Now renders the real value, and snaps straight to it
   under `prefers-reduced-motion` instead of animating.
2. **`magic-card.tsx`** — dropped the `next-themes` dependency (a static demo has no theme
   switcher) in favour of a direct `prefers-color-scheme` / `.dark` check, and hoisted two
   `useMotionTemplate` calls out of JSX. One sat behind `mode === "gradient"`, making it a
   conditional Hook call.
3. **`moving-border.tsx`** — `useRef<any>()` → `useRef<any>(null)`; React 19 requires an
   explicit initial value.
4. **Nine files** gained a `"use client"` directive they were missing upstream
   (`marquee`, `shimmer-button`, `animated-gradient-text`, `animated-shiny-text`,
   `grid-pattern`, `ripple`, `spotlight`, `bento-grid`, `background-gradient`).

## Sources & licence

- **Aceternity UI** — https://ui.aceternity.com — MIT. 16 components, fetched from its
  shadcn-style registry (`https://ui.aceternity.com/registry/<slug>.json`).
- **Magic UI** — https://github.com/magicuidesign/magicui — MIT. 13 components, fetched
  from `apps/www/registry/magicui/`.

Both are copy-paste libraries: the code is vendored here on purpose and there is no
upstream package to update. Attribution is not required in the rendered page.
