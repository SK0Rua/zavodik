# Motion reference pack

17 award-winning sites captured as **scroll-through video**, not screenshots. Recorded
2026-08-18 with Playwright at 1440×900 (and 390×844 where noted), driven by a programmatic
smooth scroll that pauses at section boundaries so reveal animations play out.

**Why this pack exists.** `references/beauty/` is a set of static above-the-fold screenshots.
It is still valid for *composition, palette and typography* — the borrow-notes there are
concrete and worth reading. But a still frame cannot show choreography, so it produced demos
that were quiet and correct and had no wow. This pack supersedes it for **mood and motion**.
Use `references/beauty/` for layout craft; use this pack for what the page *does*.

Total 60 MB. Each directory holds:

| File | What it is |
|---|---|
| `desktop.webm` | 35–50s scroll-through at 1440×900 (downscaled to 1080px wide) |
| `mobile.webm` | same at 390×844, where captured |
| `hero.jpg` | above-the-fold frame |
| `full.jpg` | full-page screenshot (clipped to 12000px on very long pages) |
| `notes.md` | mechanics, timing, type, palette, how to rebuild it, gaps, what not to borrow |

`GAPS.md` is the prioritised list of what our template is missing, with effort estimates.

## How to use this pack

1. **Pick ONE reference** whose mood matches the business. Do not average several — averaging
   premium references is itself a reliable route to generic output. The index below maps
   moods to business types.
2. **Watch its `desktop.webm`**, then read its `notes.md`. The video is the brief; the notes
   translate it into our stack.
3. **Borrow 3–4 mechanics, maximum.** Every reference here has 5–6 listed. Taking all of them
   produces a showreel, not a business page. Pick the hero mechanic plus two or three
   supporting ones.
4. **Read the "Don't borrow" section.** Every one of these sites makes at least one choice
   that is wrong for a local business — a multi-second preloader, hidden navigation, an ENTER
   gate, audio, or a first screen carrying no information. They can afford it; a cold demo
   sent to a salon owner cannot.
5. **Obey the existing rules.** `site-template/DESIGN.md` still governs: evidence-only facts,
   the anti-slop ban-list, max 4 pool components, reduced motion as a correctness requirement,
   Greek-subset-safe fonts. Motion never overrides those.

### Watching the videos

```bash
open references/motion/vero-studio/desktop.webm          # macOS
# or extract a contact sheet:
ffmpeg -i desktop.webm -vf "fps=1/3,scale=520:-1" -frames:v 9 /tmp/f%02d.png
ffmpeg -start_number 1 -i /tmp/f%02d.png -filter_complex "tile=3x3" -frames:v 1 /tmp/sheet.png
```

## Index

Sorted by usefulness for our actual work — the top rows are service businesses with a single
location, which is our shape.

| Slug | URL | Mood | Top 3 mechanics | Best for |
|---|---|---|---|---|
| **vero-studio** | verostudio.com | Warm editorial, amber couture | Typographic % preloader; roman/italic mixed headline; vertical split-screen wipe | **Hair salon, bridal, beauty studio.** The single best all-round match in the pack |
| **omr-beauty** | omrbeauty.com | Dark luxury, cinematic | Video hero with live flame; headline larger than product; asymmetric two-up band | **Dark-glam salon, barber, nail bar, perfumery** |
| **beauty-in-stem** | beautyinstem.com | Soft wellness, near-white | Glass bubble growing from preloader into hero; custom-ligature wordmark; oversized step numbers | **Spa, facial studio, massage, wellness** |
| **son-daven** | sondaven.com/en | Dark bronze, textural retreat | Dithered photo resolve; cropped stencil wordmark; spec-tag list | **Guesthouse, taverna, hammam** — any business with rooms/menu specifics |
| **special-production** | specialproduction.agency | Brutalist fashion, b/w | Viewport-cropped `SPA` wordmark; horizontal video rail; cards scaling at centre | **Colourist, makeup artist, tattoo studio** — portfolio-led businesses |
| **serotoninn** | serotoninn.com | Gritty-luxury editorial | Torn-paper split reveal; grayscale/colour portrait split; giant footer wordmark | **Edgy salon, streetwear-adjacent barber** |
| **izanami** | izanami-official.com | Meditative slow-burn luxury | Very slow Ken Burns on misty photography; tiny serif over vast image; near-black restraint | **Yoga studio, retreat, high-end spa** |
| **floema** | floema.com | Warm industrial editorial | Scattered thumbnails around a headline; chapter-style full-bleed heroes; hard colour-block footer | **Workshop, atelier, furniture/craft business** |
| **indigo-laboratory** | indigo-laboratory.it | Dark ritual, tactile | Blur-to-sharp video resolve; stacked chapter index; condensed display wordmark | **Jewellery, piercing studio, high-ticket craft** |
| **mont-fort** | mont-fort.com | Cold corporate prestige | Misty multi-layer parallax hero; cross-fading full-bleed sections | Clinics, dental, professional services |
| **ellmerers-hof** | ellmerers-hof.com | Warm handcrafted countryside | Grayscale-to-colour illustration reveal; hand-lettered display; staggered element pop-in | **Farm stay, family taverna** — where charm beats gloss |
| **alethia** | alethia.earth | Dark data futurism | Floating 3D-look objects with HUD labels; pinned headline | Tech-adjacent; limited salon use |
| **siena-film** | siena.film | Dark cinematic editorial | Draggable floating video card; warm film grade; persistent quote stack | Businesses leading with reviews/testimonials |
| **revelatio** | revelatio.studio | Glitchy technical editorial | ASCII/dot-matrix image filter; scramble-text headline; giant glyph-grid footer | Signature treatment only; too cold for beauty |
| **lama-lama** | lamalama.com | Loud tactile maximalism | Fixed headline over hard-cutting material textures; stepped logo reveal | Mood/texture reference only |
| **ponpon-mania** | ponpon-mania.com | Bright playful illustrated | Blob-clipped illustrated hero; spinning seal badge | **Kids' hairdresser, ice cream, playful cafe** |
| **studio-k95** | k95.it | Electric maximalist WebGL | Morphing chrome sculpture; orbiting project cards on flat blue | Bright-playful *palette* only — mechanics need WebGL, see GAPS.md |

### Capture notes

- **`indigo-laboratory` and `siena-film`** sit behind an "ENTER" splash gate; the capture
  script clicks through it. Their videos start on the gate.
- **`indigo-laboratory`** has a long stall mid-capture (documented in its notes) — trust the
  first ~25s and the last ~20s.
- **`ponpon-mania`** uses heavy virtual scroll; the capture dwells on the hero and
  under-represents the site's chapter mechanic. Flagged in its notes.
- **Cookie/consent panels** appear in several recordings. They are platform chrome, not design.
- **Rejected on inspection:** `shikobeauty.com`, `achillesheel.co.uk`, `bridgebeauty.com`,
  `beautyqueenhk.com` — all award-listed but in practice ordinary Shopify stores dominated by
  a sticky discount popup, with no wow motion. `the-beautiful.jp` now redirects elsewhere;
  `deepbeautykikomilano.com` and `auratheurbanretreat.com` are down. As with the previous
  pack, **an HTTP 200 proves nothing** — every candidate here was watched, not just curled.

## Wow checklist (proposed for the critic — not yet wired)

`src/build/rubric.ts` and the critic prompt in `src/workers/visualQa.ts` are **unchanged** by
this pack. The following is a proposal for Roman to wire in, addressing
`docs/BUILD-PIPELINE.md` §12 items 2 and 3.

Six axes, scored 0–3 (0 absent, 1 token, 2 solid, 3 genuinely striking):

| Axis | What earns a 3 | What scores 0–1 |
|---|---|---|
| **Hero motion** | The first screen moves before the visitor touches anything — video, slow zoom, a scroll-linked reveal — and the motion is tied to the content | A static hero, or a decorative loop unrelated to the subject |
| **Scroll choreography** | At least one pinned or scrub-linked sequence where scrolling *drives* the animation | Everything is a uniform fade-up-on-enter |
| **Type as design element** | Display type at `>8vw` somewhere, deliberate size contrast (≈10:1), a cropped or overflowing wordmark, or roman/italic mixing | One size doing every job; headline and body indistinguishable |
| **Photo treatment** | A consistent grade across all photos; full-bleed or masked; crops chosen (macro/edge-bleed) rather than accepted | Photos dropped into equal rounded cards with shadows |
| **Micro-interaction** | Hover states that scale/mask/reveal within a cropped container; a considered cursor or custom control | Default link underlines and colour changes only |
| **Performance & reduced motion** | Smooth; nothing left at `opacity: 0` under reduced motion; infinite loops actually disabled; video has a poster | Jank, pop-in, or content invisible when motion is off |

**Suggested gating.** Total below 9/18 should fail as "looks like a default AI template"
(severity ≥ medium, per §12 item 2). **Hero motion = 0 should fail on its own** — a static
hero is the defect Roman rejected. And per §12 item 3, require that at least 3 pool components
are actually present in the DOM *and* animating, not merely imported.

**Also worth wiring (§12 item 1):** pass the chosen reference's `hero.jpg` into the critic
alongside the demo screenshots and ask for a direct comparison — "how close does this get to
this?". The critic currently sees only the demo, so it has no bar to judge against.
