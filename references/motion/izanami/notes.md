# Izanami — wellness/retreat/architecture brand, Dubai and Tokyo

- **URL:** https://izanami-official.com/
- **Captured:** 2026-08-18 (desktop 1440x900)
- **Mood:** restrained, meditative, slow-burn luxury
- **Award:** Awwwards SOTD Jul 18 2026, by baqemono.inc

## What makes the wow
- Hero is a single dark misty forest photograph (fog rolling over pine silhouettes) held for roughly the first third of the capture with an extremely slow, barely-perceptible zoom/parallax — comparing frames 6-9s apart shows only a marginal scale/position shift, easily mistaken for a static image at a glance. This "almost nothing happening" pacing is itself the wow: the page trusts the viewer to slow down.
- Preloader is a long (~8-9s) hold on near-black before the forest image fades up from black — no visible percentage counter or progress bar in the sampled frames (unlike lama-lama/serotoninn's percentage-tick preloaders), just a patient fade-from-black. A tiny serif line "Remember who you are" fades in early and stays fixed over the fog for the entire hero duration.
- Small stacked-line logomark (a woven/grille-pattern square icon, "IZANAMI" wordmark beneath) sits top-left throughout; a "MENU" label and EN/JA language toggle sit top-right — minimal chrome, generous negative space, nothing competes with the photography.
- Location/timezone readout in the footer bar reads like a live clock: "02 00 16 GST, DUBAI UAE" / "07 00 16 JST, TOKYO JPN" plus a copyright year — small monospace-style numerals that suggest a ticking live-time widget, reinforcing the two-office, always-on brand story without any loud UI.
- Scroll reveals a "Sharing the japanese spirit" section built as an asymmetric photo collage — a tall narrow strip (dripping water/ripple close-up) overlapping a wider zen-garden raked-gravel photo, staggered at different heights, with body copy overlapid semi-transparently on the architecture photo behind it. This is the most visually complex moment in an otherwise minimal site.
- Three "Projects" cards (School / Craft / Retreat) each pair a full-bleed dim architectural interior photo (glass-walled minimalist pavilion, tatami room) with a small serif heading, one-line strapline ("Nurturing the foundations of life." / "Awakening the senses through Japanese aesthetics." / "Returning to your essence."), short paragraph, and a "— View [X]" text link with a hairline rule — identical card template repeated three times, each swapping in a different photo and copy, numbered 01/02/03 in a vertical side label.

## Timing & easing
Everything is slow: the hero zoom is imperceptible frame-to-frame at 1fps sampling, suggesting a multi-second-per-percent Ken Burns drift (likely 20-40s for a very small scale change, e.g. 1.0 to 1.05). The preloader fade-from-black is a long, slow linear-or-eased opacity ramp with no discrete step visible. Section-to-section transitions read as simple scroll-triggered fades/slides rather than pinned scrub sequences — no evidence of ScrollTrigger pinning holding a section in place while content changes underneath, unlike the other two references. Overall pacing is 2-3x slower than typical "energetic" award-site pacing.

## Typography
Small, restrained serif for headline/section titles ("Remember who you are", "Philosophy", "School"/"Craft"/"Retreat") — thin weight, generous letter-spacing, cream/off-white on dark backgrounds. Body copy and nav/UI labels use a light-weight sans in small caps or all-caps tracking (HOME, PHILOSOPHY, PROJECTS, COMPANY, CONTACT in the footer nav). The serif carries all emotional/brand weight; the sans is purely utilitarian.

## Palette
- Fog/forest hero: desaturated blue-grey-green `~#75847`5 (light fog) to near-black `~#2A3936` (tree shadow)
- Section backgrounds: near-black `~#0E0E0E` to very dark warm brown-black `~#1a1512` (Company/Philosophy sections)
- Text: warm off-white/cream `~#D1D6D0`, no pure white used
- Accent count: 0 — no brand color beyond the tonal range of the photography itself; the palette is monochrome-adjacent throughout (fog greys, forest greens, near-black), with only the natural warm tones of the architectural/interior photos providing any color variation (wood tones, tatami beige).

## Layout rhythm & photo treatment
Long-form vertical scroll with generous whitespace/black-space between sections — Philosophy (text-only statement on black) → Projects intro → three repeating project cards (photo + short copy + link) → Company (centered logomark + statement) → footer (Philosophy repeated as a section heading + full nav/location grid). Photography is architectural/interior and landscape only — glass pavilions, tatami rooms, misty forest — no people shown in the sampled frames except a small hand/skin-tone detail thumbnail in the School card. Every photo is full-bleed within its section, dim/moody grading, never bright or high-key.

## Mobile behaviour
Not captured — desktop only.

## Performance notes
Desktop capture is 693KB, the smallest of the three references, consistent with a page built from static photography plus slow CSS/GSAP transforms rather than video loops — the slow-zoom hero is very likely a single large JPG/WebP with a CSS `transform: scale()` animation, not a video, which is cheap and safe to reproduce.

## Reproduce with our stack
- Slow Ken Burns hero zoom: GSAP `gsap.to(heroImg, { scale: 1.06, duration: 30, ease: "none" })` on page load, or a plain CSS `@keyframes` transform — no ScrollTrigger needed since it runs on a timer, not on scroll.
- Long fade-from-black preloader: `motion/react` `AnimatePresence` with a single black overlay div fading `opacity: 1 → 0` over ~2-3s (compress the observed ~8s for web patience reasons), gated on hero image `onLoad`.
- Fixed tagline over hero ("Remember who you are"): plain absolutely-positioned text with a `motion` fade-in, `duration: 1.5, delay: 0.5`.
- Repeating Project card template (photo + eyebrow number + serif heading + strapline + paragraph + "View" link): build once as a Tailwind component, drive entrance with GSAP `ScrollTrigger` `{ trigger: card, start: "top 80%" }` triggering a simple `fromTo(opacity 0→1, y 24→0)`, `duration: 0.8, ease: "power2.out"` — no scrub, no pin, just a threshold reveal, three times.
- Asymmetric "Sharing the japanese spirit" collage: CSS Grid with manually staggered `translateY` offsets per image (achievable with plain Tailwind + inline style, no library needed) — the overlap/stagger reads as static layout, not scroll-scrubbed motion in sampled frames.
- Live timezone readout: `NumberTicker`-adjacent — actually simplest as plain JS `setInterval` updating a `<span>` with `Intl.DateTimeFormat` per timezone, no pool component needed.

## Gaps
- No dedicated slow-zoom Ken Burns helper in the pool — trivial to add as a shared utility (one GSAP tween, reusable across any hero photo) and worth doing given how often "quiet luxury" briefs will want it.
- No asymmetric photo-collage/masonry-with-manual-offset component — straightforward with Tailwind grid + custom offsets per project, does not need a pool component.
- Nothing in our stack currently does the "long, patient fade from near-total black" preloader feel at this pacing — easy to build but currently no shared preloader wrapper exists; worth extracting one since two of the three refs use a preloader.

## Don't borrow
- The ~8-9s black hold before content appears is too slow for a local-business demo that needs to prove value fast to a skeptical owner — compress any Izanami-style fade-in to 1-2s max.
- Near-total absence of concrete business information (no address, no hours, no services list, no prices) above the fold suits a luxury retreat teaser but would read as evasive or unfinished for a Patras salon/taverna where visitors want practical info quickly.
- Two-office/international framing (Dubai + Tokyo timezone readout) is scale-signaling that would look absurd or dishonest applied to a single-location neighborhood business.
