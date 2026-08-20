'use client';

import { useRef } from 'react';
import { gsap, ScrollTrigger, useGSAP } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface HorizontalRailProps {
  /**
   * The panels. Give them DIFFERENT widths — special-production's rail runs
   * mixed aspect ratios in one row and never a uniform grid, which is most of
   * why it does not read as a carousel.
   */
  children: React.ReactNode;
  /**
   * Scale panels as they cross the viewport centre (special-production's cards
   * grow from ~0.8 to 1.0 at centre). Default false — it is a strong effect and
   * competes with anything else on the page.
   */
  scaleAtCentre?: boolean;
  /** Minimum scale at the edges when `scaleAtCentre`. Default 0.86. */
  minScale?: number;
  /** Gap between panels (Tailwind class). Default 'gap-4 md:gap-8'. */
  gapClassName?: string;
  /** Below this width, pinning is replaced by native snap-scroll. Default 768. */
  mobileBreakpoint?: number;
  className?: string;
  /** Class on the moving track. */
  trackClassName?: string;
}

/**
 * Vertical scroll drives horizontal motion — pinned rail (special-production,
 * floema, omr-beauty mobile, siena-film).
 *
 * The canonical GSAP pin + scrub pattern, which is fiddly enough that it should
 * be written once rather than re-derived per build: the `end` distance has to be
 * recomputed from `scrollWidth` on every resize, or the rail either stops short
 * or leaves dead scroll at the bottom.
 *
 * `gsap.matchMedia()` handles both branches AND reduced motion in one place:
 *  - desktop, motion allowed -> pin + scrub;
 *  - narrow OR reduced motion -> no pin at all, native `overflow-x: auto` with
 *    `scroll-snap-type: x mandatory`. Pinning on a touch device feels broken,
 *    and hijacking scroll under reduced motion is exactly what that preference
 *    is asking you not to do.
 *
 * The panels are always laid out horizontally in the DOM, so the fallback needs
 * no alternate markup and nothing is ever hidden.
 *
 *   <HorizontalRail scaleAtCentre>
 *     <div className="w-[70vw] md:w-[36vw] shrink-0">…</div>
 *     <div className="w-[80vw] md:w-[48vw] shrink-0">…</div>
 *   </HorizontalRail>
 */
export function HorizontalRail({
  children,
  scaleAtCentre = false,
  minScale = 0.86,
  gapClassName = 'gap-4 md:gap-8',
  mobileBreakpoint = 768,
  className,
  trackClassName,
}: HorizontalRailProps) {
  const scope = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(
        `(min-width: ${mobileBreakpoint}px) and (prefers-reduced-motion: no-preference)`,
        () => {
          const track = trackRef.current;
          const section = scope.current;
          if (!track || !section) return;

          // Overflow must be visible while pinned or the translated track gets
          // clipped by its own scroll container.
          track.style.overflowX = 'visible';

          const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);

          const tween = gsap.to(track, {
            x: () => -distance(),
            ease: 'none',
            scrollTrigger: {
              trigger: section,
              pin: true,
              scrub: 1,
              // Function form is re-evaluated by invalidateOnRefresh, which is
              // what keeps the scroll distance correct across resize and after
              // late-loading images change scrollWidth.
              end: () => `+=${distance()}`,
              invalidateOnRefresh: true,
              anticipatePin: 1,
            },
          });

          if (scaleAtCentre) {
            const panels = gsap.utils.toArray<HTMLElement>('[data-rail-panel]', track);
            panels.forEach((panel) => {
              gsap.fromTo(
                panel,
                { scale: minScale },
                {
                  scale: 1,
                  ease: 'none',
                  scrollTrigger: {
                    trigger: panel,
                    // containerAnimation is what lets a ScrollTrigger measure a
                    // panel that is moving horizontally inside another tween.
                    containerAnimation: tween,
                    start: 'left right',
                    end: 'center center',
                    scrub: true,
                  },
                },
              );
              gsap.fromTo(
                panel,
                { scale: 1 },
                {
                  scale: minScale,
                  ease: 'none',
                  scrollTrigger: {
                    trigger: panel,
                    containerAnimation: tween,
                    start: 'center center',
                    end: 'right left',
                    scrub: true,
                  },
                },
              );
            });
          }

          return () => {
            track.style.overflowX = '';
          };
        },
      );

      // Late-decoding images inside the panels change scrollWidth after the
      // first measurement.
      const onLoad = () => ScrollTrigger.refresh();
      window.addEventListener('load', onLoad, { once: true });

      return () => {
        window.removeEventListener('load', onLoad);
        mm.revert();
      };
    },
    { scope, dependencies: [scaleAtCentre, minScale, mobileBreakpoint] },
  );

  return (
    <section ref={scope} className={cn('relative overflow-hidden', className)}>
      <div
        ref={trackRef}
        className={cn(
          'flex w-max flex-nowrap items-center',
          // Mobile / reduced-motion fallback. Overridden imperatively when the
          // pinned branch takes over.
          'max-w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          gapClassName,
          trackClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One panel of a `HorizontalRail`. Only needed when `scaleAtCentre` is on (it
 * carries the marker attribute), but it also applies the snap alignment the
 * mobile fallback needs, so prefer it always.
 */
export function RailPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-rail-panel className={cn('shrink-0 snap-center', className)}>
      {children}
    </div>
  );
}

export default HorizontalRail;
