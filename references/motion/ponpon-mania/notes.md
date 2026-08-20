# Ponpon Mania

- **URL:** https://ponpon-mania.com/
- **Captured:** 2026-08-18 (desktop 1440x900)
- **Mood:** bright playful illustrated comic
- **Award:** Awwwards Site of the Month, Oct 2025, by Patrick Heng

## What makes the wow
- **Blob-shaped hero mask.** The entire hero illustration (sunset skyline, three character mascots, a moon) is clipped into a soft, irregular rounded "sticker/cloud" blob shape rather than a rectangle — the illustration's edges are visibly scalloped/lumpy against the flat periwinkle-blue page background, giving a die-cut sticker feel.
- **Flat vector character illustrations in confident poses.** Three large mascot characters (a llama/sheep in a flat cap raising both arms, a grinning grey wolf carrying a drinks tray, a green dinosaur checking a phone) are rendered in bold flat color with thick black outlines — a comic-book/BD (bande dessinée) illustration style, not photographic or 3D.
- **Spinning circular "interactive comic" badge.** A black circular badge with a llama-face icon and curved label text ("TA BD INTERACTIVE COMIC! YOUR INTERACTIVE COMIC!") sits over the hero, positioned like a vinyl-record seal — its rotation and small position shifts across frames suggest a continuous slow spin, a classic "as-seen-on / seal of quality" motif reused as a UI ornament.
- **Sparkle/twinkle particles scattered across the sky.** Small white star/sparkle marks are scattered over the orange sunset gradient, at slightly different positions and opacities between frames — reads as a slow twinkling ambient particle loop rather than static decoration.
- **Preloader mascot logo.** Before the hero appears, a circular llama-face icon on a cream background plays a short idle/blink animation (the icon's mouth/face shape changes subtly between the two loader frames sampled) — a branded loading moment rather than a generic spinner.

## Timing & easing
Reliable observation is limited (see Performance notes) — the loader-to-hero transition is a simple cut/quick fade, not a long reveal. The badge rotation and sparkle twinkle read as slow, continuous, low-amplitude ambient loops (looks like several-second cycles) rather than snappy triggered animations. No scroll-linked transition could be confirmed from this capture.

## Typography
Chunky, rounded, heavyweight display sans for the "ponpon mania" logotype (bold, friendly, slightly bouncy baseline where letters sit unevenly — consistent with a custom hand-tuned wordmark rather than a stock font run straight). Small caps/sentence-case sans for nav ("chapters", "about") and the byline ("by Justine Soulie and Patrick Heng"). The "read now" button uses the same rounded bold sans, larger scale. Overall: one confident rounded display face for branding, one plain small sans for utility text — 2 sizes/weights total observed.

## Palette
Periwinkle/violet-blue page background (~#7B7FF0), warm orange-to-gold sunset gradient (~#F5A623 to ~#FFD36E) inside the hero blob, pink accent clouds (~#F5A3C7), red foreground ground plane (~#E8432A), and a soft pink cloud band at the very bottom (~#FBC7DC). This is a saturated, high-key palette with 5+ named hues in play at once — much more colorful than the other four references in this set.

## Layout rhythm & photo treatment
Single hero-dominant composition: the illustration blob occupies nearly the full viewport height with only a thin sliver of background page color visible at the very top/sides. No photography is used anywhere in what was captured — 100% flat vector illustration. Composition is symmetrical-ish with the three characters arranged in a loose triangular grouping, headline centered above them, CTA button centered below.

## Mobile behaviour
Not captured — desktop only.

## Performance notes
Honest caveat: this capture uses heavy virtual/JS-driven scroll, and the recording appears to dwell almost entirely on the hero illustration — successive sampled frames show only very minor differences (badge rotation, sparkle positions, a drink-cup color flicker on the wolf character) rather than the page advancing through new sections or "chapters." The comic/interactive-story content implied by the site's premise (a scrollable BD/chapter reader) is very likely under-represented or entirely missing from this capture. Treat this reference as hero-only evidence; do not assume the rest of the site behaves the same way.

## Reproduce with our stack
- Blob-mask hero: CSS `clip-path` with a hand-authored irregular polygon/blob path (or an SVG mask), applied to a full-bleed illustration container — no pool component needed, just static CSS once the blob path is authored (e.g. in Figma/SVG export).
- Flat vector mascot illustrations: out of scope for GSAP/motion — these are static SVG/PNG illustration assets that would need to be commissioned or AI-generated (flagged `ai_generated` per project rules) to match this style; the animation layer only handles their entrance/idle motion, not the artwork itself.
- Spinning circular badge: simple CSS `@keyframes` or `motion` `animate={{ rotate: 360 }}` with `repeat: Infinity, duration: 8-12s, ease: "linear"` — trivial, no pool component required.
- Sparkle twinkle particles: small scattered `motion` elements with looping opacity/scale pulses (`repeat: Infinity, repeatType: "reverse"`, randomized `delay` per element, 1.5-3s duration) — or substitute the `Ripple`/`DotPattern` pool components at low opacity for a cheaper approximation.
- Preloader mascot: a simple `motion` scale/opacity mount animation on the logo mark before revealing the hero, 0.4-0.6s `ease-out`.
- If scroll-chapter content is confirmed to exist beyond the hero (needs re-capture to verify), GSAP `ScrollTrigger` with a horizontal or panel-based reveal per "chapter" would be the natural mapping.

## Gaps
- No confirmed evidence of the "chapters"/interactive-comic scroll mechanic — cannot map GSAP patterns to something not actually observed; flag for re-capture if this site's core interaction (not just its hero) is wanted as a reference.
- No custom illustration-authoring capability in our stack — this whole aesthetic depends on bespoke character art, which is a content/asset gap, not an animation gap.
- No blob/irregular-mask helper component in the pool — straightforward to hand-author with `clip-path` but there's no ready-made component for it.

## Don't borrow
- If the virtual-scroll/chapter mechanic is as heavy as this capture suggests, it risks trapping users on one screen with no visible progress — bad for a local-business site where the priority is getting to hours/address/booking fast, not exploring a story.
- The extremely playful, cartoon-mascot illustration style is a poor fit for most Patras beauty/wellness/taverna clients unless the business itself has a kids/family/playful brand identity — reserve this mood for a narrow subset of businesses, not as a default.
- A spinning "seal" badge claiming a specific accolade ("interactive comic") is content-specific bragging that would need a real, truthful equivalent (e.g. actual review count/rating) rather than being copied as a generic decorative device.
