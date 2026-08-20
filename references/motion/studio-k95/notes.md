# Studio K95

- **URL:** https://k95.it/
- **Captured:** 2026-08-18 (desktop 1440x900)
- **Mood:** electric maximalist brutalist (WebGL playground)
- **Award:** Awwwards Site of the Day, Aug 11 2026

## What makes the wow
- **Persistent 3D scene as the entire homepage.** The whole capture (after a brief white loading flash) takes place inside one continuous WebGL scene on a saturated electric-blue background with a faint perspective grid floor — there is no traditional scrolling section-to-section; scroll instead drives camera/scene state within this single 3D space.
- **Rotating chain/ribbon sculpture that morphs shape.** A white, chrome-shaded 3D object built from a chain of rectangular extruded links continuously rotates and slowly reforms — in different frames it reads as a rose/bloom shape, a coiled spring, a face/skull-like silhouette, and a tight double-spiral — over the course of the ~33s capture, implying it is a single procedurally-animated mesh (likely the "K95" mark) rather than several discrete objects.
- **Orbiting project-image cards in 3D space.** 15-20 small rectangular project thumbnails (client work: packaging, posters, apparel, branding) are placed around the central sculpture as flat planes in 3D, each tilted at a slightly different angle, drifting/rotating gently as if attached to an invisible sphere — camera movement and scroll cause them to reposition.
- **One card zooms to focus with a label overlay.** At points during the scroll, one project card animates toward the camera to become large and centered (e.g. a "Wratislavia — Branding" tote-bag shot), displacing the sculpture off to the side — reads as a scroll-driven "select and zoom" carousel mechanic living inside the same 3D scene.
- **Toggle pills for view modes ("RINGS" / "SPIRAL").** A pill-shaped segmented control sits fixed at top-center, implying the user can switch which arrangement/choreography the floating cards follow (ring formation vs. spiral formation) — a deliberate, named interaction rather than incidental animation.

## Timing & easing
Everything reads as continuous and slow rather than snappy — the central sculpture's rotation and morph feel like a multi-second (5s+) loop with no sharp starts/stops, consistent with a WebGL scene animated on a running clock rather than discrete triggered tweens. The one card-to-focus transition observed feels like a smooth ease (slow-in/slow-out, roughly 1-1.5s) rather than a hard cut. No obvious stagger patterns since most motion is continuous/ambient rather than list-based.

## Typography
Small-caps, tightly tracked sans-serif for nav items ("ALL WORKS", "STUDIO", "CONTACT") and the pill toggle labels ("RINGS", "SPIRAL") — a single grotesque family throughout, used only at small utility sizes in what was captured (no large display headline was visible in this recording, since the 3D scene itself carries the visual weight instead of type).

## Palette
Dominant flat ultramarine/electric blue (~#1a1ce0) fills the entire background; the central sculpture is rendered in white/light-grey chrome shading (near-white #f0f0f0 to mid-grey shadow tones); project thumbnails contribute scattered full-color accents (red #e8432a-ish, yellow #f2c94c, orange) but the site's own chrome (nav, pills, footer text) stays white-on-blue. Effectively a one-hue brand background with white UI and full-color project imagery as the only variety.

## Layout rhythm & photo treatment
Single persistent full-viewport 3D canvas — no conventional stacked sections were visible in this capture. Fixed header (logo, pill toggle, nav, language switcher) and fixed footer bar ("BRAND & DIGITAL DESIGN STUDIO", "12 / 20 selected Works", copyright) sandwich the 3D content and stay put regardless of scroll/camera movement. Project thumbnails are cropped to simple rectangles (portrait and landscape mixed) and shown at natural/un-graded color — no heavy filter or duotone applied to the work images themselves, the "treatment" is entirely the 3D placement, not the images.

## Mobile behaviour
Not captured — desktop only.

## Performance notes
Motion looks smooth throughout the sampled frames with no visible tearing or pop-in; this is clearly WebGL/Three.js-class rendering (a real 3D perspective scene with lighting on the chrome sculpture, not a CSS 3D fake), which is the heaviest reference in this batch — a full 3D engine, procedural mesh morphing, and 15-20 texture-mapped planes running continuously.

## Reproduce with our stack
- **Cannot faithfully reproduce the 3D scene** with the current stack — there is no Three.js/WebGL runtime in the listed toolset (GSAP, motion, Lenis, Aceternity/MagicUI pool are all DOM/CSS-transform based). This is the single biggest gap for this reference.
- Approximate the mood instead: a flat saturated-blue full-bleed section using the `BackgroundBeams` or `AuroraBackground` pool component for ambient motion, with project thumbnails arranged in a loose scattered grid using CSS `transform: rotate()` on each card plus a slow continuous `motion` drift animation (small `x`/`y`/`rotate` oscillation, `repeat: Infinity`, `ease: "easeInOut"`, 4-8s duration) to fake the "floating in space" feel without true 3D.
- The segmented pill toggle (RINGS/SPIRAL) can be built as plain Tailwind with a `motion` layoutId shared-element slide for the active-state background.
- The "zoom one card to focus" mechanic maps reasonably well to GSAP `ScrollTrigger` scrubbing a `scale`/`z-index` change on the target card as it's selected — feasible without WebGL if simplified to a 2D card stack.

## Gaps
- No Three.js/WebGL/3D mesh runtime in our stack — the central rotating chrome sculpture and true depth-sorted orbiting cards cannot be built as specified; any reproduction is a 2D/CSS-transform approximation, not the real thing.
- No procedural mesh-morph capability (rose → spiral → face) — would require a 3D engine and custom geometry code regardless of stack.

## Don't borrow
- A single unbroken 3D scene as the entire homepage, with no conventional readable sections, is wrong for a local business — visitors need to quickly scan services, hours, address, and a way to contact/book, not explore an abstract art piece.
- The saturated all-over blue background with white-only text has poor legibility ergonomics for older/mixed-age local audiences; keep this only as a small accent moment, not the whole page.
- Fixed/pinned camera-driven navigation with no visible scrollbar progress can disorient users on a first visit — a Patras taverna site needs an obviously-scrollable, conventional page structure underneath any flourish.
