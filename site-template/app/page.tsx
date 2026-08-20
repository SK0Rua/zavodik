'use client';

/* ==========================================================================
 * STARTER PAGE — the builder agent REPLACES this file entirely.
 *
 * What this is: a working salon-landing skeleton that wires up a
 * representative slice of components/motion/ and components/ui/ so the
 * template build always exercises both. Use it as a reference for how the
 * components compose and what their props look like — then write the real page.
 *
 * EVERY string below is placeholder copy, marked PLACEHOLDER. None of it may
 * survive into a real demo site. Real copy comes from input/snapshot.json and
 * input/brief.json ONLY (SPEC §5 — no fact without a source). Likewise every
 * `/assets/placeholder-*.jpg` is an abstract colour field, not a photograph:
 * delete them and use real business photos.
 *
 * This skeleton also is NOT a layout to copy verbatim. Shipping this exact
 * section order for every business is the template-sameness failure DESIGN.md
 * warns about. Note that this page deliberately uses MORE motion mechanics than
 * any real build should — it is a test harness. DESIGN.md §10 caps a real page
 * at 3-4. Read references/motion/README.md and input/design.json, then compose
 * something specific to this business.
 * ========================================================================== */

import { BlurFade } from '@/components/ui/blur-fade';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Marquee } from '@/components/ui/marquee';
import {
  VideoHero,
  KenBurnsImage,
  SpecTags,
  MaskWipe,
  SplitHeadline,
  HorizontalRail,
  RailPanel,
  SplitScreenWipe,
  Preloader,
  MagneticButton,
} from '@/components/motion';

const PLACEHOLDER_SPECS = [
  { label: 'PLACEHOLDER — service one' },
  { label: 'PLACEHOLDER — service two' },
  { label: 'PLACEHOLDER — a longer service name that wraps' },
  { label: 'PLACEHOLDER — service four' },
  { label: 'PLACEHOLDER — service five' },
];

const PLACEHOLDER_PRICED = [
  { label: 'PLACEHOLDER — service', value: '00 €', note: 'PLACEHOLDER — only when the snapshot proves a duration or detail.' },
  { label: 'PLACEHOLDER — service', value: '00 €' },
  { label: 'PLACEHOLDER — service', value: '00 €' },
  { label: 'PLACEHOLDER — service', value: '00 €' },
];

const PLACEHOLDER_RAIL = [
  { src: '/assets/placeholder-01.jpg', label: 'PLACEHOLDER — caption', width: 'w-[68vw] md:w-[32vw]' },
  { src: '/assets/placeholder-02.jpg', label: 'PLACEHOLDER — caption', width: 'w-[80vw] md:w-[44vw]' },
  { src: '/assets/placeholder-03.jpg', label: 'PLACEHOLDER — caption', width: 'w-[62vw] md:w-[26vw]' },
  { src: '/assets/placeholder-04.jpg', label: 'PLACEHOLDER — caption', width: 'w-[86vw] md:w-[40vw]' },
];

export default function Home() {
  return (
    <>
      {/* Capped at 1.2s, skipped under reduced motion and on repeat visits in
          the same tab. See components/motion/preloader.tsx. */}
      <Preloader wordmark="PLACEHOLDER" caption="PLACEHOLDER — city, discipline" />

      <main className="relative min-h-screen bg-background text-foreground">
        {/* -------------------------------------------------------------- HERO
            No `sources` here, so VideoHero falls back to a Ken Burns move on the
            poster — which is exactly what happens for a business with no usable
            footage. Pass sources={[{src:'/assets/hero.webm',type:'video/webm'}]}
            when real footage exists. */}
        <VideoHero
          poster="/assets/placeholder-hero.jpg"
          posterAlt=""
          overlay="gradient"
          overlayOpacity={0.55}
          gradeClassName="grade-warm"
        >
          <p className="mb-6 font-body text-[0.6875rem] uppercase tracking-[0.28em] text-white/70">
            PLACEHOLDER — city, discipline
          </p>
          <SplitHeadline
            as="h1"
            by="lines"
            start={null}
            className="max-w-4xl text-white"
          >
            <span className="block font-display text-[clamp(2.75rem,9vw,7rem)] font-light leading-[0.92] tracking-[-0.03em]">
              PLACEHOLDER
            </span>
            <span className="block font-display text-[clamp(2.75rem,9vw,7rem)] font-light italic leading-[0.92] tracking-[-0.03em]">
              business name
            </span>
          </SplitHeadline>

          <div className="mt-10 flex flex-wrap items-center gap-6">
            <MagneticButton
              href="tel:+000000000"
              className="rounded-full border border-white/40 px-8 py-3 font-body text-xs uppercase tracking-[0.16em] text-white transition-colors duration-300 hover:bg-white hover:text-black"
            >
              PLACEHOLDER — primary CTA
            </MagneticButton>
            <span className="font-body text-sm text-white/70">
              PLACEHOLDER — real phone from snapshot
            </span>
          </div>
        </VideoHero>

        {/* ---------------------------------------------------------- MARQUEE */}
        <section aria-hidden="true" className="border-y border-border py-6">
          <Marquee pauseOnHover className="[--duration:34s]">
            {['PLACEHOLDER ONE', 'PLACEHOLDER TWO', 'PLACEHOLDER THREE', 'PLACEHOLDER FOUR'].map(
              (word) => (
                <span
                  key={word}
                  className="mx-8 font-display text-2xl font-light tracking-tight text-muted md:text-4xl"
                >
                  {word}
                </span>
              ),
            )}
          </Marquee>
        </section>

        {/* ----------------------------------------------- SPEC TAGS + WIPE */}
        <section className="grid gap-12 px-6 py-24 md:grid-cols-[1fr_1fr] md:items-center md:gap-16 md:px-12 md:py-32 lg:px-20">
          <div>
            <SplitHeadline
              as="h2"
              by="lines"
              className="font-display text-[clamp(2rem,4.5vw,3.5rem)] font-light leading-[1.05] tracking-[-0.02em]"
            >
              <span className="italic">PLACEHOLDER</span> services heading
            </SplitHeadline>

            <div className="mt-10">
              <SpecTags caption="PLACEHOLDER — caption" items={PLACEHOLDER_SPECS} variant="pills" />
            </div>
            <div className="mt-12">
              <SpecTags items={PLACEHOLDER_PRICED} variant="list" />
            </div>
          </div>

          {/* Scrubbed clip-path reveal — the seam position IS the scroll
              position. See components/motion/mask-wipe.tsx. */}
          <MaskWipe direction="left" mode="scrub" className="h-[60vh] md:h-[76vh]">
            <KenBurnsImage
              src="/assets/placeholder-01.jpg"
              alt=""
              direction="out"
              duration={24}
              className="h-full w-full"
              imageClassName="grade-warm"
              width={1600}
              height={2000}
            />
          </MaskWipe>
        </section>

        {/* -------------------------------------------------- SPLIT-SCREEN */}
        <SplitScreenWipe
          base={
            <KenBurnsImage
              src="/assets/placeholder-02.jpg"
              alt=""
              direction="in"
              duration={28}
              className="h-full w-full"
              imageClassName="grade-cool"
            />
          }
          overlay={<div className="h-full w-full bg-accent" />}
          caption={
            <p className="font-body text-[0.6875rem] uppercase tracking-[0.2em] text-background">
              PLACEHOLDER — a line that travels with the seam
            </p>
          }
        />

        {/* ------------------------------------------------- HORIZONTAL RAIL */}
        <section className="py-24 md:py-32">
          <h2 className="mb-12 px-6 font-display text-[clamp(2rem,4.5vw,3.5rem)] font-light tracking-[-0.02em] md:px-12 lg:px-20">
            PLACEHOLDER — work heading
          </h2>
          <HorizontalRail scaleAtCentre gapClassName="gap-4 md:gap-10" className="px-6 md:px-12">
            {PLACEHOLDER_RAIL.map((item) => (
              <RailPanel key={item.src} className={item.width}>
                <KenBurnsImage
                  src={item.src}
                  alt=""
                  direction="left"
                  duration={30}
                  className="aspect-4/5 w-full"
                  imageClassName="grade-warm"
                />
                <p className="mt-3 font-body text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
                  {item.label}
                </p>
              </RailPanel>
            ))}
          </HorizontalRail>
        </section>

        {/* ------------------------------------------------------------ STATS */}
        <section className="border-y border-border px-6 py-20 md:px-12 lg:px-20">
          <dl className="grid gap-12 sm:grid-cols-3">
            {[
              { value: 12, label: 'PLACEHOLDER — only if snapshot proves it' },
              { value: 4.9, label: 'PLACEHOLDER — real rating', decimals: 1 },
              { value: 320, label: 'PLACEHOLDER — real review count' },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="font-display text-5xl font-light tracking-tight md:text-6xl">
                  <NumberTicker value={stat.value} decimalPlaces={stat.decimals ?? 0} />
                </dt>
                <dd className="mt-3 font-body text-sm text-muted">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ---------------------------------------------------------- CONTACT */}
        <section id="contact" className="px-6 py-28 md:px-12 lg:px-20">
          <BlurFade inView>
            <h2 className="max-w-3xl font-display text-[clamp(2rem,5vw,4rem)] font-light leading-[1.05] tracking-[-0.025em]">
              PLACEHOLDER — closing line
            </h2>
            <address className="mt-10 grid gap-8 font-body text-sm not-italic text-muted sm:grid-cols-3">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.2em] text-foreground">Address</p>
                <p>PLACEHOLDER — real address</p>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.2em] text-foreground">Phone</p>
                <p>PLACEHOLDER — real phone</p>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.2em] text-foreground">Hours</p>
                <p>PLACEHOLDER — real hours</p>
              </div>
            </address>
          </BlurFade>
        </section>

        <footer className="border-t border-border px-6 py-10 font-body text-xs text-muted md:px-12 lg:px-20">
          PLACEHOLDER — footer. This is a private demo (noindex).
        </footer>
      </main>
    </>
  );
}
