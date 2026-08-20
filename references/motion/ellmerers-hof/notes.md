# Ellmerer's Hof

- **URL:** https://ellmerers-hof.com/
- **Captured:** 2026-08-18 (desktop 1440x900, mobile 390x844)
- **Mood:** warm handcrafted countryside

- **Award:** Awwwards Honorable Mention (by LABWORK Studio)

## What makes the wow
- Hero loads as a hand-drawn watercolor-style illustration of the actual farmhouse, staged as a genuine reveal sequence, not a static image: the wordmark logo appears first in flat grayscale on a plain grey background, then individual illustrated elements (alpaca, grazing horse, archery target) pop in one at a time around the wordmark in a short stagger, still fully desaturated — then the whole scene switches to full color and the farmhouse building illustration itself appears, background going white, over roughly 2-3 seconds total.
- Illustration style carries through the whole site (line-drawn, watercolor-washed buildings/animals) rather than photography for the hero and section dividers — a distinctive, illustration-led brand identity rarely seen in the other three references.
- A circular "Alle Produkte" / "Alle Leistungen" badge (dark solid circle, handwritten-script white label) sits as a persistent floating call-to-action pinned in the same screen position across multiple sections — reads as a sticky/pinned element rather than scrolling with content.
- Services section opens with a single small orange dot appearing above the handwritten-script heading "Unsere Leistungen" before the section's photo/illustration content resolves — a tiny deliberate "beat" before the section reveals.
- Warm documentary photography of the real owners (posed, smiling, arm around each other on a fence) is dropped in between illustrated sections — a hard tonal contrast (real photo vs. hand-drawn) used intentionally to build trust/authenticity.
- The recording's final frames return to the hero illustration (building + alpaca + archery target + "Bogenparcours" tagline), suggesting either a looping capture or an anchor-link "back to top" — a clean visual bookend.

## Timing & easing
- Grayscale logo → staggered element pop-in → full-color reveal: total sequence spans roughly 2-3s from first content frame; individual illustrated elements (alpaca, horse, target) appear to pop in with a short stagger of a few hundred ms each, ease-out, no visible overshoot/bounce.
- Section content (services cards, photo blocks) reads as fade/slide-up on scroll-into-view, moderate speed, not scrubbed — consistent triggered-and-plays pattern like Floema.
- The single orange dot beat before "Unsere Leistungen" suggests a short (roughly 0.3-0.5s) delay/hold before the heading and dot both settle — a small choreographed pause rather than everything firing at once.
- Overall pacing is warm and unhurried but not slow — shorter holds than Alethia, snappier than Mont-fort.

## Typography
- Wordmark and section headers use a bold, slightly uneven hand-lettered/marker-style display face (all-caps, thick outlined strokes) for "ELLMERER'S HOF" — clearly custom or a distinctive display font, not a standard system face.
- Taglines and secondary headings ("Das Glück an der Leine", "Bogenparcours", "Echte Schätze", "Partner", "Wir") use a loose cursive/handwritten script face — a second, contrasting hand-style face paired with the marker-style wordmark.
- Body copy (services descriptions) uses a plain, legible sans-serif at conservative size — the two decorative faces are reserved for headings/wordmark only, body stays neutral for readability.
- Overall: 3 type roles — marker/display caps (wordmark), handwritten script (taglines/section titles), plain sans (body) — an unusually high but well-controlled type-personality count for a small-business site.

## Palette
- Base background shifts between light grey (~#c9c9c9-ish during the grayscale intro) and white/off-white (~#fcfcfc) once color resolves.
- Warm terracotta/roof-brown and grass green dominate the illustration itself (natural, muted, watercolor-desaturated rather than saturated).
- Mobile-only peachy-orange rounded "blob" background (~coral/salmon, roughly #f2846b-#f5a382 range) used behind one hero-carousel screen — the boldest color moment on the whole site.
- Dark charcoal/near-black footer band with cream text.
- Overall a muted, natural palette (browns, greens, cream) punctuated by one bright coral accent on mobile — no single dominant brand accent color the way Alethia/Floema have one.

## Layout rhythm & photo treatment
- Hero illustration sits centered on generous white negative space — not full-bleed, deliberately "framed" like a piece of art rather than an edge-to-edge photo hero.
- Sections alternate between illustration-only, photo-only (owner portrait), and mixed panels — no strict repeating grid, feels handcrafted/varied rather than systematized.
- Real photography (the owners, presumably farm/product shots) is warm, natural-light, unfiltered/documentary — contrasts deliberately with the stylized illustration to signal "this is a real family business."
- Footer is a dark, dense band with service description text, "Partner" logos/list, and contact info stacked tightly — denser than the airy hero.

## Mobile behaviour
- Same grayscale-logo-to-color hero reveal sequence occurs on mobile, confirmed in the mobile capture.
- Mobile hero includes a "1/2/3" numeric indicator beneath the tagline, implying a swipeable/auto-advancing hero carousel with multiple screens (building illustration → alpaca herd photo-illustration hybrid with coral blob background → services teaser) — not present in the desktop capture in this form.
- The coral/peach organic blob shape is a mobile-specific background treatment behind the second hero screen ("Alpaka-Wanderung"), not seen on desktop.
- "Alle Leistungen" circular badge persists on mobile in the same pinned/floating manner as desktop's "Alle Produkte".
- Footer content reflows to single-column stacked text with generous vertical spacing, ending on a large handwritten "Wir" (We) as a section-opener for what is presumably an about/team section further down.

## Performance notes
- Recording is smooth throughout, including the grayscale-to-color reveal — no visible stutter or asset pop-in beyond the intentional staged reveal.
- A GDPR cookie banner (Ablehnen/Akzeptieren) is visible layered over the hero in several frames — real browser chrome, not part of the design language.
- No evidence of WebGL; entire site reads as SVG/PNG illustration assets plus photography, composited with straightforward CSS/DOM animation — very achievable with the target stack.

## Reproduce with our stack
- Grayscale-to-color staged hero reveal: layer the illustration as SVG or PNG groups (wordmark, building, alpaca, horse, target as separate image elements); apply `filter: grayscale(1)` to a wrapper and animate individual elements' `opacity`/`y` in with a GSAP timeline stagger (~0.2-0.3s per element), then cross-fade/transition the wrapper's `grayscale` filter to `0` and swap in the full-color background — a filter interpolation via GSAP `filter` tween or a simple two-image cross-fade (grayscale PNG → color PNG) if filter animation proves unreliable cross-browser.
- Persistent circular CTA badge: `position: sticky` or `fixed` div with `HoverBorderGradient` or plain CSS circle + `motion` idle micro-bounce, handwritten label via a script Google Font (note: Fraunces/Cormorant are NOT Greek-safe per project constraints — for a Greek-market clone use EB Garamond or Literata italic as the "handwritten" stand-in, not a true script face, since verified Greek-subset script fonts are not in the safe list).
- Orange-dot beat before section heading: simple `motion` sequence — dot scales/fades in first (`delay: 0`), heading follows (`delay: 0.3`), both via a shared timeline or `motion` `variants` with staggerChildren.
- Mobile hero carousel with "1/2/3" indicator: basic controlled carousel (state + index), auto-advance via `setInterval` or GSAP-driven, dot/number indicator as plain styled buttons — no pool component strictly needed, though `AnimatedTestimonials` (pool) has similar carousel plumbing that could be adapted.
- Mobile organic blob background: CSS `border-radius` blob (large asymmetric radius values, e.g. `border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%`) or an SVG blob shape as a background layer behind the coral section — plain CSS/SVG, no library needed.
- Warm documentary photo blocks alongside illustration: standard `next/image` with a subtle warm color-grade via CSS `filter: sepia(0.05) saturate(1.05)` if needed to match tone.

## Gaps
- No existing grayscale-filter-interpolation helper in the template; straightforward to add as a small GSAP utility but not currently packaged.
- No illustration asset pipeline — this reference's biggest visual asset (the hand-drawn farmhouse/animal illustrations) would need to be commissioned/generated per business (gen-image skill) since local Patras businesses won't have existing watercolor illustrations; budget for that as a real content gap, not just a code gap.
- No documented organic-blob-background utility, though trivial to hand-roll with CSS border-radius or an inline SVG path.
- Greek-market constraint: this reference's two decorative type roles (marker display + handwritten script) both lean on font styles that are flagged unsafe or unverified for Greek glyph coverage (script/hand faces generally have poor Greek support) — would need to verify or substitute with one of the five confirmed-safe families for any Greek-language clone, likely losing some of the handcrafted charm.

## Don't borrow
- Full custom watercolor illustration set as the primary hero asset is expensive/slow to produce per business and won't scale across many Patras demo sites on a template budget — reserve hand-illustration treatment for a hero business willing to pay for it, default to photography for the rest.
- The grayscale-to-color reveal, while charming, adds a genuine multi-second delay before the real hero is visible — trim to well under 1s for a conversion-focused local landing page, or make it optional/skippable.
- Persistent floating circular CTA badge risks covering content or feeling gimmicky at small local-business scale (fewer products/services than a farm-with-many-activities); use a conventional sticky header CTA button instead unless the business genuinely has a browsable catalog.
