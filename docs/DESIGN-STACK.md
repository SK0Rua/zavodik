# Design stack (site-template)

Foundation for phase C (site build + visual QA). Implements SPEC §2.4 and decision #11:
the builder agent does not invent design from scratch — it composes from a pool of
human-made components, follows curated niche references, and obeys an anti-slop ban-list.

**Status:** built and verified 2026-08-16. `cd site-template && pnpm install && pnpm build`
produces `out/` with zero console errors and no horizontal overflow at 390/768/1440.

Owned by this work: `site-template/**`, `skills/**` (+ `.claude/skills/` mirror),
`references/**`, this document.

---

## 1. What the builder agent gets

`src/workers/builder.ts` copies `site-template/` into `sites/<business_id>/`, drops in
`input/{snapshot,brief,design}.json` and `public/assets/`, then the agent runs
`pnpm install && pnpm build` inside that copy.

Three documents drive its design decisions:

| File | Role |
|---|---|
| `site-template/DESIGN.md` | The rules: evidence-only facts, image handling, anti-slop ban-list, typography, motion, reduced motion, a11y, static-export constraints, pre-finish checklist. |
| `site-template/components/README.md` | Catalog of all 29 pool components: what each is for, props, which need CSS keyframes, local patches, sources. |
| `references/<niche>/README.md` | Curated reference sites with concrete borrow-notes + screenshots. |

`DESIGN.md` deliberately restates only the rules the coder needs, not the whole spec.

## 2. Versions (installed and verified)

**Runtime**

| Package | Version | Purpose |
|---|---|---|
| next | 15.5.23 | App Router, `output: 'export'` |
| react / react-dom | 19.2.8 | |
| motion | 13.1.0 | Framer Motion's successor. Import path is `motion/react` — every pool component already uses it. |
| gsap | 3.15.0 | Includes ScrollTrigger **and SplitText** — all plugins are free commercially since the Webflow acquisition. No auth token or private registry. |
| @gsap/react | 2.1.2 | `useGSAP` hook (React-safe cleanup) |
| lenis | 1.3.26 | Smooth scroll, synced to the GSAP ticker |
| clsx | 2.1.1 | conditional classes |
| tailwind-merge | 2.6.1 | conflict resolution in `cn()` |
| @tabler/icons-react | 3.46.0 | required by `animated-testimonials` |
| lucide-react | 0.545.0 | general icon set |

**Build**

| Package | Version |
|---|---|
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| typescript | 5.9.3 |

**Tailwind v4, not v3** — there is no `tailwind.config.js`. Theme, tokens and keyframes all
live in `app/globals.css` inside `@theme`. The Aceternity and Magic UI sources fetched are
the current v4-era ones and use v4-only syntax (`bg-linear-to-r`, `gap-(--gap)`,
`mask-intersect`), so they would break on v3. Config is `postcss.config.mjs` only.

## 3. Workspace isolation

The repo root has `pnpm-workspace.yaml` with `packages: ["."]`. Without protection, a
`pnpm install` inside a copied site would walk up, attach to the factory workspace and write
to the factory lockfile.

`site-template/pnpm-workspace.yaml` makes the template its own workspace root
(`packages: []`), so the install is self-contained wherever the copy lands. It also sets
`allowBuilds: { sharp: false }` — next pulls sharp for image optimization, which is dead
weight under `images.unoptimized`, and an unanswered `pnpm approve-builds` prompt would
otherwise **hang the build job**.

`next.config.mjs` pins `outputFileTracingRoot` to the template directory for the same reason:
without it Next picked `/Users/romankudin/pnpm-lock.yaml` as the workspace root.

Verified: `cd site-template && pnpm install && pnpm build` works standalone, with its own
`pnpm-lock.yaml`, and does not touch the factory lockfile.

## 4. Component pool — 29 components

Vendored into `site-template/components/ui/`, all MIT, all typecheck clean.

**Aceternity UI** (16, from `https://ui.aceternity.com/registry/<slug>.json`):
`spotlight`, `spotlight-new`, `background-beams`, `3d-card`, `bento-grid`,
`infinite-moving-cards`, `text-generate-effect`, `typewriter-effect`, `sticky-scroll-reveal`,
`lamp`, `aurora-background`, `hover-border-gradient`, `animated-testimonials`,
`moving-border`, `background-gradient`, `glowing-effect`.

**Magic UI** (13, from `magicuidesign/magicui` `apps/www/registry/magicui/`):
`marquee`, `shimmer-button`, `number-ticker`, `blur-fade`, `border-beam`,
`animated-gradient-text`, `dot-pattern`, `grid-pattern`, `text-animate`, `shine-border`,
`magic-card`, `animated-shiny-text`, `ripple`.

Import surface is narrow: `react`, `@/lib/utils`, `motion/react`, plus `@tabler/icons-react`
in one file. **No `framer-motion` anywhere** — Aceternity has already migrated its registry to
`motion/react`, so no rewrite was needed. No three.js/cobe/simplex-noise heavy deps.

### Local patches (4 files)

1. **`number-ticker.tsx`** — upstream rendered `startValue` in markup, so the exported static
   HTML shipped `0` and only became correct once JS ran. On a factory whose numbers are
   evidence-backed facts, a JS-blocked visitor read a *wrong* rating. Now renders the real
   value, and snaps to it under reduced motion instead of animating.
2. **`magic-card.tsx`** — removed the `next-themes` dependency (a static demo has no theme
   switcher) and hoisted two `useMotionTemplate` calls out of JSX; one sat behind
   `mode === "gradient"`, making it a conditional Hook call.
3. **`moving-border.tsx`** — `useRef<any>()` → `useRef<any>(null)` for React 19.
4. **Nine files** gained a missing `"use client"` directive.

### Keyframes

Ten `@keyframes` + `--animate-*` theme vars live in `app/globals.css`. Deleting one silently
disables that component's motion. The reduced-motion block explicitly sets `animation: none`
on every infinite decorative loop (`0.01ms` still burns CPU on an infinite loop) and forces
`opacity: 1` on the spotlight entrance so nothing stays invisible.

## 5. Motion architecture

- **`components/smooth-scroll.tsx`** — Lenis wired into the GSAP ticker with
  `gsap.ticker.lagSmoothing(0)` and `lenis.on('scroll', ScrollTrigger.update)`. The two fight
  each other on separate RAF loops. Mounted once in `app/layout.tsx`. Skipped entirely under
  reduced motion. `syncTouch: false` — hijacking touch scroll ruins mobile feel.
- **`lib/gsap.ts`** — single registration point for `ScrollTrigger`, `SplitText`, `useGSAP`.
  Exports `motionSafe()`, wrapping `gsap.matchMedia('(prefers-reduced-motion: no-preference)')`
  so animations never run for reduced-motion users and revert cleanly on unmount.
- **`lib/use-reduced-motion.ts`** — `useReducedMotion()` (reactive) and
  `prefersReducedMotion()` (one-shot, for imperative setup).

**Reduced motion is treated as a correctness requirement, not a nicety** (SPEC §2.4). The
documented trap — leaving content at `opacity: 0` waiting for a cancelled animation — is
called out in DESIGN.md and verified in QA.

## 6. Typography

Default pair **Fraunces** (display; optical-size axis, editorial) + **Outfit** (body), loaded
via `next/font/google`, which self-hosts the woff2 at build time — that is what keeps
`output: 'export'` working with no runtime CDN call. Verified: fonts appear in
`out/_next/static/media/`.

Deliberately not Inter/Poppins — those are on the ban-list.

### Greek: a real trap, documented

**Neither Fraunces nor Outfit supports the `greek` subset**, and requesting a missing subset is
a **hard build failure**, not a silent fallback:

```
`next/font` error: Unknown subset `greek` for font `Fraunces`.
```

Since the first campaign is Patras, this would have broken the first real build. Verified
Greek-capable pairs are documented in `DESIGN.md` §5 and in a comment in `app/layout.tsx`:
**GFS_Didot + Manrope** (build-tested), EB_Garamond + Manrope, Literata + Source_Sans_3.
Also lacking Greek: Cormorant Garamond, Instrument Serif, Marcellus, Jost.

## 7. GSAP skills

Official GreenSock skills from **https://github.com/greensock/gsap-skills** (MIT), installed in
`skills/` and mirrored to `.claude/skills/` (`skills/` is source of truth, per CLAUDE.md).

Upstream ships **8**, already `gsap-`-prefixed, so no renaming was needed and all bodies are
verbatim: `gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-react`, `gsap-frameworks`,
`gsap-plugins`, `gsap-performance`, `gsap-utils`. (The spec anticipated 5; the extra three are
`plugins`, `frameworks`, `utils`.) Plus `gsap-llms.txt` (upstream skill index) and
`GSAP-SKILLS-LICENSE`. 112K per location.

The existing `gen-image` skill is untouched.

## 8. References

`references/beauty/` — 7 curated premium salon/spa sites, all verified live, all screenshotted
at 1440 and visually inspected. 3.2 MB.

Salón Soňa, EVER, Atelier Brzozowski, ALICE Hair & Art, Marco Ambrosi, UNA, Antara Spa —
spread across warm-editorial, dark-moody, Scandinavian-minimal and warm-organic so the agent
has range rather than five versions of one look.

The README gives each site 5 concrete borrow-notes with real measurements plus a "don't borrow"
line, a "common threads" synthesis, and an anti-patterns section. It explicitly instructs
picking **one** reference rather than averaging all seven — averaging premium references is
itself a route to generic output.

Worth noting: three award-listed candidates were rejected on visual inspection. `curenails.co`
(an Awwwards SOTD) is now **gambling/SEO spam** on a hijacked domain, and `mistretta.ch`'s
award-winning site is gone. An HTTP 200 alone would have passed all three — reference lists
need looking at, not just curling. Adding a niche means repeating that process.

## 9. Verification performed

Build: `pnpm install && pnpm build` → green, `out/index.html` present, `noindex, nofollow`
in the export, fonts self-hosted. `tsc --noEmit` clean across all 29 components.

Runtime: exported `out/` served over http and loaded in Playwright/Chromium.

| Viewport | Overflow | Console errors | Page errors | Failed requests |
|---|---|---|---|---|
| 390 | none | 0 | 0 | 0 |
| 768 | none | 0 | 0 | 0 |
| 1440 | none | 0 | 0 | 0 |
| 1440 reduced-motion | — | — | 0 | 0 elements left invisible |

Screenshots: `site-template/.screenshots/starter-{390,768,1440}.png`.

`app/page.tsx` is kept as the **starter the builder overwrites** — a working salon skeleton
exercising 9 pool components, with every string marked `PLACEHOLDER`. It keeps the template
build honest (a component that stops compiling fails immediately) and shows the agent real
composition and prop usage. Its header warns that the section order must not be copied verbatim.

## 10. Known gaps

- References exist for **beauty only**. Any new niche needs its own `references/<niche>/`,
  with sites visually inspected, not just status-checked.
- No premium *nail-specific* reference — genuinely high-design independent nail studios are
  scarce. Covered by hair/beauty/spa; the compositional patterns transfer.
- The pool is untested against a **real** snapshot; that is phase C. Expect the visual-QA
  rubric to surface component-level issues once real photography and real copy land.
- `lamp.tsx` retains upstream's `LampDemo` default export (demo scaffolding, documented as
  do-not-ship).
