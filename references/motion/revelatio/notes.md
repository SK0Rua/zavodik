# Revelatio Studio

- **URL:** https://revelatio.studio/
- **Captured:** 2026-08-18 (desktop 1440x900)
- **Mood:** dark technical editorial, glitchy grotesque
- **Award:** Awwwards Site of the Day, Aug 12 2026

## What makes the wow
- **ASCII/character-grid hero image on load.** The hero photo (a group of people) is rendered entirely as a dense grid of small monospace glyphs/characters shaded to approximate the photo's luminance, warped into a barrel/CRT-curved rectangle (top and bottom edges bow outward). This is a full custom image filter, not a plain `<img>`.
- **Scramble-text intro before settling.** In the first couple of seconds the hero headline briefly renders as scrambled/garbled ASCII characters ("Bra%$&=+= Pr=@?# De@^+^ = C@!%% O=? int@%%^?&& vi*++?") before resolving letter-by-letter into the real copy "Branding, Product Design & Code. One integrated vision." — a classic scramble/decrypt text-reveal effect, timed over roughly 1-2s.
- **Same ASCII-glyph treatment reused as the footer wordmark.** The footer repeats the identical character-grid technique at huge scale to spell out "revelatio studio" as an outline/dot-matrix wordmark spanning the full viewport width, on black — with a "Click to interact" hint suggesting the character field responds to cursor movement (a mouse-reactive particle/glyph field).
- **NumberTicker-style stat counters mid-page.** A results section shows large counters (e.g. "0+") that animate upward, paired with a row of client logo cards each showing a metric ("+250%", "+2", "+3,000", "+1,400...") — reads as a staggered count-up triggered on scroll into view.
- **Watermark city-list behind a giant headline.** A section headline ("Waterloo,") sits in bold black type directly over a second line of many city names ("New York, Boca Raton, Atlanta, Los Angeles, London, Porto, Munich, San Sebastian, Tel Aviv, Dubai, Recife, Natal...") rendered in very light grey as a background texture layer — a large-type-over-faint-list layering trick.
- **Sticky/pinned "Site of the Day" ribbon badge.** A red ribbon-style badge sits fixed to the right edge of the viewport across the whole capture, unaffected by scroll — a persistent social-proof element.

## Timing & easing
The scramble-to-real-text reveal on the hero runs roughly 1-1.5s, feels like a fast randomized-character swap easing into the final glyphs (classic scrambled-text/decrypt tween, not a simple fade). The ASCII hero image itself doesn't appear to animate once resolved — it's a static rendered texture. The counter/stat section reads as scroll-triggered (numbers and cards only appear once that section is in view), count-up duration feels short, under 1s, snapping to final value rather than a long ease. No obvious scroll-scrub/pinning was observed in the captured frames — sections appear to be normal reveal-on-scroll rather than pinned scrollytelling.

## Typography
Large, bold, tightly-tracked grotesque sans for headlines ("Branding, Product Design & Code.", "Waterloo,") — big, confident, all lowercase-friendly geometric sans in the footer wordmark. Body/nav uses a smaller weight of the same or a very similar grotesque. No serif observed. Overall 2-3 weights of one grotesque family, generous size jump between nav-scale and hero-scale type (roughly 8-10x).

## Palette
Near-black background (#0a0a0a to true black) dominates the hero and footer; a bright white/off-white section in the middle (service list, "Waterloo" section) flips to a light background with black text; one accent red (#e8432a-ish) on the "Site of the Day" ribbon badge and CTA-adjacent elements. Essentially a two-tone black/white site with a single red accent — very restrained.

## Layout rhythm & photo treatment
Hero is a large centered image block (roughly 60% viewport width, floating in negative space) above a two-line headline anchored bottom-left — asymmetric, generous top/bottom padding. The ASCII-grid treatment is the primary "photo treatment" on this site: real photography is deliberately obscured/abstracted into a texture rather than shown crisply, which doubles as a loading-mask device. The stat/results section uses a tight grid of small square client-logo cards. Section heights vary — hero feels close to a full viewport, the services/headline section reads shorter and denser.

## Mobile behaviour
Not captured — desktop only.

## Performance notes
Everything in the capture plays smoothly with no visible pop-in or jank; the ASCII/glyph rendering appears to be a pre-baked canvas/WebGL texture rather than live DOM text (too dense and evenly shaded for individual DOM nodes), so it likely costs a GPU/canvas draw on load but doesn't show stutter in this recording.

## Reproduce with our stack
- ASCII/character-grid image filter: **not directly available in our pool** — would need a custom canvas routine (sample image pixels to a grid, map luminance to a glyph/character set, draw to `<canvas>`). Flag as a build-from-scratch item if wanted; otherwise substitute with a `GridPattern`/`DotPattern` overlay on top of a normal photo for a cheaper approximation of the "textured photo" mood.
- Scramble-text reveal: GSAP `ScrambleText` plugin (part of the GSAP 3.15 bundle listed in our stack) driving the hero headline on load — swap in random characters then resolve to final text over ~1-1.2s, `ease: "none"` with GSAP's built-in scramble easing.
- Footer giant wordmark: reuse the same canvas/ASCII technique if built, or fall back to a large `TextAnimate`/`AnimatedShinyText` pool component for a cheaper "big outline word" footer without the glyph-grid texture.
- NumberTicker stat counters: use the `NumberTicker` pool component directly, wrapped in a GSAP ScrollTrigger (or the component's own IntersectionObserver) to fire on scroll-into-view.
- Watermark city-list behind headline: two stacked absolutely-positioned text layers in plain Tailwind — headline `text-gray-950` z-10, list `text-gray-200` z-0 — no animation library needed.
- Sticky ribbon badge: `position: fixed` with a small `motion` slide-in on load; simple CSS, no pool component required.

## Gaps
- No ASCII/dot-matrix image-filter helper in our current template — this is the single most load-bearing visual device on the site and would need custom canvas code (see above) or a scoped-down substitute.
- No mouse-reactive particle/glyph field for the "Click to interact" footer hint — would need a small custom canvas+pointermove handler; not present in the pool.

## Don't borrow
- The glyph-grid technique risks being illegible or feeling like noise for Greek text (character sets differ, and a beauty-salon or taverna client wants clear, warm photography, not obscured/abstracted imagery) — use it sparingly if at all, and never on the hero photo of the actual business.
- The very high type-scale contrast (huge headline vs. tiny nav) and heavy black backgrounds read as agency-cool but can feel cold/inaccessible for a warm local-business brand; dial back contrast and warm up the palette.
