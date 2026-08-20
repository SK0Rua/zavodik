# Serotoninn — fashion e-commerce, "where glam meets grunge"

- **URL:** https://serotoninn.com/
- **Captured:** 2026-08-18 (desktop 1440x900, mobile 390x844)
- **Mood:** editorial, high-contrast, gritty-luxury
- **Award:** Awwwards SOTD + E-commerce Honors + Developer Award, Aug 4 2026, by BL/S

## What makes the wow
- Signature mechanic: a torn-paper vertical split across the hero model photo. The same portrait is shown twice — a full-color/warm-tone half on the left and a desaturated/grayscale half on the right — divided by a jagged, hand-torn-paper edge (not a straight line) running down the middle of the frame. The tear has visible paper-fiber whiskers along the edge. This split persists as the primary hero device across at least 3 different product photos during the scroll (strapless black gown, navy shirt-dress, "BEAUTY WILL SAVE THE WORLD" section) — it's a reusable image treatment, not a one-off.
- Headline "WHERE GLAM MEETS GRUNGE" sits right-aligned next to the split image, in heavy bold caps, static (no visible per-character animation caught in sampled frames, but a "NEW DROP" label to "QUARPA CAPSULE" label swap happens as the user scrolls past the second hero-style image, suggesting either a content swap on scroll or a second full-bleed hero repeats the mechanic mid-page).
- Preloader is a percentage counter ("LOADING" + "00%" → "16%" → "50%" → "83%" → "100%") that ticks up over roughly 2-3s while a jagged vertical tear line is already visible splitting the loading screen itself into cream/white halves — the torn-edge motif starts before the page even finishes loading, reinforcing it as the brand's core visual signature rather than just a hero gimmick.
- Footer treatment reuses and rotates the tear: the giant wordmark "SEROTONINN" spans full width and is torn/masked HORIZONTALLY this time — a dark editorial photo (two figures in shadow) occupies the top portion and tears down into the wordmark + "SUBSCRIBE (LATEST NEWS)" email capture below, with a red "DISCOUNT" coupon-style scratched-out UI chip sitting mid-page as a floating badge.
- Red accent labels ("NEW DROP", "QUARPA CAPSULE", "DISCOUNT") consistently mark promotional/CTA content against an otherwise black/white/cream palette — the red is used sparingly and always for "look here, buy this" signaling.
- Product grid section (3-up dress photos with price/SKU labels) breaks from the torn-image language entirely — plain white background, clean editorial product shots, ordinary e-commerce grid — showing the brand deliberately reserves the torn-paper effect for narrative/hero moments only, not routine catalog browsing.

## Timing & easing
Preloader percentage ticks in visible discrete jumps (0/16/50/83/100 sampled) over roughly 2-3s — feels like a fast eased count-up rather than frame-accurate linear. The torn-edge split itself appears to be a static masked image (two photo layers with a jagged clip-path/SVG mask) rather than an animated tear-in; no evidence in sampled frames of the tear line drawing itself progressively. Section-to-section scroll transitions were not caught mid-motion in the sampled frames — cuts between hero/product-grid/video/footer look like standard scroll reveals without an unusual pinning/scrub signature.

## Typography
Heavy bold grotesque/condensed sans in all caps for headlines and the giant wordmark (very tight tracking, thick strokes) — matches the "grunge" side of the brand promise. Small-caps/uppercase micro-labels (MENU, SHOP ALL, CATEGORIES, SEARCH, BAG.0, FAVORITES.0) in a lighter-weight monospace-leaning sans for nav/utility text. The red promo labels use the same heavy caps treatment as the main headline, just recolored.

## Palette
- Background: warm off-white/cream `~#F5F0EA` and neutral light grey `~#C8C8C8`
- Primary text/UI: near-black `~#111111`
- Accent (only real color in the system): red `~#EC3934` — used exclusively for promo/CTA labels (NEW DROP, QUARPA CAPSULE, DISCOUNT)
- Model photography split: warm/skin-tone side `~#F5C6B4` vs desaturated grey side `~#CDCDCD`
- Accent count: 1 (red) — everything else is a strict black/white/cream/grey editorial palette, making the single red pop hard.

## Layout rhythm & photo treatment
Hero uses a large single full-height portrait as the centerpiece with the torn-mask device; this repeats at least twice more down the page (second hero-style banner, and the footer). Between these hero moments the page breaks into conventional e-commerce patterns: a plain white product grid (3-up cards, price + SKU under each), a dark cinematic video/lifestyle clip section, and a "NEW DROP"/"SALE" category tease block. Photography style is high-fashion editorial — posed studio shots with hard flash-lit contrast, styled sunglasses/props (red cat-eye sunglasses recur), not lifestyle/candid. The torn-mask treatment is reserved for narrative hero beats; routine shopping UI stays clean and unadorned.

## Mobile behaviour
Mobile keeps the identical preloader (LOADING / percentage / torn line) and the same torn vertical-split hero treatment, just reflowed to full width with the headline stacking below rather than beside the image. Cookie consent banner appears as an overlay early (both desktop and mobile). Product category teasers ("NEW DROP" / "SALE") stack as two side-by-side thumbnail tiles below the hero on mobile rather than a full grid. Footer wordmark + torn-photo + subscribe block reflows to full-width stacked sections, same visual language, same red "DISCOUNT" chip. No evidence of the effect being simplified or removed for touch — full parity with desktop.

## Performance notes
Both webm captures are small (788KB desktop, 482KB mobile) relative to lama-lama, consistent with a page built mostly from static photography plus CSS/SVG masking rather than heavy video loops — a good sign this mechanic is comparatively cheap to reproduce. The one video/cinematic section (dark shadowy figures clip) is the only detected motion-video asset.

## Reproduce with our stack
- Torn-paper split-image mask: build as a static SVG `clip-path` (jagged polygon path) applied via CSS to two stacked `<img>` layers (color version + `filter: grayscale(1)` version) of the same photo — fully achievable with plain CSS/SVG, no animation library needed for the mask itself since it reads as static in captured frames.
- Percentage-counter preloader: `NumberTicker` (pool component) for the 0→100% count, gated by a simple `motion` `AnimatePresence` fade-out of the loading screen once assets are ready.
- Red promo label swap ("NEW DROP" → "QUARPA CAPSULE"): GSAP `ScrollTrigger` with a simple text-swap (or `TextAnimate` pool component) firing once the user scrolls a second hero panel into view — small trigger range, no scrub needed, a discrete toggle at a scroll threshold.
- Footer giant-wordmark-torn-by-photo: same jagged clip-path technique as hero, applied horizontally this time, with the wordmark as background text and the photo layer clipped to the torn shape.
- Product grid, promo chips (DISCOUNT): plain Tailwind grid + `ShimmerButton` or `BorderBeam` if a single micro-accent is wanted on a CTA — stay conservative, this brand's restraint (1 accent color, no more than 2 pool components used) is a virtue to copy.

## Gaps
- No ready-made "torn/ragged mask" utility in the vendored pool — must hand-author an SVG jagged-edge `clip-path` (a zig-zag or Bezier-noise path) once and reuse it as a shared asset; this is the single most valuable net-new primitive to build for local-business demos going for an editorial look.
- No grayscale/color split-portrait helper — straightforward CSS (`filter: grayscale()` + clip-path) but worth codifying as a reusable "SplitPortrait" pattern given how much mileage this brand gets from reusing one device three times.
- No SKU/price product-card component in the pool beyond generic `BentoGrid`/`MagicCard` — would need plain Tailwind cards, which is fine and cheap.

## Don't borrow
- The torn/grunge photographic treatment and heavy red-accent "drop culture" urgency language (NEW DROP, DISCOUNT scratched coupon) is streetwear/fast-fashion energy — wrong tone for a Patras taverna, spa, or salon where warmth and trust read better than edge and urgency.
- Full e-commerce chrome (bag/favorites/search icons, SKU grids, cart flows) is irrelevant scope for a single-location local-business demo site — do not import the shopping UI, only the visual/motion language.
- The near-black-and-white restraint with one red pop works because this is a fashion brand; most Patras local-business briefs (beauty, food) will want warmer, more literal photography rather than editorial studio-flash portraiture.
