# GAPS — what the template lacks to build "wow"

Synthesised from the 17 `notes.md` files in this pack. Each entry says what is missing, how
often it recurred across the references, a rough effort estimate, and where to source it.

**Effort scale:** S = under an hour, M = a few hours, L = a day or more.

Nothing here is a proposal to change `site-template/`, `src/` or the rubric. This is the
prioritised menu for Roman to choose from. Ranking is by *wow delivered per hour of work*,
not by how impressive the technique is — the top four items appeared in most of the
references and are all S or M.

---

## Tier 1 — build these first (high value, low effort)

### 1. `<VideoHero>` — full-bleed looping video hero — **S/M**
**Seen in:** omr-beauty, special-production, indigo-laboratory, siena-film, floema.

The cheapest wow on the entire list. A muted looping video behind the headline makes a page
feel alive before the visitor touches anything, and it costs one component.

Must bundle: `autoPlay muted loop playsInline`, a required `poster` still, `object-fit: cover`,
a `prefers-reduced-motion` branch that renders only the poster, and pausing when off-screen
(`IntersectionObserver`).

**Source:** hand-written, no dependency. ~60 lines.
**Constraint:** only real footage of the actual business, or an abstract texture marked
`ai_generated`. Never AI footage implying it shows their premises (SPEC invariant).

### 2. `<SpecTags>` — bordered typographic fact tags — **S**
**Seen in:** son-daven (rooms), omr-beauty (nav), alethia (HUD labels), floema.

Lowest effort, highest immediate payoff for a *local business specifically*. A wrapped row of
hairline-bordered uppercase tags (`90 SQ METERS`, `OPEN PLAN KITCHEN`) turns a services or
amenities list from a bullet list into something that looks art-directed.

Wire it directly to snapshot facts so every tag is evidence-backed — which is also what makes
it look premium rather than padded.

**Source:** hand-written, pure CSS. ~30 lines.

### 3. `<MaskWipe>` / clip-path reveal utility — **M**
**Seen in:** vero-studio (vertical split), serotoninn (torn-paper split), beauty-in-stem,
omr-beauty, indigo-laboratory.

The most-repeated *motion* mechanic in the pack. One layer wipes over another on a hard edge
driven by scroll:

```js
ScrollTrigger + scrub → clipPath: 'inset(0 100% 0 0)' → 'inset(0 0% 0 0)'
```

Should support: direction (l/r/t/b), a straight edge or a **ragged/torn SVG edge** (the
serotoninn signature), and `motionSafe()` wrapping so it reverts cleanly.

**Source:** GSAP ScrollTrigger + a hand-authored jagged `clipPath` path. The torn edge is one
SVG path reused as a shared asset.

### 4. `<Preloader>` — typographic load screen with a hard cap — **S/M**
**Seen in:** vero-studio, son-daven, serotoninn, beauty-in-stem, izanami, mont-fort,
studio-k95, revelatio. **Eight of seventeen.**

Every premium reference uses one, and every one of them is too long for our use case. Build
the version that is correct for a cold demo: the real headline plus a `NumberTicker` counter,
**capped at ~1.2s**, dismissed on `window.load`, skipped entirely under reduced motion.

The award-site version holds the visitor for several seconds. On a demo sent cold to a salon
owner on 4G, that reads as a broken site. Capping it is the whole point of building it
ourselves rather than copying.

**Source:** hand-written + existing pool `NumberTicker`.

### 5. Photo-grade utility classes — **S**
**Seen in:** vero-studio (amber), son-daven (bronze), izanami (cold desaturate),
omr-beauty (near-black).

One `filter` line applied to every photo on the page — e.g.
`filter: sepia(0.25) saturate(1.25) hue-rotate(-8deg)` — is the single most reliable way to
make mixed-quality client photos look like one shoot. Ship 3–4 named grades as tokens in
`globals.css` (`.grade-warm`, `.grade-cold`, `.grade-bronze`, `.grade-mono`) and require the
art direction to pick one.

**Source:** pure CSS. Perhaps 20 lines total, and it improves *every* build.

---

## Tier 2 — real wow, moderate effort

### 6. `<HorizontalRail>` — vertical scroll drives horizontal motion — **M**
**Seen in:** special-production, floema, omr-beauty (mobile), siena-film.

The canonical GSAP pin + scrub + `containerAnimation` pattern. Fiddly to get right —
especially the `end: '+=' + scrollWidth` recalculation on resize and the mobile fallback — so
it should be written once rather than re-derived per build.

Must include a `gsap.matchMedia()` mobile branch falling back to native `overflow-x: auto`
with `scroll-snap-type: x mandatory`; pinning on touch devices feels broken.

**Source:** GSAP ScrollTrigger `containerAnimation` (available in our 3.15).

### 7. `<GlassLens>` — backdrop-filter sphere over photography — **S/M**
**Seen in:** beauty-in-stem (the whole hero), alethia.

`border-radius: 50%` + `backdrop-filter: blur() saturate()` + an inset rim highlight and a
radial specular. **No WebGL required** — this is the highest-value trick for soft-wellness
briefs and it is pure CSS.

**Caution:** `backdrop-filter` is expensive on mid-range Android. Keep the blurred area small
and limited to one or two instances.

### 8. Ken Burns / slow-zoom helper — **S**
**Seen in:** izanami, mont-fort, ellmerers-hof, siena-film.

A single reusable GSAP tween: `scale: 1 → 1.08` over 12–20s, or scrubbed to scroll. Trivially
small, but it is what makes a single still photograph feel cinematic, and every "quiet luxury"
brief will want it.

### 9. `<FloatDrift>` — desynchronised idle motion — **S**
**Seen in:** beauty-in-stem (bubbles), alethia (rocks), floema (thumbnails).

`motion/react` `animate={{ y: [0,-18,0] }}` with `repeat: Infinity`, each instance given a
*different* duration so they never sync up (synchronised drift is what makes it look cheap).
**Must hard-disable under reduced motion** — an infinite loop at `0.01ms` still burns CPU.

### 10. Section-ground alternation rule — **S**
**Seen in:** omr-beauty, vero-studio, floema, son-daven.

Not a component but a constraint: adjacent sections must never repeat the same ground colour.
The dark/light alternation *is* the rhythm on every reference that has one, and its absence is
a large part of why a generated page reads as machine-made. Cheap to express as a design-token
rule, and checkable.

---

## Tier 3 — distinctive but expensive, pick at most one per build

### 11. Dither / halftone image filter — **L**
**Seen in:** son-daven, revelatio (ASCII variant).

An SVG filter or small canvas pass rendering photos as luminance-mapped vertical bars or
character glyphs, then resolving to the real image on scroll. This is the one treatment that
would genuinely rescue mediocre client photography by making it look deliberate.

Highest effort in the pack, but it is also the most *distinctive* — no template does this.
**Source:** Codrops has several ASCII/dither shader and canvas demos; a non-WebGL canvas
version is achievable and avoids adding a 3D dependency.

### 12. Text-scramble effect — **S/M**
**Seen in:** revelatio.

Characters cycle through random glyphs before settling. **Available free in GSAP 3.15 as
ScrambleTextPlugin** — all GSAP plugins are free commercially since the Webflow acquisition,
so this is a registration line rather than a build. Use once per page at most.

### 13. Magnetic cursor / custom pointer — **M**
Present in various forms across the award sites but rarely load-bearing. Deprioritised: it is
invisible on touch, and our demos are frequently opened on a phone.

### 14. WebGL / Three.js — **L, and recommend against**
**Seen in:** studio-k95 (chrome sculpture), alethia (floating 3D), lama-lama (material morph),
mont-fort (globe).

The only mechanics in this pack that genuinely **cannot** be reproduced with our stack. Adding
three.js contradicts the lean static-export budget, and none of these effects suit a local
salon or taverna.

**Recommendation: do not add.** Where a reference's wow depends on WebGL, substitute:
a cross-fading photo sequence (lama-lama), layered parallax cutouts (alethia), or a still with
a grade (studio-k95). Note this honestly in the build rather than pretending parity.

---

## Content gaps (not code)

- **Video footage.** Three Tier-1 mechanics assume a short clip of the real business. Most
  Patras candidates will have none. Either the outreach flow requests it, or the video hero is
  reserved for businesses whose evidence package includes usable footage.
- **Illustration.** ellmerers-hof and ponpon-mania depend on bespoke character/watercolour
  art. Generatable via the `gen-image` skill, but it must be marked `ai_generated` and must
  never depict the business's actual premises, staff or work.
- **Enough real photos.** Several references carry a whole section on 10–15 images. With three
  photos, the honest move is a type-led section, not a padded gallery.

---

## Proposed build order

1. `SpecTags` (S) — immediate, helps every single build
2. Photo-grade classes (S) — immediate, helps every single build
3. `VideoHero` (S/M) — biggest wow-per-line, where footage exists
4. `Preloader` with hard cap (S/M) — used by 8 of 17 references
5. `MaskWipe` (M) — the most-repeated motion mechanic in the pack
6. `GlassLens` (S/M) — unlocks the soft-wellness direction
7. `HorizontalRail` (M) — unlocks the work-showcase direction
8. Ken Burns + `FloatDrift` (S each) — cheap atmosphere
9. Dither filter (L) — only if Roman wants a signature treatment nobody else has
