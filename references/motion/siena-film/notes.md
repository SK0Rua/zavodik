# Siena Film Foundation

- **URL:** https://siena.film/
- **Captured:** 2026-08-18 (desktop 1440x900)
- **Mood:** dark cinematic editorial
- **Award:** Awwwards Site of the Month, Mar 2025, by Niccolò Miranda

## What makes the wow
- **Splash gate with a bold western/serif wordmark.** Before content, a full-black screen shows "SIENA / FILM FOUNDATION" in a heavy, slightly distressed western/blackletter-adjacent display face, with a small pill "ENTER" button below — the capture script clicked through this (see Don't borrow).
- **Film-still hero with warm cinematic grade.** The main hero is a large documentary photo (subject: an older woman with glasses, indoor lamp-lit setting) graded in a warm amber/red tone, with a soft vignette darkening the edges — reads like a genuine color-graded film still, not a raw photo.
- **Floating draggable video-preview card that changes hint copy.** A small rectangular video-player card floats over the lower-third of the hero and repositions/restyles between frames, cycling through different instructional hints layered on or near it: "hold and drag to navigate the timeline," "scroll to unlock the immersive film experience," "click explore to view detailed case studies" — this strongly suggests a single interactive preview element whose behavior/copy updates based on user action (drag, scroll, hover) rather than several separate elements.
- **Headline glitch/duplication effect.** In at least one sampled frame the "MY PROJECT X" headline is rendered doubled/offset (a ghosted duplicate slightly shifted from the main text), consistent with a brief glitch-style text effect — likely triggered by the floating card's proximity or a hover state rather than a constant effect.
- **Layered review/credibility stack pinned to hero.** A vertical stack of three 5-star ratings each paired with a short critical-acclaim quote ("A Fascinating Voyage", "A Film Based on a True Story", "Riveting Soundtrack") sits fixed at the right edge of the hero for the full capture — persistent social proof rather than a scroll-revealed section.
- **Project-switcher pill in the header.** A rounded card in the top-right (thumbnail + "MY PROJECT X" + category/year/runtime tags) reads as a dropdown/switcher for browsing between different documentary titles without leaving the hero.

## Timing & easing
Capture caveat below limits how much can be said about eased transitions since the observed footage stays almost entirely on this one hero screen; the gate-to-hero cut on "ENTER" reads as an immediate hard cut (no crossfade observed at the sampled frame density). The floating video-preview card's position/content changes appear gradual rather than instant — consistent with short (roughly 0.3-0.6s) eased transitions, but exact easing character can't be confirmed at this sampling rate.

## Typography
Heavy, slightly rough/etched western-style display face for the splash wordmark ("SIENA") — distinctive, not a generic grotesque. The in-page hero headline ("MY PROJECT X") uses a different, more standard bold condensed sans/slab in all caps. Body/meta text (director, year, category, star ratings, quotes) uses a small tracked-out uppercase label style throughout — consistent micro-typography treatment across metadata regardless of section. At least 2-3 distinct type styles: display wordmark face, condensed headline face, and a tracked uppercase utility face.

## Palette
Near-black background (#0d0908-ish) throughout; warm amber/burnt-orange film-grade overlay on the hero photo (#8a4326 to #d98a4f range); off-white/cream text and UI chrome (#f5ede1-ish) for labels, buttons, and the splash screen's alternate cream/film-strip background. A restrained, essentially monochrome-warm palette with no separate bright accent color — the warmth of the photo grade itself functions as the "accent."

## Layout rhythm & photo treatment
Hero is a large single full-bleed photographic panel occupying most of the viewport, with metadata anchored bottom-left (director/year/category as a compact label table) and the review stack anchored right — classic film-poster/streaming-service hero layout. The splash screen prior to it uses a cream background with subtle repeating vertical hairlines (film-strip/sprocket-texture reference) before cutting to pure black for the wordmark. Photography is warm-graded and vignetted consistently, giving it a unified "cinema" feel rather than raw/neutral photography.

## Mobile behaviour
Not captured — desktop only.

## Performance notes
Motion in the sampled frames is smooth with no visible jank; the floating video-preview card is the most complex element (looks like an actual embedded video thumbnail, not just a static image) but shows no stutter. The bulk of the 41.8s capture stays on this one hero screen — deeper page sections (if any) were not reached in this recording, so performance/behavior further down the page is unknown.

## Reproduce with our stack
- Splash/gate wordmark screen: plain Tailwind + a bold display Google Font substitute (note: our verified Greek-safe fonts don't include a western/blackletter option — see Gaps) with a `motion` fade/scale-in on mount, ~0.5s `ease-out`.
- Warm cinematic photo grade: CSS `filter` (`sepia`, `saturate`, `contrast`) or a pre-graded image export, plus a radial-gradient vignette overlay div — no animation library needed, purely a design/asset step.
- Floating video-preview card with cycling hints: a `motion`-animated draggable card (`drag` prop with constraints) positioned absolutely over the hero, with hint copy swapped via state on `dragStart`/`onScroll`/`onHoverStart` — buildable with `motion/react`'s drag gesture support directly, no pool component required.
- Headline glitch/duplicate effect: GSAP timeline toggling a duplicated, slightly-offset ghost text layer's opacity/x-position on a short trigger (hover or drag-start), 0.15-0.3s, feels snappy/linear rather than eased.
- Persistent review-quote stack: static Tailwind layout, `motion` staggered fade-in on mount (`staggerChildren: 0.15`) for the three quote blocks.
- Project-switcher header pill: plain Tailwind dropdown/card, no special animation needed beyond a simple `motion` height/opacity expand on open.

## Gaps
- No verified Greek-safe western/blackletter-style display font in our approved list (GFS Didot, EB Garamond, Manrope, Literata, Source Sans 3) to match the "SIENA" wordmark's rough distressed character — would need to substitute a bold serif (GFS Didot at large size) rather than attempt a literal match.
- No dedicated draggable-video-card/timeline-scrub helper in the pool — buildable directly with `motion`'s drag API but there's no pre-built component for this specific "floating scrubber" pattern.
- No text-glitch/duplicate-ghost effect component in the pool — straightforward as a small custom GSAP timeline, but not a drop-in.

## Don't borrow
- The mandatory splash "ENTER" gate before any content is visible — confirmed present in this capture (the recording literally starts on it) — adds unnecessary friction for a local-business visitor who wants hours/menu/booking fast, not a themed entrance ritual.
- Implied autoplay-adjacent video/sound context (a floating video-preview card with drag-to-scrub) is a heavier interaction pattern than a salon/taverna site needs; keep video usage passive (background loop, muted) rather than asking users to learn a custom scrub gesture.
- The review-quote stack borrows real critic language format ("Critical Acclaim") — for a local business this must be swapped for genuine sourced testimonials only (per project invariants: no fabricated reviews), never templated "critical acclaim" placeholder copy.
