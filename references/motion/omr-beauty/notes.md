# OMR Beauty — Swedish fragrance house

- **URL:** https://omrbeauty.com/
- **Captured:** 2026-08-18 (desktop 1440×900, mobile 390×844)
- **Mood:** Dark luxury, cinematic product photography
- **Award:** Awwwards Honorable Mention, Feb 3 2026 (Panagora)

The most directly transferable **dark-luxury** reference in the pack. It is a commerce site,
but the hero, the type scale and the section rhythm map onto a salon page almost unchanged.

## What makes the wow

- **Full-bleed video hero with a candle flame and near-black surround.** The product bottle
  sits in shallow focus while a real flame moves behind it. The motion is ambient and
  continuous rather than scroll-driven, which means the page is alive before the visitor
  touches anything. This is the cheapest "wow" on the list: one short looping video.
- **Headline larger than the product.** "UNBOUND BY BEAUTY" is set in a heavy condensed sans
  at roughly `clamp(3rem, 9vw, 7rem)`, two lines, bottom-left, overlapping the photograph
  with no scrim or box behind it. Size alone carries the hierarchy.
- **Mirrored ghost type.** The word "COPPER" appears once upright on the bottle label and
  again inverted below it, as a reflection in the surface. Real reflection captured in-camera,
  not a CSS trick — but it establishes that reflections are part of the art direction.
- **Two-up asymmetric category band.** Immediately below the hero, "BUNDLES" (a yellow-green
  petal macro) and "BESTSELLERS" (a dark portrait) sit side by side at *unequal* widths with
  the label type baseline-aligned across both. Two unequal cells read as art direction; three
  equal cells read as a template.
- **Editorial pull-quote as a full section.** "developed *with* a strong belief that you
  shouldn't limit yourself—nor should any <u>beauty product</u>." Mixed roman/italic, one
  underlined phrase, black on white, occupying an entire band with nothing else in it.
- **Giant wordmark as the footer.** "OMR BEAUTY" runs nearly the full 1440px above the
  newsletter field, functioning as a sign-off rather than a logo.

## Timing & easing

Ambient rather than choreographed. The hero video loops continuously; section entrances are
short opacity/`y` fades of roughly 0.4–0.6s triggered on scroll, without long pinned
sequences. Hover on the category tiles produces a slow scale-up (~1.03 over ~0.5s). The site
feels expensive because of photography and type scale, **not** because of complex scroll
choreography — which is precisely why it is reproducible for us.

## Typography

One heavy condensed grotesque doing all display work, in caps, with tight tracking
(approximately `-0.02em`) at large sizes. A regular-weight sans for body and the ~11px
letterspaced nav row (`eau de parfum / perfume oil / scented candle / collection / essentials`).
A serif italic appears only inside the pull-quote. Effectively two families, three sizes.

## Palette

Near-black `#0a0a0a` grounds, warm amber flame highlights `#c8761e` coming from the
photography itself, pure white type, and one bright yellow-green `#c4d81e` used exclusively
in the BUNDLES tile. Product colour (purple INTRO, pink FLUID) enters only via the bottles on
white. **One accent**, and even that is a photograph rather than a fill.

## Layout rhythm & photo treatment

Tall dark hero, then a tight two-up band, then a bright white type-only band, then a white
product grid, then a dark four-up image strip (`OUR STORY / HOME FRAGRANCE / EAU DE PARFUM /
PERFUME OILS`), then the giant wordmark footer. **The dark/light alternation is the rhythm** —
no two adjacent sections share a ground colour. Photography is either extreme macro (a petal,
lips, a droplet) or a centred product on seamless white. Nothing is a mid-distance snapshot.

## Mobile behaviour

The hero video is retained full-bleed and the headline drops to roughly `2rem`, still
bottom-left and still overlapping the photo. The two-up band stacks. The four-up image strip
becomes a horizontally scrollable row rather than a stack, which keeps the section short.
Nav collapses to a hamburger plus the cart.

## Performance notes

Smooth in the recording. The hero video is the whole weight budget; it is short, muted and
looping. A Shopify cookie/consent panel appears bottom-centre for the first several seconds
of the capture (visible in the frames) — that is the platform, not the design. No WebGL.

## Reproduce with our stack

- **Video hero** — `<video autoPlay muted loop playsInline poster="...">` full-bleed with
  `object-fit: cover`. **Must have a `poster` still**, and must be swapped for a static image
  under `prefers-reduced-motion` (check `useReducedMotion()` from `lib/use-reduced-motion.ts`).
  Only ever use real footage of the actual business, or a clearly decorative abstract texture
  marked `ai_generated` — never AI footage implying it is their premises.
- **Oversized bottom-anchored headline over photo** — absolutely positioned block, no scrim.
  Reveal with `SplitText` by `lines` inside `overflow:hidden`, `y: 110%` → `0`,
  `stagger: 0.09`, `duration: 0.9`, `ease: 'power4.out'`.
- **Two-up asymmetric band** — CSS grid `grid-template-columns: 1.15fr 0.85fr`, one shared
  baseline for the two labels. Deliberately not `1fr 1fr`.
- **Tile hover scale** — `transition: transform 0.5s cubic-bezier(0.22,1,0.36,1)` with
  `scale(1.03)` on the inner `<img>` and `overflow:hidden` on the wrapper.
- **Pull-quote band** — pure type. `<em>` for the italic phrase,
  `text-decoration: underline; text-underline-offset: 4px` on the emphasised span.
- **Giant footer wordmark** — one `<div>` at `clamp(3rem, 12vw, 11rem)`, `line-height: 0.85`.
- **Dark/light alternation** — assign each `<section>` an explicit ground colour token; make
  it a rule that adjacent sections never repeat one.

Pool components: `BlurFade` for the band entrances, optionally `Marquee` for the four-up
strip on mobile. One or two of four — most of this is plain CSS, which is the point.

## Gaps

- No **video-hero component** that bundles poster, muted/loop/playsInline, reduced-motion
  fallback and an `object-fit: cover` wrapper. This is the single highest-value addition for
  "wow per line of code" and should be built first.
- No **section-ground alternation token/lint** — nothing stops the builder emitting six
  cream bands in a row, which is exactly the machine-made rhythm we are trying to avoid.
- No **hover-scale-in-overflow-crop** utility (three lines of CSS, but consistently forgotten).

## Don't borrow

- **The commerce furniture** — cart, account, search, "shop now" repeated. A salon demo has
  one CTA (call or book) and it should be quiet and persistent.
- **The pure-white seamless product grid.** A salon has no packshots. Attempting this section
  is what produces fake stock imagery. If there are no product photos, cut the section.
- **The consent banner** and any other platform chrome.
