# Lama Lama — creative digital agency, single-scene morphing hero

- **URL:** https://lamalama.com/
- **Captured:** 2026-08-18 (desktop 1440x900, mobile 390x844)
- **Mood:** loud, tactile, maximalist restraint
- **Award:** Awwwards Site of the Month Jul 2026 + SOTD Jul 20 2026

## What makes the wow
- The entire captured experience (both desktop.webm and mobile.webm run their full ~32-34s length) is effectively ONE viewport: a fixed headline "A CREATIVE DIGITAL AGENCY THAT GOES ALL IN OR NOT AT ALL." plus a fixed right-hand paragraph sit on top of a full-bleed background video/texture loop that keeps cutting to completely different material states — deep red liquid folding on black, blue-grey stone with a lightning flash across a cloudy sky, gold-and-black cellular/marbled coral pattern over a halftone dot-grid, a burning orange flame ball rising through smoke, brown skin-like macro texture with a water droplet, a pink-red streaked light comet crossing a black halftone field, and a close-up amber iris (mobile only). Cuts land every 2-4s, hard cuts not crossfades — no easing is visible between states, it just changes.
- Text stays pixel-locked in place for the whole sequence: headline bottom-left, paragraph + hairline rule bottom-right area never move while everything behind them changes. This "fixed content over an unstable world" contrast is the core mechanic.
- Preloader: ~4-6s hold on black with a tiny animated percentage counter (seen at 0%, 0%, 98%) at two symmetric x-positions, then the "L." monogram logo assembles bottom-up as 4 solid rectangular blocks (stair-step reveal, no easing visible, feels like a hard step-function reveal rather than a smooth tween) before the first texture frame appears.
- Small floating UI persists over the whole scene: monogram logo + "YOU MADE IT" pill nav top-center, a "GET IN TOUCH" avatar chip top-right, and below it a "THIS IS US" thumbnail card with a black-and-white portrait photo and a "(-)" collapse control — these read as fixed HUD chrome, not part of the scrolling content.
- A thin horizontal rule sits above the footer-style bottom bar ("20+ DIGITAL FREAKS" / "AMSTERDAM BASED" / countdown timer "[23:55:44]" / "FOLLOW US" / Instagram / LinkedIn / language toggle NL-EN) that is visible in every frame — this bar does not move either.
- On the frame with visible mid-transition state, the headline briefly shows a scanline/glitch clip artifact ("A CREATIVE DIGITAL" cut off mid-glyph with horizontal scan lines) suggesting a masked wipe or noise-displacement effect drives each material swap rather than a plain cut.

## Timing & easing
Cuts between material states land roughly every 2-3.5s with no visible crossfade — reads as a hard cut or a very fast (<150ms) wipe/glitch transition, not an eased blend. The preloader counter and logo-block reveal look stepped/discrete rather than smoothly tweened. No scroll-driven pinning was observed since the whole capture never leaves this one screen — this is a hero-loop, not a scrollytelling sequence.

## Typography
Headline is a bold grotesque/condensed sans (all caps, tight tracking, 3 lines, very heavy weight) in off-white (~#F7F4ED). Body paragraph and UI labels (nav, footer) use a much lighter-weight monospace/grotesque at small size, all caps for labels, mixed case for the paragraph. Strong weight contrast between headline and everything else is a deliberate signal of hierarchy.

## Palette
- Headline text: `#F7F4ED` (warm off-white)
- Dark panel/nav chrome: `#1A1A1A`-ish translucent black bars
- Material states cycle through: red liquid `~#8C1A12`, blue-grey stone `~#8A9491`, gold/amber fire `~#DFB843`, brown skin macro `~#6B4A34`, pink-red streak `~#C4444C`
- Accent count: essentially none beyond the shifting background itself — no single fixed brand accent color, the "accent" IS the rotating texture. Foreground chrome is monochrome white/black only.

## Layout rhythm & photo treatment
No traditional multi-section scroll rhythm was captured — this is a single hero "stage" that the user parks on while background media cycles. Photography/footage is full-bleed edge-to-edge, always covering the full 1440x900 (or 390x844) frame with no padding, treated as raw macro/abstract material rather than product or lifestyle photography — nothing here is literal "our team" or "our work" imagery, it's all texture metaphor for "craft/heat/intensity."

## Mobile behaviour
Mobile keeps the identical preloader (percentage counter, then stair-step logo block reveal) and the same texture-cycling background. Layout differs: no top-right thumbnail/avatar HUD card is present on mobile; headline and paragraph stack full-width below/over the texture rather than left/right split, with a hairline rule under the paragraph before the footer meta row ("20+ DIGITAL FREAKS" / "AMSTERDAM BASED"). Same hard-cut cadence between material states, no visible slow-down or simplification of the effect for touch.

## Performance notes
Format is background video/canvas loop covering the full viewport at all times, which is expensive (likely several MB of video assets given hard cuts every 2-3s across ~6+ distinct clips) — this is not something to replicate 1:1 with a single background-video element for a small local-business demo. Provided capture is small (4.4MB desktop webm, 1.2MB mobile webm at scroll-capture resolution) — real production asset weight is unknown but full-bleed HD video loops of this density are a real payload risk.

## Reproduce with our stack
- Fixed-over-changing-background layout: CSS `position: fixed` (or a pinned wrapper) for headline+paragraph, absolutely-positioned background layer beneath, achievable with plain CSS — no GSAP needed for the pinning itself since it isn't scroll-driven.
- Material-cycling background: replace video loop with a `motion/react` `AnimatePresence` cross-fading between 4-6 static high-quality photos/textures on a `setInterval` (2.5-3.5s), using `opacity` fade only (no scroll trigger) to keep it lightweight — this is the realistic budget-conscious substitute for the hard-cut video.
- Preloader percentage counter: `NumberTicker` (pool component) driving 0→100, paired with a simple `motion` stagger for the logo block reveal (4 rectangles animating `scaleY` from 0 with a stepped/no-ease timing function, `duration: 0.08` per block, `staggerChildren: 0.08`).
- Glitch/scanline transition flash: approximate with a brief CSS `mix-blend-mode` + noise texture overlay pulsed via `motion` opacity keyframes (`[0, 1, 0]` over ~120ms) rather than true WebGL displacement — flag as approximation, cannot fully reproduce a shader-level RGB-split glitch with our stack.
- Fixed HUD chrome (nav pill, avatar chip, thumbnail card): plain fixed-position divs, no pool component needed; `BorderBeam` or `ShineBorder` optional for a subtle edge highlight if wanted, but skip to stay under the 4-component budget.

## Gaps
- No cross-fading texture-sequence helper exists in the vendored pool — would need a small custom component wrapping `motion/react` `AnimatePresence` for N background images on an interval.
- No RGB-split/glitch/scanline utility in the pool; any glitch-transition attempt is CSS-only approximation, not the real WebGL effect seen here.
- No stepped/blocky logo-reveal primitive; would hand-roll with `motion` stagger, straightforward.
- Video-loop-as-hero is not really compatible with "no internet at build time / local business demo" budget — must design this as photo-cycling from day one, not attempt to source or render 6 abstract video clips.

## Don't borrow
- The abstract, non-literal material-morph hero (fire/liquid/stone/skin) reads as "high-concept agency flex" — completely wrong register for a Patras taverna or beauty salon; a local business needs to show its actual space/product/food, not abstract macro textures standing in for "craft."
- The near-total absence of any legible business information above the fold (no address, no services, no photos of the actual place) works for an agency teaser page building intrigue, but a local-business demo must lead with recognizable, concrete content.
- Countdown timer and "you made it" gamified copy is agency-portfolio personality — would read as gimmicky/confusing on a salon or spa site.
