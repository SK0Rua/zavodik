# Indigo — 5 tales of being

- **URL:** https://indigo-laboratory.it/
- **Captured:** 2026-08-18 (desktop, video downscaled to 1080×676; stills at 1440×900)
- **Mood:** dark, ritualistic, tactile, editorial-fashion
- **Award:** Awwwards Site of the Day + Developer Award, Jun 18 2026 (FPTP Studio)

## Capture caveats (read before trusting timings below)

The `desktop.webm` is 534s long, but the site itself is not — the capture tool
stalled for roughly 470 of those seconds on a single frozen frame (a portrait
photo mid-way down the "RHYTHM" tale) before releasing and rapid-scrolling
through the rest of the page in about 20 seconds. Because of this, precise
scroll-distance/second timings for anything past the opening gate are not
reliable from this capture — they're reconstructed from frame order and
relative spacing only. The opening flash + gate + hero sequence (first ~24s)
played back at normal speed and those timings are trustworthy.

## What makes the wow

- **Strobing wordmark preloader.** On load, roughly the first 1.5–2s cycles
  through the "INDIGO" wordmark at a fast flicker rate (looks like 6-10fps
  swaps): the word is oversized, cropped by the viewport, and split into
  overlapping "INDI"/"GO" halves that jump position each frame. Background
  and text colors alternate hard between black-bg/white-text,
  violet-bg/black-text, and violet-bg/grey-text. Reads as a glitch/strobe
  loading screen, not a smooth crossfade — each frame is a full hard cut.
- **Sound-gated entry screen.** After the flash, a full black gate holds: a
  heavily blurred, slow-motion close-up video of two hands (different people)
  reaching toward each other but not touching, centered behind the copy
  "Welcome to Indigo, a contemporary jewelry house. A journey through five
  tales, made to be heard." with an "ENTER THE EXPERIENCE" boxed button and a
  smaller "CONTINUE WITHOUT SOUND" text link below. The hands loop/drift
  slowly during this hold — feels like a blurred video plate, not WebGL
  particles (no depth distortion or parallax observed).
- **Gate-open sharpens the same shot.** Clicking through, the blurred hands
  video de-blurs into focus (still the same shot/composition, now crisp,
  showing rings and finger tattoos), a bold condensed white "INDIGO" wordmark
  locks centered at the top of the viewport, and a small "[•] Mute sound"
  toggle appears beneath it. This reads as a blur-to-sharp filter transition
  on the video layer rather than a video swap — same hand positions before
  and after.
- **Stacked tale index reveal.** Once the wordmark settles, a right-aligned
  "5 TALES OF BEING" label and a large stacked list — RHYTHM / PULSE /
  WHISPER / RESONANCE / SUB-NOISE — fades in over the hero, functioning as
  both a table of contents and the conceptual structure of the whole site
  (each word becomes a chapter later, with a persistent bottom nav bar
  showing the same five words with the active one inverted to a black pill).
- **Whip-cut into a title card.** The hero cuts (hard cut, not a
  scroll-scrub) to "INDIGO / THE INVISIBLE ECHO" — a section title in the
  same condensed display face over "Before the gesture, there is a sound." —
  paired with a small bordered thumbnail of a hand/arm, bento-card style.
- **Asymmetric bento photo grids per tale.** Inside each tale (RHYTHM, PULSE
  visible in this capture) the layout breaks into offset, differently-sized
  photo tiles — a tight hand/necklace crop next to a much larger body/collar
  shot, mixed aspect ratios, generous negative space — rather than a uniform
  grid. Pull-quote text ("I dwell in the freedom of movement...") sits in its
  own narrow column between image blocks.
- **Huge condensed display type for chapter/product titles.** "RHYTHM",
  "PULSE", product names ("SELENE RING", "MORPH RING") all render as
  full-width, ultra-bold, tightly-tracked condensed headlines — the same
  cropped/oversized treatment as the intro wordmark, now used as a recurring
  section-break device rather than a one-off intro gag.
- **Persistent bottom chapter nav.** A thin fixed bar at the very bottom of
  the viewport lists RHYTHM · PULSE · WHISPER · RESONANCE · SUB-NOISE at all
  times once inside the tales; the currently active chapter is shown as a
  solid black pill against the otherwise plain text list — a lightweight
  scroll-spy / progress indicator across the whole long-scroll page.
- **Horizontal product carousel ("THE COLLECTION").** A row of product
  thumbnails (rings, necklace) on white cards scrolls/scrubs horizontally
  within its own section, distinct from the vertical page scroll.

## Timing & easing

Only the pre-gate sequence timing is trustworthy from this capture:

- Flash/preloader: ~1.5–2s, hard-cut frame swaps at roughly 6-10 frames/sec —
  no easing, this is a strobe, not a tween.
- Gate hold (blurred hands + "ENTER THE EXPERIENCE"): holds indefinitely
  until user interaction — this is a real gate, not a timed auto-advance.
- Blur-to-sharp defocus resolve on the hands video after entry: reads as a
  filter blur (CSS/SVG `blur()` or similar) animating from a high radius to
  0 over roughly 1–2s, likely eased out (fast at first, settling slowly) —
  cannot confirm exact easing curve from frame sampling alone.
- Tale-index list fade-in: appears to cross-fade/slide in after the wordmark
  settles, sub-second, no scroll interaction needed at this point (autoplay
  choreography inside the still-locked hero).
- Everything past the gate (tale transitions, bento reveals, quote fades,
  product-card entrances) almost certainly runs on GSAP ScrollTrigger scrub
  given the tooling this studio class typically uses and the pinned-nav /
  chapter-index structure, but this capture cannot verify per-element
  trigger points, scrub ratios, or ease names — treat any such numbers as
  informed guesses, not observed fact.

## Typography

- One dominant display face: a bold, tightly-condensed grotesk/didone-ish
  face used for "INDIGO", tale titles ("RHYTHM", "PULSE"), and product names
  — very high x-height, near-zero tracking, almost brutalist. Distinctive
  letterforms visible: the "G" has a flat spur, the "I" is a plain stroke
  with no serifs.
- Body copy (gate welcome text, tale taglines, quotes, product story/crafting
  copy) is a small, clean, tightly-set sans-serif at a much smaller size —
  strong contrast in scale between display and body, no mid-size heading
  step visible.
- UI chrome (nav labels "THE MAKER" / "CONTACT", "[STORY]" / "[CRAFTING]"
  eyebrow labels, bottom chapter nav) is uppercase, letter-spaced, small —
  functions as a quiet structural layer under the loud display type.

## Palette

- Opening flash: pure black and a single saturated blue-violet (looks close
  to `#6633FF`/electric indigo — appropriate to the brand name), plus white
  and mid-grey wordmark fills alternating on it.
- Gate and hero: near-black background, warm-toned skin in the hands video,
  white/off-white type.
- Tale sections: shift to a warm cream/off-white background for text-heavy
  moments (index list, taglines) and pale blue-grey for the large portrait
  photography — a cool, desaturated, almost clinical backdrop that makes
  skin tones and jewelry the only warm/saturated elements on the page.
- Product pages (SELENE RING, MORPH RING) drop to full black backgrounds for
  dramatic single-product photography (dark rock/water texture, moody
  lighting).
- No other accent colors observed beyond the one indigo-violet, used
  sparingly and only in the opening moment.

## Layout rhythm & photo treatment

- Full-bleed, large-format portrait/editorial photography is the dominant
  visual unit throughout — a single face or body fills most/all of the
  viewport width in several sections, always against a plain, desaturated
  ground (pale blue-grey), never a busy backdrop.
- Bento-style asymmetric grids appear inside tale sections: one large photo
  paired with one or two much smaller cropped inserts (hand, ring detail,
  neck), offset rather than grid-aligned, with wide gutters/negative space.
- Section transitions are abrupt (hard content swaps between hero → title
  card → tale) rather than continuous scroll-morphs, at least at the
  granularity this capture can confirm.
- Product detail sections use a plain two-column layout: eyebrow-labelled
  [STORY] / [CRAFTING] text blocks side by side under a huge product-name
  headline, with a "REQUEST INFO" CTA — no add-to-cart/price shown, reads as
  an inquiry-based luxury flow, not e-commerce.
- A tick-mark ruler/ruled-line graphic appears near "THE SOUND WITHIN" —
  decorative, likely a waveform/measurement motif tying into the audio
  theme of the site (tale names like PULSE, WHISPER, RESONANCE, SUB-NOISE
  are all sound-adjacent words).

## Mobile behaviour

Not captured — desktop only.

## Performance notes

- The gate holds a video (or looping clip) at blur, then sharpens it in
  place — this is inherently GPU/compositing-heavy (a large blurred video
  layer, ideally on its own compositor layer) and would need care on
  mid-range hardware; for a local-business demo this exact effect is
  overkill and risks jank without a dedicated performance pass.
- Large full-bleed photography throughout means real image weight is high;
  the real site likely uses next-gen formats/responsive `srcset` — our
  static export needs the same discipline (AVIF/WebP, explicit sizes) or
  first paint will suffer.
- The strobing wordmark preloader is cheap (it's just text/color swaps) and
  safe to reproduce performance-wise.

## Reproduce with our stack

- **Strobing wordmark intro:** GSAP timeline with a `stagger`-free sequence
  of `.set()` calls (not tweens) swapping background/text color classes and
  wordmark position/scale every ~100-150ms for ~1.5s, then a final `.to()`
  settle. Cheap, no scroll dependency. Good candidate for a page-load
  timeline gated behind `useGSAP`.
- **Sound gate:** plain React state (`entered: boolean`) gating a full-screen
  overlay; "CONTINUE WITHOUT SOUND" just sets the same state without
  unmuting an `<audio>`/`<video>` element. No stack gap.
- **Blurred hands video, blur-to-sharp on entry:** an HTML5 `<video autoplay
  loop muted playsinline>` with a CSS `filter: blur(Npx)` animated via
  `motion/react`'s `animate()` (or a GSAP `.to()` on the filter value) from
  ~20px to 0 over ~1.2s, eased with something like `power2.out`. Fully
  reproducible; just needs a suitable stock/generated slow-motion clip
  (or fall back to a still image with a CSS blur transition if no motion
  footage is available — visually close enough at demo scale).
- **5 TALES OF BEING index + bottom chapter nav:** plain React component,
  fade/slide in with `motion/react`, active-chapter pill driven by a
  `ScrollTrigger`-based scroll-spy (`onEnter`/`onLeaveBack` toggling active
  class per section) — standard GSAP ScrollTrigger pattern, no pool
  component needed.
- **Condensed oversized display headlines:** pick the boldest/most condensed
  option from the approved Greek-safe set — Manrope ExtraBold at high
  negative letter-spacing gets closest available texture (GFS Didot/EB
  Garamond/Literata are all serif and wrong register; Source Sans 3 is too
  neutral). Flag: we cannot match the actual face's extreme condensed
  proportions — treat as a stylistic approximation, not a copy.
- **Asymmetric bento photo grids:** CSS grid with manually offset spans
  (not the `BentoGrid` pool component's uniform-cell logic, which assumes
  roughly equal tile sizes) — plain Tailwind grid utilities will match this
  better than forcing it through a pool component.
- **Horizontal product carousel:** `InfiniteMovingCards` or `Marquee` pool
  component if continuous looping is acceptable; if it should stop at the
  ends (more likely, since these are real product SKUs, not an infinite
  loop), a plain scroll-snap flex row is more honest and cheaper.
- **GSAP ScrollTrigger pin+scrub** is the reasonable default assumption for
  tale-to-tale transitions given studio conventions, but per the capture
  caveats above we did not observe actual scrub behavior — build the first
  pass with simple `scrollTrigger: { start, end, scrub: 1 }` reveals per
  section and adjust only if the client references specific scrub feel.
- **Cannot reproduce as observed:** the exact condensed/cropped display
  typeface (no Greek-safe equivalent in our set); true full-page-length
  (43000px) multi-tale architecture for a single local business (would be
  wildly disproportionate — see Gaps/Don't borrow).

## Gaps

- No Greek-safe font in our approved set matches the extreme condensed,
  high-contrast display face used for "INDIGO" and tale titles — biggest
  visual-identity gap versus the reference.
- We don't have footage of two hands reaching toward each other; would need
  to source or generate a substitute close-up (hands, jewelry, fabric) for
  any gate-style intro, and mark it `ai_generated` if generated per project
  invariants.
- No existing pool component cleanly does an asymmetric/offset bento grid
  (the pool's `BentoGrid` assumes fairly uniform cells) — would need hand
  -built CSS grid.
- We have no equivalent to the five-chapter "tale" content architecture;
  local-business demos are single-scroll one-pagers, so this entire
  navigation/index/chapter-nav pattern doesn't map without a much larger
  content set than any Patras salon/taverna client will supply.
- No verified scroll-scrub timing data from this capture (see caveats) —
  any ScrollTrigger values used will be estimates, not measurements.

## Don't borrow

- **The ENTER gate.** A mandatory click-through screen before showing any
  content is a luxury-brand trust play that a first-time local visitor
  (someone deciding whether to book a haircut or a table) will read as a
  wall, not a ritual. Costs a bounce for zero functional benefit on a
  business site.
- **The audio/sound offer.** "Mute sound" toggle and sound-gated entry only
  make sense when the site is scored with real audio design. A demo site
  for a Patras taverna has no audio content to gate — including this affordance
  with nothing behind it is worse than omitting it.
- **The extreme page length (43000px) / five-chapter structure.** This
  entire site is built as a five-part editorial narrative for a jewelry
  house with dozens of products and a brand story to tell. A local business
  demo has a handful of services/dishes and one location — stretching it
  across a comparable multi-thousand-pixel multi-chapter scroll would be
  padding, not craft, and would tank time-to-value for a visitor who just
  wants hours, address, and a phone number.
- **Full-black high-fashion product presentation** (SELENE RING/MORPH RING
  style dark, moody single-product pages) reads luxury-jewelry, not
  neighborhood-salon-or-taverna; the palette and staging need to warm up
  and simplify for our target businesses.
- The iubenda cookie-consent panel visible in most frames is a capture
  artifact from the live site's own consent-management tooling, not a
  design element — ignore it entirely; it does not represent a pattern to
  reproduce or reference.
