# Mont-Fort (Montfort Group)

- **URL:** https://mont-fort.com/
- **Captured:** 2026-08-18 (desktop 1440x900; no mobile.webm captured for this site)
- **Mood:** cold corporate prestige

- **Award:** Awwwards Site of the Month, June 2025 (by Immersive Garden)

## What makes the wow
- Loading state shows a small animated dotted "snowflake"/particle logomark alone on white before the hero mountain photo appears — reads as a deliberate brand-mark loader, not a spinner.
- Hero is a full-bleed misty/foggy mountain photograph with soft parallax: as the capture progresses the cloud/fog layers appear to drift and the peak position shifts slightly between frames, suggesting layered depth (foreground fog, mid mountain, background sky) rather than a single flat image.
- A small circular "scroll" indicator dot with a subtle pulsing ring sits mid-hero, paired with a chevron and "SCROLL DOWN TO DISCOVER" label at the bottom — a conventional but polished scroll affordance.
- Hard cut/cross-fade from the misty mountain hero into a cargo-ship-on-water photo for the "Montfort Maritime — Powering Progress, Delivering Energy" sub-brand section — full-bleed image swap with headline overlay, feels like a triggered section transition rather than a scroll-scrub.
- A rotating-globe/earth section follows: a dark, semi-transparent globe graphic with small labeled pin markers (Switzerland, UAE, Singapore) sits behind a bold claim ("ESTABLISHED IN THE WORLD'S MAJOR TRADE HUBS...") — looks like a slowly rotating 3D or pseudo-3D globe (likely WebGL/Three.js given the visible curvature and pin depth, but could be a pre-rendered image/video — cannot confirm from stills alone).
- A dark forest/green section ("DELIVERING SUSTAINABLE ENERGY SOLUTIONS") with small icon badges (leaf, water drop, etc.) in a horizontal row appears after the globe — same full-bleed photo-with-overlay-text pattern repeated per sub-brand.

## Timing & easing
- Loader-to-hero: loader visible for several seconds (bulk of early capture is the loading dot/particle mark on white) before the mountain fades in — a genuine multi-second preload gate, not instant.
- Section-to-section image swaps (mountain → ship → globe → forest) read as fade/cross-dissolve transitions, roughly 1-1.5s, triggered on scroll-into-view rather than continuously scrubbed — each section holds a static composition once settled.
- No visible spring/bounce; all easing reads as smooth ease-in-out, corporate-restrained.
- Nav underline beneath "MONTFORT GROUP" appears as a persistent active-state indicator, not clearly animated between tabs in this capture.

## Typography
- All-caps tracked-out sans-serif for nav and section labels (MONTFORT GROUP, MONTFORT TRADING, NEWS, MENU), wide letter-spacing.
- Wordmark "M O N T F O R T" is set in an extremely wide-tracked serif/slab-adjacent caps style paired with the dotted particle mark — distinctive, likely a custom or heavily-tracked serif.
- Body headlines ("POWERING PROGRESS, DELIVERING ENERGY", "ESTABLISHED IN THE WORLD'S MAJOR TRADE HUBS...") are large sentence/all-caps sans, medium weight, high line-height, sitting directly on photography.
- Overall: 1 sans grotesque family for UI/nav + wide-tracked caps treatment for the wordmark and major headlines — feels like 2 type treatments of essentially one family.

## Palette
- Deep corporate blue accent: approx #13678c (logo mark, active nav underline, links).
- Base white/off-white background: #ffffff on chrome/UI, near-black overlays on photography for text legibility.
- Photography-driven palette per section: cool grey-blue mountain mist, teal-grey ocean/ship, dark forest green — each sub-brand section effectively re-skins the palette via its photo rather than through UI color changes.
- Roughly 1 true UI accent (the blue) plus photography-derived section tones; very restrained, no secondary accent.

## Layout rhythm & photo treatment
- Each sub-brand section (Group, Trading, Capital, Maritime, Fort Energy) is a full 100vh photographic hero with a dark gradient scrim at the bottom/edges for text contrast.
- Photography is moody and desaturated/cool-graded (fog, teal water, dark forest) — consistent cinematic grade across all sections despite different subjects.
- Globe/data section breaks the pure-photo pattern with a graphic/map overlay — the one section that isn't a straight photograph.
- Footer is a conventional multi-column layout (office addresses per city: Geneva, Dubai, Singapore) on white/light background — a hard tonal break from the dark photo sections above it.

## Mobile behaviour
Not captured — desktop only (no mobile.webm present for this site).

## Performance notes
- Recording is smooth throughout; no visible stutter during the image-swap transitions.
- The loader gate at the very start is the most notable performance-adjacent UX choice — several seconds of blank/logo-only state before content, which is a real (not simulated) wait, likely for the hero image or globe asset to load.
- Globe section may be WebGL (Three.js) given the apparent 3D curvature and pin depth, but this cannot be confirmed as opposed to a high-quality static/video asset from the captured frames — describe as "likely" in any downstream copy.

## Reproduce with our stack
- Particle/dotted logomark loader: build as a small SVG or CSS radial dot-grid with a `motion` stagger-fade-in loop (`opacity` pulse per dot, `repeat: Infinity`), gated behind a `useState` "loaded" flag that flips on hero image `onLoad` — keep this under 1s for a local-business site, not multi-second.
- Full-bleed photo hero with fog/parallax: CSS `background-image` (or `next/image` fill) on a fixed-height section, two layered `<img>`s (foreground fog PNG with transparency, background mountain) each given a slow independent `translateY`/`scale` via GSAP ScrollTrigger `scrub: 1` for a cheap parallax — no WebGL needed to approximate the effect.
- Section-to-section image cross-fade: GSAP ScrollTrigger with `toggleActions: "play none none reverse"` cross-fading two absolutely-positioned full-bleed images, ~1.2s ease `power2.inOut`.
- Globe with pin markers: if truly needed, approximate with a static equirectangular/orthographic globe illustration (SVG or image) plus absolutely-positioned pin dots with `TextAnimate`/`motion` fade-in stagger — a real rotating 3D globe is out of scope for this stack (no Three.js in the pool) and overkill for a local business anyway.
- Icon badge row (leaf/water drop): plain flex row of SVG icons with `BlurFade` (pool component) stagger-in as they enter viewport.

## Gaps
- No Three.js/WebGL globe capability in the stack — if a "global reach" moment is wanted for a local business (unlikely), fake it with a static illustrated map/pin graphic instead of a real rotating 3D globe.
- No built-in multi-layer parallax-fog helper; achievable with plain GSAP ScrollTrigger scrub but not a packaged utility today.
- No image-preload/loader-gate pattern currently wired into the site template (the "wait until hero image loads, then reveal" flow would need to be added manually per page).

## Don't borrow
- The multi-second brand-mark loader gate before any content shows — unacceptable for a local business page where every second of delay costs conversions; skip loaders entirely or cap at a few hundred ms.
- Five near-identical full-viewport photo-hero sections back to back (one per sub-brand) is far too much scroll distance for a single-service local business; compress to hero + 2-3 sections.
- Corporate multi-city office directory footer — a Patras salon/taverna needs one address, hours, and a map pin, not a global-offices grid.
