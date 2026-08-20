# Floema

- **URL:** https://floema.com/
- **Captured:** 2026-08-18 (desktop 1440x900, mobile 390x844)
- **Mood:** warm industrial editorial

- **Award:** Awwwards Site of the Month, May 2026 (by Bürocratik)

## What makes the wow
- Full-bleed hero photo (a Portuguese street scene with the brand's urban furniture in it) fades in from black over roughly the first 2s, with the headline and a small "Catálogo" download card cross-fading in slightly after the photo.
- Category sections (Urban, Golf, RePlastic, etc.) each open as a full-viewport photo with a small pill-shaped category tag, a 2-3 line serif-adjacent headline, and a rounded pill CTA button, one category per scroll unit — feels like a sequence of hero "chapters" rather than one continuous hero.
- Product cards (chair, bin, bench) sit on flat cream cards with a small swatch row of color dots underneath — no visible hover-tilt in the capture, but cards appear to fade/slide up into place as they enter viewport.
- The About/contact block switches the entire background to a saturated yellow-green (#e9e778-ish) block with a big black arrow/logomark graphic and large serif display line "Made to last, designed to endure." — a hard section-to-section color-block transition rather than a gradient.
- Footer/mosaic: a scattered grid of small square product thumbnails (some rotated slightly) drifts in around the nav, visible at both very start (behind the cookie modal) and used again on mobile as a blurred-to-sharp background behind the mission statement.
- Cookie-consent modal (Cookiebot) recurs identically at multiple points in the capture — not part of the design language, just the actual GDPR banner; ignore for reproduction.

## Timing & easing
- Hero fade-in from black: roughly 1.5-2s, ease-out, no bounce.
- Section-to-section scroll transitions read as triggered-and-plays (opacity/translateY on enter) rather than a continuous scrub — each "chapter" hero snaps into its own full-bleed image with text following about 0.2-0.3s later.
- Mobile mission-statement image mosaic: blurred thumbnails sharpen gradually while text stays centered and static — feels like a slow (2-3s) blur-to-focus tween, ease-in-out, not scroll-scrubbed (text is legible while background is still blurred, so it is timer-driven not scroll-linked).
- No visible spring/overshoot anywhere; everything reads restrained and industrial (linear-ish or ease-out cubic).

## Typography
- Headline face is a clean grotesque/sans (mixed uppercase pill labels + sentence-case headlines), medium weight, generous line-height, roughly 32-40px equivalent at 1440 width for section headlines.
- Wordmark "floema®" uses a distinctive geometric sans with a flagged capital F.
- Body/nav uses a smaller all-caps tracked-out sans for nav items (PRODUTOS, SOBRE, SUSTENTABILIDADE, JORNAL).
- Overall: 2 weights of one grotesque family, all-caps for navigation/labels, sentence-case for headlines and body — no serif observed.

## Palette
- Warm off-white / stone background: approx #f2efea (dominant background through most of the page).
- Near-black text/ink: approx #22211f.
- Saturated yellow-green accent block: approx #e9e778 (About/contact/footer section).
- Orange tag pill: approx #e8532c-ish (seen on the "Urban" category tag, warm construction-orange).
- Photography itself is desaturated/documentary toned (concrete, timber, greys) which keeps the accent yellow-green feeling like a single loud accent color against otherwise muted tones. Roughly 2 accent colors total (yellow-green + orange tag).

## Layout rhythm & photo treatment
- Each category/product section is a full 100vh (or near) photographic hero — tall, immersive sections rather than short cards.
- Photography is documentary/on-site (real installed furniture in real plazas/parks), lightly graded toward warm neutral, not heavily color-graded or duotoned.
- Product-detail sections switch to flat studio-style shots on cream background, asymmetric 2-up grid (one large product image + one smaller).
- Footer/mosaic treats small thumbnails as scattered, slightly rotated tiles rather than a grid — an intentional "pinboard" feel.

## Mobile behaviour
- Mobile opens on a plain centered mission statement ("Espaços pensados para viver e durar uma vida.") over a nearly blank warm background, then a blurred mosaic of product thumbnails resolves into focus behind the same text.
- Category sections stack vertically as full-bleed photo blocks with an eyebrow tag (e.g. "04 Golf"), headline, and pill CTA — same chapter pattern as desktop, one per screen.
- Footer becomes the same yellow-green block, full width, with stacked link columns and social icons.
- No evidence of a hamburger-driven off-canvas animation in the capture (nav condenses to a hamburger + search icon, menu open not captured).

## Performance notes
- Recording is smooth; no visible jank or frame drops.
- Fade-ins/section entries look pre-composed (image fully loaded before fade begins) — no visible progressive image pop-in or lazy-load flash, though this may be an artifact of the recording starting after initial load.
- No visible WebGL — everything reads as DOM/CSS/photo compositing, well within reach of the stack.

## Reproduce with our stack
- Hero fade-in-from-black: `motion` (`framer-motion` successor) `initial={{opacity:0}} animate={{opacity:1}}` on the hero wrapper, duration ~1.5s, ease `[0.16,1,0.3,1]` (ease-out expo-ish).
- Chapter-style full-bleed sections: plain CSS `min-height: 100vh` sections + GSAP ScrollTrigger `toggleActions: "play none none reverse"` (not scrubbed) to fade/translateY (y: 24px → 0) the tag pill, headline, and CTA in with a ~0.15s stagger via GSAP timeline (`stagger: 0.15`).
- Color-block About/contact section: literal CSS background-color swap between sections, no gradient — trivial with Tailwind v4 `@theme` token for the accent yellow-green.
- Product swatch dots: plain CSS flex row of small rounded divs, no pool component needed.
- Scattered/rotated thumbnail mosaic: CSS grid with per-item `rotate(-3deg..3deg)` via inline style or a small deterministic hash-based rotation, no library needed. For the mobile blur-to-focus reveal, animate `filter: blur(12px)→blur(0)` with GSAP or `motion`, timer-triggered on mount (not scroll-linked), ~2.5s ease-in-out.
- Category tag pill + rounded CTA button: plain Tailwind utility classes, no pool component required (this whole site uses almost no "wow" library effects — it is essentially disciplined typography, full-bleed photography, and one loud color block).

## Gaps
- None of our pool components map directly to this design's actual mechanics — Floema does not use particle/gradient/glow effects, so this is a good "restraint" reference rather than a gap-revealing one.
- We lack a documented pattern for the scattered/rotated thumbnail mosaic-as-hero-background — straightforward to build with CSS grid + rotation but not currently a reusable snippet in the pool.
- No ready-made blur-to-focus reveal utility; would need a small custom GSAP/motion helper (trivial, ~10 lines).

## Don't borrow
- The "chapter per scroll" structure (5+ near-identical full-viewport photo heroes back to back) is too long and slow-to-convert for a single-location local-business landing page — condense to one hero plus 2-3 supporting sections.
- Cookie-consent-modal-driven UI (not a design choice, just GDPR chrome) — irrelevant to a Patras demo site with no ad tracking.
- Multi-market footer (Portugal + Spain offices, investor/compliance links) is corporate-scale content density; a local salon/taverna needs a much sparser footer (address, hours, socials, map).
