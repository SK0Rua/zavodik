# Alethia

- **URL:** https://www.alethia.earth/
- **Captured:** 2026-08-18 (desktop 1440x900, mobile 390x844)
- **Mood:** dark data-driven futurism

- **Award:** Awwwards Site of the Day, August 2026

## What makes the wow
- Preloader is a single small white hexagon/dot icon centered on near-black (#101e0f-ish), held for a couple of seconds before the hero renders — a minimal geometric loader rather than a spinner or progress bar (same pattern on both desktop and mobile captures).
- Hero centerpiece is a cluster of photoreal, moss-and-lichen-covered 3D rocks floating against a dark green background, several smaller rocks scattered around the edges at different depths/scales — reads as a 3D scene (likely WebGL/Three.js given the multiple independently-scaled floating rock instances and consistent lighting/shadow) rather than a flat photo composite.
- Floating data-readout labels ("VERIFIED REMOVAL -1.2 tCO2", "-8.3 tCO2E", "-4.3 tCO2E") and thin bracket/target reticle graphics are pinned near specific rocks in the hero, like HUD annotations pointing at "measured" spots on the ecosystem — ties the visual metaphor directly to the product (verified carbon data).
- Headline "Where Ecosystem Science and Enterprise Strategy Meet" fades/tracks in over the rock scene; by a later frame the same headline has shrunk and repositioned into a smaller top-left lockup while the rock cluster continues to sit large in-frame — suggests a pinned hero where text and 3D scene are choreographed together over scroll rather than a single static hero.
- A dark mid-page section ("Just Real, Measured Insight. Delivered with Integrity.") shows a technical HUD-style graphic — a small line/node diagram with numeric readout ("Accumulated carbon balance 2.4") and two pill tags ("NO SPREADSHEETS", "NO GUESSWORK") — a distinct data-visualization moment separate from the 3D hero.
- Footer reveal: the wordmark "alethia" is set in an enormous lowercase lime-green (#dfe13e-ish) display face filling most of the viewport width over a dark textured/foliage background — a classic oversized-logo footer moment, paired with contact/office info below it.

## Timing & easing
- Preloader hold: roughly 2-3s of dot/hexagon-only state before any hero content appears, on both desktop and mobile.
- Hero text and rock cluster settle-in reads as a slow, weighty ease-out (rocks appear to drift/settle rather than snap), consistent with a scroll-scrubbed or timeline-driven 3D camera move rather than a simple CSS fade.
- Section-to-section content (cards, news items) appears to fade/slide up on enter, moderate duration (~0.6-0.9s), not aggressively staggered.
- Overall pacing is deliberate and slow relative to Floema/Ellmerers-Hof — consistent with a "serious enterprise data platform" positioning.

## Typography
- Headline face is a clean, slightly rounded grotesque sans, sentence case, large scale (roughly 48-64px equivalent at 1440 width) for the hero claim.
- Small mono/technical-feeling caps are used for the data-readout labels and eyebrow tags ("OUR SOLUTIONS", "OUR TECH") — likely a separate monospace or condensed sans for that "instrument panel" texture, distinct from the headline face.
- Footer wordmark uses a bold, tightly-spaced lowercase geometric sans/rounded display face, dramatically larger than any other type on the page.
- Overall: roughly 2-3 type roles — display sans (headlines), a technical/mono-feeling label face (data tags, HUD), and the oversized footer wordmark treatment of the display face.

## Palette
- Deep near-black forest green background: approx #101e0f (dominant dark backdrop throughout).
- Lime/chartreuse accent: approx #dfe13e-#e9e778 range, used for the footer wordmark, pill tags ("LET'S TALK" button), and small highlight marks on the rocks.
- Muted olive/khaki mid-tone: approx #50524d, used in transition/secondary panel backgrounds.
- Photography/3D rock texture itself is naturalistic moss-green and stone-tan, reinforcing the "real ecosystem" data story.
- One dominant dark base + one loud lime accent — a strong 2-color system, high contrast, tech/climate-native feel.

## Layout rhythm & photo treatment
- Hero is a tall (likely >100vh, possibly pinned) 3D scene section with generous negative space around the floating rock cluster.
- Card sections below use a mixed grid: large photo card (dewy leaves) + solid lime-green color-block card side by side — combining real photography with flat brand-color panels.
- Mid-page technical section drops to near-black with centered, tightly-set headline over a faint circular/radial line-art motif (concentric arcs), giving a "sonar/data" texture behind text.
- News/insights cards are conventional image-top, text-below cards on a light background — the one section that breaks from the dark-mode-dominant palette.

## Mobile behaviour
- Same hexagon dot preloader on black before content, confirmed in the mobile capture.
- Mobile hero swaps the 3D rock cluster for what reads as aerial/satellite farmland imagery under the headline "Real-World Emissions Data. Enterprise-Wide Climate Clarity." — a simplified, more static hero for small screens rather than the full floating-rock scene.
- The dark technical section reuses the same concentric-arc radial motif behind a large centered headline ("Scientific Rigor. Commercial Precision. Unmatched Trust."), stacked full-width.
- Footer wordmark treatment carries over to mobile: huge lowercase "alethia" in lime-on-dark filling the width, with stacked contact/legal columns below.

## Performance notes
- Recording is smooth; no visible stutter, but the multi-second preloader is a real, deliberate wait gate on both desktop and mobile.
- The 3D rock hero, if WebGL, is the heaviest visual element on the page — no visible frame drops in the capture, but this is the one section most likely to need a lower-fidelity fallback on constrained devices.
- No visible image pop-in/lazy-load flash beyond the initial preloader.

## Reproduce with our stack
- Hexagon/dot preloader: small SVG icon with a `motion` pulse/opacity loop, gated on hero asset load; cap the hold at a few hundred ms for a local-business site rather than multi-second.
- Floating "3D-look" rock hero: fake the depth with 3-5 layered PNG/webp cutout images (rock renders or stock photos with removed backgrounds) placed with different scale/blur/z-index, animated with GSAP `ScrollTrigger` (scrub) for slow independent drift (`y`, slight `rotate`) per layer — gives a parallax-3D illusion without real WebGL. True Three.js floating-object rendering is out of scope for the stack.
- HUD data-readout labels pinned to rock positions: absolutely-positioned small `<div>` badges with `NumberTicker` (pool component) for the numeric values, `BlurFade` or `motion` fade-in with a slight delay stagger as the hero settles.
- Headline-shrinks-into-lockup-while-scrolling: GSAP ScrollTrigger pin on the hero section + a timeline tweening headline `fontSize`/`scale` and `x`/`y` position as the user scrolls, `scrub: true` for direct linkage.
- Dark technical section with concentric radial arcs: `BackgroundBeams` or `GridPattern`/`DotPattern` (pool components) swapped for a radial variant — approximate with layered `border-radius: 50%` rings using CSS `box-shadow` rings or repeated absolutely-positioned circles with decreasing opacity, animated with a slow `scale` pulse via `motion`.
- Oversized lowercase wordmark footer: plain large Tailwind text utility (`text-[18vw]` or similar clamp) in the lime accent color, no special component needed — pair with `SplitText` chars-in stagger if an entrance animation is wanted.
- Lime color-block card next to photo card: literal Tailwind `bg-[--color-accent]` card, same "hard color block next to photography" idea as Floema.

## Gaps
- No true WebGL/Three.js capability in the stack for a literal floating-3D-object hero — must be faked with layered flat images + parallax scroll, which will read flatter/less convincing than the original.
- No packaged radial/concentric-arc background utility (GridPattern/DotPattern in the pool are grid-based, not radial) — would need a small custom SVG or CSS component.
- No existing "pin hero + scrub headline transform" recipe documented in the site template; would need to be authored fresh with GSAP ScrollTrigger pin, though this is well within stack capability.
- No image-cutout/rock-render assets on hand — would need sourced or generated (via gen-image skill) transparent-background photo elements to fake the floating-object effect.

## Don't borrow
- The multi-second geometric preloader on every load — wrong trade-off for a small local business where speed-to-content matters more than brand ceremony.
- Enterprise-data positioning (HUD readouts, "verified removal" data tags, multi-tab technical claims) doesn't fit a salon/spa/taverna; the data-instrument aesthetic should not be reused wholesale, only the general "confident dark hero + one loud accent color" structure.
- Scroll-pinned hero with a long settle animation adds real scroll distance before any real content — keep local-business heroes short and immediately scannable.
