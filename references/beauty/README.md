# Beauty / Nail / Hair — Premium Reference Pack

Design-reference library for the AI site-builder agent. When composing a salon, nail, brow, hair or spa
landing page, read this file first and pick ONE reference whose character matches the business, then borrow
its concrete mechanics. Do not average all seven together — averaging premium references produces a generic
result, which is exactly the failure mode this pack exists to prevent.

Every URL below was verified live (HTTP 200) and every screenshot was captured at 1440×2200 and visually
inspected on 2026-08-16. Screenshots are above-the-fold desktop viewport, not full-page.

## Common threads across all seven

- **Photography is the hero, not gradients or illustration.** Six of seven open with a full-bleed photograph
  of a real person or the real interior. None of them opens with a colored gradient panel or an icon row.
- **Generous, almost uncomfortable whitespace.** ALICE leaves ~60% of the first screen empty; Marco Ambrosi
  puts a single sentence in the top third and nothing else. Cheap sites fill every band; these do not.
- **One accent color, maximum.** Salón Soňa: one oxblood block. Marco Ambrosi: one terracotta square.
  Antara: one forest green. The accent appears 1–2 times on the whole first screen and carries all emphasis.
- **Extreme type-size contrast instead of many type styles.** The pattern is a display face at 5–12rem
  against 12–15px letterspaced sans — usually only two families and 3–4 sizes on the entire page.
- **Uppercase letterspaced micro-labels do the navigational work.** ~11–13px, 0.1–0.2em tracking, used for
  nav, section labels, contact strips, and image captions. This one detail separates premium from template.
- **Motion reveals, it does not decorate.** Scroll-triggered fades/masks on images and headline lines. No
  bouncing icons, no autoplaying carousel, no spinning badges.
- **Booking is one persistent, quiet link.** Top-right text link ("BOOK AN APPOINTMENT", "REZERWACJA",
  "MAKE AN APPOINTMENT") — not a fat colored pill repeated six times down the page.

---

## 1. Salón Soňa — warm editorial, split hero

- **URL:** https://ss.art4web.co/
- **Screenshot:** `salon-sona.jpg`
- **Character:** Warm nude/oxblood beauty editorial; a magazine cover that happens to be a booking page.

**Borrow:**
- **The split hero.** Full-bleed portrait fills the viewport; a solid oxblood rectangle is laid over the
  right ~50% starting at ~45% viewport height and running off the bottom edge. The headline sits inside that
  block. This is the single most reusable premium hero device in the pack — it needs one photo and one color.
- **Roman + italic on consecutive lines.** "Your best" in serif roman, "beauty ritual" directly beneath in
  the italic of the same family, same size. Two words of italic buy the entire "editorial" read for free.
- **Vertical nav as a left rail, not a top bar.** HOME / ABOUT / TREATMENTS / COSMETICS / CONTACT stacked at
  ~11px uppercase with ~0.2em tracking, mid-left, with a short em-dash marking the active item. Leaves the
  top of the page entirely to the photograph.
- **Wordmark as spaced capitals.** "S A L Ó N   S O Ň A" at small size with very wide tracking, top-left.
  No logo file needed — this is a typographic identity a builder agent can generate reliably.
- **Phone number in a hairline-bordered box** at bottom-left, uppercase micro-type. Contact info treated as
  a design element rather than a footer afterthought.

**Don't borrow:** the nude-on-oxblood palette is very low contrast for body copy — keep it for hero display
type only and switch to near-black on cream for anything readable.

## 2. EVER — centered serif over a macro portrait

- **URL:** https://www.ever.co.id/
- **Screenshot:** `ever-beauty.jpg`
- **Character:** Warm brown, restrained luxury; extreme close-up beauty photography with one serif line on top.

**Borrow:**
- **Macro crop instead of a full portrait.** The hero photo is cropped to eyebrows-to-nose, filling 1440px
  wide. Cropping in hard signals a premium brand and dodges the "stock smiling woman" read entirely — a
  strong default when the business supplies mediocre wide shots.
- **Headline centered in the optical middle, not the vertical middle.** "beauty in every detail" sits at
  ~45% height, in a high-contrast display serif around 5–6rem, pure white, no shadow, no scrim, no box.
  It works because the crop behind it is a smooth low-detail area (the forehead) — choose the crop to
  create that quiet zone, don't add a dark overlay.
- **Lowercase display serif.** All-lowercase headline in a serif with strong thick/thin modulation reads
  softer and more contemporary than the usual all-caps luxury treatment.
- **Three-element top bar.** Hamburger left, spaced-capitals wordmark dead center, "MAKE AN APPOINTMENT"
  right. Nothing else. Center wordmark + right-aligned booking link is the premium salon nav signature.
- **"SCROLL TO EXPLORE"** in ~11px letterspaced caps, bottom-center. Cheap sites use a bouncing chevron;
  premium sites use two words of small type.

**Don't borrow:** the hidden hamburger-only navigation. A local salon needs services and prices reachable in
one click — keep the visual restraint but expose 4–5 real links.

## 3. Atelier Brzozowski — dark, moody, huge display serif

- **URL:** https://atelierbrzozowski.com/
- **Screenshot:** `atelier-brzozowski.jpg`
- **Character:** Cinematic amber-and-black glamour; a high-fashion editorial spread as a homepage.

**Borrow:**
- **The oversized bottom-anchored wordmark.** "ATELIER BRZOZOWSKI" set in a high-contrast display serif at
  roughly `clamp(3rem, 9vw, 8rem)`, two lines, pinned to the bottom-left and running nearly the full 1440px.
  The type overlaps the photograph — nothing is boxed off. Size alone establishes the hierarchy.
- **A distinctive display face with real character.** Note the flared, slightly art-nouveau A and R. One
  characterful display family plus one neutral sans is the whole type system; the personality lives entirely
  in the display face, so choosing a boring one collapses the design.
- **Warm monochrome grade over the photography.** The whole image is graded amber/sepia so the photo, the
  cream type, and the background read as one surface. Applying a single consistent grade is a cheap, reliable
  way to make mixed-quality client photos look like a set.
- **The `SINCE ————— 2012` rule.** A small-caps label, a long horizontal hairline, and a year on one baseline
  above the paragraph. Costs one flex row and adds instant establishment credibility.
- **Right-column paragraph at ~15px** balancing the giant left-column display type. Two columns, wildly
  different sizes, one baseline — the entire layout is that one contrast.

**Don't borrow:** near-black body copy on a dark amber field at small sizes — fine for the hero blurb, not
for a service list or price table.

## 4. ALICE Hair & Art — Scandinavian minimal, scattered grid

- **URL:** https://www.alicehairart.se/
- **Screenshot:** `alice-hair-art.jpg`
- **Character:** Stockholm concept studio; near-empty light grey canvas with small photographs floating in it.

**Borrow:**
- **Small images in a lot of empty space.** Four modest photographs (~250–370px) scattered at different
  heights across a pale grey (#efefef-ish) field, none of them full-bleed. The confidence of the empty space
  is the design. Use this when the client has few but good photos — it turns scarcity into an aesthetic.
- **All-uppercase letterspaced sans for absolutely everything.** No serif anywhere. Body copy runs ~12–13px
  uppercase with ~0.08em tracking in short 3–4 line blocks. Restraint carried to the extreme still reads
  expensive.
- **Three-part horizontal band as the structural device.** Wordmark + tagline (left), "HAIR" and "& ART"
  (center, split across a wide gap), address (right) all locked to one baseline across 1440px. That single
  aligned row is what stops the scatter from looking accidental.
- **Black-and-white and color photography mixed deliberately** — the b/w shots recede, the one color shot
  becomes the focal point without any accent color being introduced.
- **Footer-grade contact strip at the bottom of the first screen**: `INFO` / email / `@instagram` in three
  even columns, same 12px caps. Contact treated as typography, not as a form.

**Don't borrow:** the near-invisible low-contrast grey text over photographs (the address line), and the
overall information density — a local salon needs its services visible sooner than this.

## 5. Marco Ambrosi Concept Salon — dark minimal, staggered photo trio

- **URL:** https://marcoambrosi.salon/
- **Screenshot:** `marco-ambrosi.png`
- **Character:** Charcoal-and-terracotta Italian concept salon; quiet, confident, mostly empty.

**Borrow:**
- **Charcoal (#2b2b2b-ish) instead of pure black** as the page ground. Softer, more expensive, and it lets
  photographs sit on it without a hard edge. A dark salon page should almost never use #000.
- **One terracotta square in the top-right corner** holding the hamburger — the only saturated color on the
  screen. A single small color block against a neutral field is a complete accent strategy.
- **Staggered three-image row.** Three photos at different sizes, different vertical offsets, two of them
  bleeding off the left and right edges. Breaking the grid at the viewport edges reads as art direction;
  three equal centered cards read as a template.
- **Single sentence as the entire hero.** "Hair salon specializzato in extension e colore" — light-weight
  sans, ~3rem, centered, plenty of air above and below, no subheading and no button. When the sentence is
  specific enough (extensions and color), it does the positioning work a paragraph would.
- **Stencil-style stacked logotype** (MARCO / AMBROSI / CONCEPT SALON) in three tight left-aligned lines at
  small size — a compact identity block that needs no logo asset.

**Don't borrow:** the third-party review/trust badge floating in the bottom-right corner; it breaks the
composition and is the one visibly templated element on the page.

## 6. UNA — dark gradient art-direction, letterspaced wordmark

- **URL:** https://www.una-akl.com/
- **Screenshot:** `una-akl.png`
- **Character:** Auckland hair studio; a full-screen abstract purple-black haze with the name split across the base.

**Borrow:**
- **Wordmark split across the full viewport width.** `U —— N —— A`: three letters at roughly 8–10rem pushed
  to the far edges of the 1440px canvas with long horizontal rules filling the gaps between them, sitting on
  the bottom edge. For a short salon name this is a striking, easy-to-implement hero.
- **Abstract, heavily blurred imagery instead of a literal photo.** The hero is an unrecognizable soft-focus
  purple/black field. This is the one legitimate use of a gradient-like hero in the pack — it works because
  it is derived from a photograph, has real grain and asymmetry, and never repeats elsewhere on the page.
  A CSS `linear-gradient` would not read the same.
- **Minimal top bar with a rule before the CTA.** "MENU" far left; on the right a short horizontal line
  followed by "BOOK AN APPOINTMENT" in ~12px caps. The little connecting rule is what makes it feel designed.
- **Deep violet-to-near-black tonal range with white type only.** One hue, many values, no second color.

**Don't borrow:** the near-total absence of legible content above the fold — the entire first screen carries
one word and two links. Beautiful for an award submission, weak for a local business that needs to convert.

## 7. Antara Spa & Wellness — warm organic, curved sections

- **URL:** https://antaraspawellness.com/
- **Screenshot:** `antara-spa.png`
- **Character:** Forest-green and taupe spa retreat; soft, botanical, slow.

**Borrow:**
- **Edge-to-edge letterspaced hero wordmark.** "A n t a r a" in a light display serif at ~10rem with huge
  positive letterspacing, deliberately clipped at both viewport edges so the word runs past the screen.
  Letting type overflow the viewport is the cheapest way to signal intentional art direction.
- **The giant top-radius section break.** The green section below the hero has a ~50% border-radius on its
  top corners, forming a soft arch that overlaps the photo above it. One `border-radius` on one section is
  the whole "organic/wellness" visual language — far better than blob SVGs or wave dividers.
- **Italic display serif for the sub-headline.** Uppercase roman for the statement line, italic for the
  poetic line beneath, then 14px sans for the small caption. Three ranks in two families, clearly separated.
- **Deep desaturated green (#425e40-ish) with warm taupe/cream type.** Green + cream reads spa; green + white
  reads clinic. The warm off-white is doing real work.
- **A hairline header rule that runs through the logo mark**, splitting the top bar into labeled segments
  ("WELLNESS AND SPA RETREAT" / mark / "OUR MENU" / "CONTACT US"). Structured, editorial, not a floating pill.

**Don't borrow:** the background audio (note the mute toggle in the right rail) and the persistent floating
side controls. Never ship autoplaying sound on a client demo.

---

## Anti-patterns seen on typical cheap salon sites

Checked against the two rejected candidates found during this research — a Swiss salon whose award-winning
site has since been replaced by a stock-photo WordPress build, and two Copenhagen nail studios — plus the
usual template output. Avoid all of these:

- **The stock smiling woman.** A grinning model against a white or pale-blue studio backdrop, obviously not
  the actual salon, obviously licensed. Real premium sites use the real interior, real staff, real work — or
  an extreme crop that avoids the trope. Related: cartoon/vector illustrations of salon scenes.
- **Three identical service cards in a row**, each with a rounded icon or emoji, a two-word title, and a
  filler sentence. Real sites show work photography with a name and a price, or a plain typographic list.
- **The purple (or teal) gradient CTA pill**, repeated in the nav, the hero, mid-page and the footer. Premium
  salon sites use one quiet text link, sometimes with a hairline border, in a single accent color.
- **Poppins/Montserrat everywhere at one size.** No display face, no size contrast, no letterspaced caps —
  every heading is bold sans at 32px. The size and family contrast is the entire premium effect.
- **An autoplaying image carousel** with dots and arrows in the hero. Every reference here holds one still
  image and lets scroll do the work.
- **Walls of SEO body copy** ("your ultimate destination for professional and premium manicure care...")
  in centered paragraphs, plus a full-bleed hot-pink or pastel text block. Premium sites write 1–3 short
  lines and let the photography carry the rest.
- **A broken or overstuffed nav** — 10+ items wrapping onto two lines and overlapping the hero. Cap it at
  ~5 links plus one booking link.
