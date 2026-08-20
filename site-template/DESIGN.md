# DESIGN.md — rules for the builder agent

You are building a **private demo site** for a real local business. It will be shown to the
owner, who knows their own business better than you do. Every invented fact is a credibility
hole; every generic layout is a reason to ignore the demo.

Read this file, then `components/README.md`, then `../references/motion/README.md` (mood and
motion) and `../references/beauty/README.md` (layout craft).

---

## 1. Facts come only from the snapshot

`input/snapshot.json` is the **only** source of truth for anything a reader could take as a
claim about this business. Not your knowledge, not plausible inference, not what similar
salons usually offer.

Never write, unless the snapshot contains it:

- services, treatments, prices, durations, packages
- reviews, ratings, review counts, testimonials, client names
- phone, email, address, opening hours, booking links, social handles
- years in business, "since 2011", staff count, awards, certifications
- claims like "award-winning", "the best in Patras", "trusted by hundreds"

**If a fact is missing, the section goes away.** A short honest page beats a long invented one.
No reviews in the snapshot means no reviews section — not a placeholder review, not a made-up
one, not lorem ipsum dressed as a quote. Do not use `NumberTicker` for a number the snapshot
does not prove.

Copy language is `snapshot.language`. All visible text, including microcopy and alt text.

The primary CTA uses the real contact channel from the snapshot. If there is no booking URL,
the CTA is the real phone number, not a dead `#` link or a fake booking form.

## 2. Images

- Only files under `public/assets/`, referenced as `/assets/<file>`. Nothing hotlinked,
  no Unsplash, no placeholder services, no `via.placeholder.com`.
- **Real business photos may only illustrate real claims.** A photo of this salon's interior
  can be the hero. A stock or AI image may never be presented as this business's work,
  premises, staff, or clients.
- AI-generated imagery is decorative only — texture, pattern, atmospheric background, og-image —
  and is marked `ai_generated` in the asset record. If a section needs a photo of the work and
  none exists, restructure the section around type instead of filling it with a fake.
- Every `<img>` needs meaningful `alt` in the site language. Purely decorative images get `alt=""`.
- Set explicit `width`/`height` (or an aspect-ratio box) so the page does not shift while loading.

## 2b. The logo — the one thing you must not design

`input/snapshot.json` has a `brand.logo` section. Read it before you lay out the header.

**When `brand.logo` is present** it names a real file the business actually uses — mined from
their own site's header, their `link rel=icon`, their schema.org `Organization.logo`, or their
verified social avatar, and picked by a scorer that rejects the supplier brands a salon merely
stocks (a real page had L'Oréal, Wella and Farcom sitting in its markup looking exactly like
a logo).

- Use that file **verbatim** in the header and the footer. Reference it as `/assets/<file>`.
- **Never** redraw it, trace it, re-set it in a typeface, recolour it, add a gradient or shadow
  to it, wrap it in a badge/circle/square it did not come with, or "clean it up".
- `vector: true` means SVG — scale it freely. `vector: false` gives you `width`/`height`: that
  is its 1x size and enlarging past it will visibly blur.
- Give it `object-fit: contain` in a fixed box (28–48px tall in a header is normal) and
  `alt` = the business name.
- A dark mark on a dark section goes on its own light surface. Do **not** invert it, and do not
  apply `filter: brightness(0) invert(1)` — that destroys a multi-colour mark.

**When `brand.logo` is `null`** the business publishes no mark we could verify. Set their **name**
as a wordmark: this is a real, respectable identity choice and it is what your typography pair is
for — tracking, weight, an optional rule or a single letter accent. **Do not invent an emblem,
monogram, crest, or icon for them.** A fabricated logo is a fabricated fact, and the owner will
know instantly that it is not theirs.

Either way, the palette comes from `brand.primary` / `brand.accent`, which were measured from
this business's own logo, avatar, stylesheet or photographs — not from the motion reference,
which contributes mechanics only.

## 3. The anti-slop ban-list

These are the tells that mark a page as machine-made. They are QA failures (SPEC §2.4).

**Typography**
- Default Inter, Poppins, Montserrat, Roboto, Open Sans as the display face.
- One font at one size doing every job. Premium pages use extreme *size* contrast, few styles.
- Headline and body in the same family at the same weight.

**Colour**
- Purple/violet→blue gradients. The single strongest slop signal.
- Gradient text on a headline "because it looks modern".
- Three or more accent colours. **One accent, maximum.**
- Neon-on-near-black "AI startup" palette on a beauty business.

**Layout**
- A row of three identical cards with identical icons and identical text lengths.
- Emoji as bullets or as section icons. Emoji anywhere in body copy.
- Every section the same full-width band with a centred title and centred paragraph.
- A generic hero: centred H1, centred subtitle, two buttons side by side.
- Icon grids where each icon is a different unrelated pictogram.

**Copy**
- "Elevate", "Unlock", "Seamless", "Transform your look", "Where beauty meets X",
  "Your journey starts here", "We don't just cut hair — we craft confidence."
- Em-dash-heavy marketing rhythm and rule-of-three triplets in every heading.
- Any sentence that would read identically for any other salon in the world.

**Motion**
- Everything animating on entrance at once.
- Autoplaying carousels, bouncing arrows, spinning badges, pulsing CTAs.
- Parallax so aggressive the text is unreadable mid-scroll.

## 4. What to do instead

Work from `../references/<niche>/README.md`. Pick **one** reference whose character fits the
business and borrow its concrete mechanics — do not average all of them, which produces exactly
the generic result you are trying to avoid.

The recurring premium patterns, all cheap to implement:

- **Photography is the hero.** Full-bleed real photo, not a gradient panel.
- **Extreme type-size contrast.** Display face at `clamp(2.5rem, 8vw, 7rem)` against 14-15px
  letterspaced sans. Two families, three or four sizes on the entire page.
- **Uppercase letterspaced micro-labels** (~11-13px, `0.15em`-`0.2em` tracking) for nav,
  section labels and captions. This single detail separates premium from template.
- **Whitespace that feels excessive.** Leave the top third of the hero empty if the photo earns it.
- **One accent colour, appearing once or twice.**
- **Asymmetry.** Offset grids, a 60/40 split, one item spanning two columns.
- **Booking as one quiet persistent link**, not a fat pill repeated six times.

Vary section rhythm deliberately: a tall hero, then a tight dense band, then a wide breathing
section. Equal-height sections in sequence are what makes a page feel machine-generated.

## 5. Typography setup

Fonts load through `next/font/google` in `app/layout.tsx` — this self-hosts the files at build
time, which is what keeps `output: 'export'` working with no runtime CDN call. Never add a
`<link>` to fonts.googleapis.com; it breaks the offline build and leaks a request.

The default pair is **Fraunces** (display, optical-size axis, editorial) + **Outfit** (body).
Change it to suit the art direction — that is expected — but:

- keep the CSS variable names `--font-display` / `--font-body`; globals.css and the components
  reference them;
- keep `display: 'swap'`;
- include `latin-ext` in `subsets` for Polish/Czech/Turkish business names.

### Greek sites: check the subset before you pick the font

**A font that lacks the subset you request is a hard build failure**, not a silent fallback:

```
`next/font` error: Unknown subset `greek` for font `Fraunces`.
```

**The default Fraunces/Outfit pair does NOT support Greek.** Neither do Cormorant Garamond,
Instrument Serif, Marcellus, Jost or Outfit. If `snapshot.language` is Greek you must swap
both fonts, or Greek text falls back to a system face and the design collapses.

Verified Greek-capable pairings (each builds clean):

| Display | Body | Character |
|---|---|---|
| **GFS Didot** | **Manrope** | Greek-designed Didone; editorial and genuinely distinctive. Strong default for Greek. |
| **EB Garamond** | **Manrope** | Classical, warm, high-legibility. |
| **Literata** | **Source Sans 3** | Contemporary editorial serif. |
| **Noto Serif Display** | **IBM Plex Sans** | Neutral but well-drawn. |
| **Alegreya** | **Inter Tight** | Calligraphic, humanist. |

Note `GFS_Didot` is single-weight — pass `weight: '400'` and get contrast from *size*, not weight.
Underscores replace spaces in the import name (`GFS_Didot`, `Source_Sans_3`).

For Latin-script sites, good non-default pairings: Fraunces/Outfit, Instrument Serif/Geist,
Bodoni Moda/Inter Tight, Cormorant Garamond/Jost, Playfair Display/Karla, DM Serif Display/Manrope.

If unsure whether a font supports a subset, just run `pnpm build` — the error names the problem
exactly, and it is cheaper than guessing.

## 6. Motion rules

Motion should reveal content, not decorate the page. If an animation would not be missed, cut it.

- **`BlurFade`** for section entrances — the default workhorse.
- **GSAP + ScrollTrigger** (via `@/lib/gsap`) for scroll-linked work: masked headline reveals,
  pinned sections, image parallax. The official GSAP skills are installed — consult
  `gsap-core`, `gsap-scrolltrigger`, `gsap-react`, `gsap-timeline`, `gsap-performance`.
- **Lenis** smooth scroll is already wired in `app/layout.tsx` via `<SmoothScroll>`, and is
  synced to the GSAP ticker. Do not add a second smooth-scroll library, and do not set
  `scroll-behavior: smooth` in CSS — it fights Lenis.
- Animate `transform` and `opacity` only. Animating `width`, `height`, `top` or `left` causes
  layout thrash on mid-range phones.
- Stagger between 0.06s and 0.12s. Durations 0.4s-1.2s. Slower reads as broken.

### Reduced motion is non-negotiable

`prefers-reduced-motion: reduce` must produce a **complete, readable, fully visible** page.

- CSS side: handled in `app/globals.css` — transitions collapse and every infinite decorative
  loop is switched off.
- GSAP side: wrap animations in `motionSafe()` from `@/lib/gsap` (it wraps `gsap.matchMedia()`,
  so the animation simply never runs and reverts cleanly on unmount).
- Motion/React side: `useReducedMotion()` from `@/lib/use-reduced-motion`.

**The trap:** never leave content at `opacity: 0` waiting for an animation that reduced motion
cancelled. Use it to decide whether to *animate*, never whether to *render*. Verify by loading
the page with reduced motion on — every heading and paragraph must be visible.

## 6b. The motion pack

`components/motion/` is ten hand-built components implementing the mechanics that make the
sites in `../references/motion/` feel premium. It is separate from `components/ui/` (the
vendored Aceternity/MagicUI pool) because these are ours, they are the ones that carry the
"wow", and they have rules of their own.

```tsx
import { VideoHero, SplitHeadline, MaskWipe, SpecTags } from '@/components/motion';
```

Full props are in `components/README.md`.

### The 3-4 mechanics rule

**Pick a maximum of four motion mechanics for a page, and one of them is the hero.** Every
reference in the pack lists five or six; taking all of them produces a showreel, not a
business page. The starter `app/page.tsx` deliberately breaks this rule — it is a build
harness that has to exercise everything. Your page is not.

A workable shape: one hero mechanic (`VideoHero` or `KenBurnsImage`), one scroll mechanic
(`MaskWipe`, `SplitScreenWipe` or `HorizontalRail`), one type mechanic (`SplitHeadline`), and
`SpecTags` carrying the facts. That is already four.

### Reference mood → components

Pick ONE reference from `../references/motion/README.md` — do not average several, which is
itself a reliable route to generic output — then borrow its mechanics.

| Reference | Business shape | Reach for | Grade |
|---|---|---|---|
| **vero-studio** — warm editorial amber | Hair salon, bridal, beauty studio. Best all-round match. | `Preloader`, `SplitHeadline` (roman/italic), `SplitScreenWipe` | `.grade-warm` |
| **omr-beauty** — dark luxury cinematic | Dark-glam salon, barber, nail bar, perfumery | `VideoHero` (`overlay="none"` if the footage is dark enough), `SpecTags` | `.grade-noir` |
| **beauty-in-stem** — soft wellness near-white | Spa, facial studio, massage | `Preloader`, `MaskWipe` (once), oversized step numbers | none / `.grade-cool` |
| **son-daven** — dark bronze textural | Guesthouse, taverna, hammam — anything with rooms or a menu | `SpecTags` (both variants), `KenBurnsImage` | `.grade-bronze` |
| **special-production** — brutalist b/w | Colourist, makeup artist, tattoo studio — portfolio-led | `HorizontalRail` (`scaleAtCentre`), `VideoHero` at card scale | `.grade-mono` or none |
| **serotoninn** — gritty-luxury editorial | Edgy salon, streetwear-adjacent barber | `MaskWipe` (`torn`), `.grade-reveal` split | `.grade-mono` + colour |
| **izanami** — meditative slow-burn | Yoga studio, retreat, high-end spa | `KenBurnsImage` (`direction="out"`, 26-30s), tiny serif over a vast image | `.grade-cool` |
| **floema** — warm industrial editorial | Workshop, atelier, craft business | `HorizontalRail`, full-bleed chapter heroes | `.grade-warm` |

### Photo grades

One `filter` line on every photo is the cheapest way to make mixed-quality client photos look
like one shoot. `globals.css` ships `.grade-warm`, `.grade-bronze`, `.grade-cool`,
`.grade-mono`, `.grade-noir`, plus `.grade-reveal` (grayscale resolving to colour on hover)
and `.grain` (an inline SVG noise overlay).

**Pick one grade and put it on every photo on the page.** Two grades defeats the purpose; none
is what makes a gallery of client photos look like a folder of client photos. Apply it to the
`<img>`, i.e. `imageClassName` on `KenBurnsImage`, not to a wrapper.

### Typography for motion

`SplitHeadline` mixes roman and italic through markup, not animation — pass italic `<span>`s
as children and they survive the split (vero-studio's headline is the model, and its italic
words are lowercase at ~55-60% of the roman cap height).

**This needs a family that HAS an italic.** For Greek sites that rules out **GFS Didot**, which
is single-weight roman only. Use **EB Garamond + Manrope** for any italic-led art direction in
Greek. See §5.

### Performance budget

| Item | Budget | Why |
|---|---|---|
| Hero video | **≤ 3 MB**, ≤ 12s loop, webm first then mp4 | A demo opened cold on 4G. Above this the poster is all anyone sees. |
| Video poster | **required, always** | No poster means a black rectangle while the video downloads. `VideoHero` will not let you omit it. |
| Preloader | **≤ 1.2s** including the exit wipe | The references run 2-9s. On a cold demo that reads as a broken site. |
| Simultaneous videos | ≤ 3-4 | son-daven runs a dozen; that is a budget item, not a design decision. |
| `backdrop-filter` | 1-2 small instances | Expensive on mid-range Android. |
| Grain opacity | ≤ 0.5 | Above that it reads as a broken image. |

`VideoHero` already pauses off-screen playback and sets `preload="none"`, so the video costs
nothing until it is needed.

### Reduced motion is correctness, not a nicety

Every component in the pack has a reduced-motion branch, and in two cases that branch is a
different LAYOUT rather than the same markup held still:

- `VideoHero` mounts no `<video>` element at all — poster only, nothing decodes.
- `SplitScreenWipe` stacks its two panels vertically, because an overlay that never wipes away
  would otherwise cover the base panel forever.
- `HorizontalRail` drops the pin entirely and becomes a native snap-scroll strip.
- `Preloader` and `CustomCursor` never mount.
- `SplitHeadline` renders as plain static text — no split, no mask.

**Verify by loading the page with reduced motion on.** Every heading, paragraph and image must
be visible and readable. Content left at `opacity: 0` or clipped to nothing behind a cancelled
animation is a QA failure, not a cosmetic issue.

### What the pack deliberately does not include

- **Three.js / WebGL.** Four references depend on it and it is the one thing our stack cannot
  reproduce. It contradicts the static-export budget and suits no salon or taverna. Where a
  reference's wow is WebGL, substitute a cross-fading photo sequence, layered parallax cutouts,
  or one still with a grade — and say so honestly in the build rather than claiming parity.
- **A custom cursor as a load-bearing effect.** `CustomCursor` exists, but essentially none of
  the seventeen references buys its polish this way, and it is invisible on the phone where
  these demos are usually opened.

## 7. Accessibility

- One `<h1>`. Headings descend without skipping levels.
- Semantic landmarks: `<header>`, `<main>`, `<nav>`, `<section>`, `<footer>`, `<address>` for contact.
- Body text ≥ 4.5:1 contrast; large display text ≥ 3:1. Light-grey-on-white micro-labels are the
  usual offender — check them.
- Keyboard reachable, with a visible focus ring (globals.css sets one; don't remove it).
- Tap targets ≥ 44px. Real `<a href="tel:...">` and `<a href="mailto:...">` for contact.
- Decorative background components (`Spotlight`, `GridPattern`, `Ripple`, marquees) get
  `aria-hidden="true"`.

## 8. Technical constraints

Static export (`output: 'export'`). **No server features exist**: no route handlers, no server
actions, no middleware, no ISR, no `next/image` optimization. A contact form with no backend is
a broken promise — use real contact links instead.

- Keep `robots: noindex/nofollow` in the layout metadata. These demos are private (SPEC §8).
- Keep `images.unoptimized: true` and `output: 'export'` in `next.config.mjs`.
- No network calls at runtime or build time beyond the npm registry. No analytics, no embedded
  Google Maps iframe, no external fonts, no CDN scripts.
- Components in `components/ui/` are yours to edit; they are vendored copy-paste code.

## 9. Before you finish

- [ ] `pnpm build` is green and `out/index.html` exists.
- [ ] Every fact on the page traces to `input/snapshot.json`.
- [ ] No horizontal overflow at 390, 768 and 1440. This is a hard QA gate.
- [ ] No console errors; no broken images.
- [ ] Reduced motion on: everything visible and readable.
- [ ] The real contact/CTA is present and works.
- [ ] Copy is in the snapshot language, and no sentence would fit any other salon.
- [ ] Re-read the ban-list in §3 against your own page — honestly.
- [ ] At most 3-4 motion mechanics, and the first screen moves before the visitor touches it.
- [ ] One photo grade, applied to every photo.
- [ ] Every video has a poster and is under 3 MB; the preloader (if any) is capped at 1.2s.
- [ ] `placeholder-*.jpg` deleted from `public/assets/`.
