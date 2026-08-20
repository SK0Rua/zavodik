'use client';

import { useId, useRef } from 'react';
import { gsap, ScrollTrigger, useGSAP, motionSafe } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type MaskWipeDirection = 'left' | 'right' | 'up' | 'down' | 'diagonal';

export interface MaskWipeProps {
  children: React.ReactNode;
  /** Edge the reveal travels FROM. 'left' means the content is revealed left-to-right. Default 'left'. */
  direction?: MaskWipeDirection;
  /**
   * 'once'  — plays through on entering the viewport, then stays revealed.
   * 'scrub' — the seam position IS the scroll position (vero-studio's split);
   *           the motion stops the instant scrolling does, which is what makes
   *           it feel physical rather than decorative.
   * Default 'once'.
   */
  mode?: 'once' | 'scrub';
  /** Ragged hand-torn edge instead of a straight one (serotoninn). Only with direction left/right. Default false. */
  torn?: boolean;
  /** Seconds, `mode: 'once'` only. Default 1.1. */
  duration?: number;
  /** GSAP ease, `mode: 'once'` only. Default 'power3.inOut'. */
  ease?: string;
  /** ScrollTrigger start. Default 'top 80%' (once) / 'top 70%' (scrub). */
  start?: string;
  /** ScrollTrigger end, `scrub` only. Default 'bottom 40%'. */
  end?: string;
  className?: string;
}

/**
 * Scroll-triggered clip-path reveal — the most-repeated motion mechanic in the
 * reference pack (vero-studio, serotoninn, beauty-in-stem, omr-beauty,
 * indigo-laboratory).
 *
 * One layer wipes over another on a HARD edge. The hardness is the whole point:
 * a feathered or faded edge reads as a generic fade-in, which is the mechanic
 * this component exists to replace.
 *
 * In vero-studio the seam is scrubbed — measured across three frames it travels
 * 44% -> 30% -> 16% of the viewport as the visitor scrolls — so `mode: 'scrub'`
 * reproduces that directly. `mode: 'once'` is the cheaper section-entrance use.
 *
 * The torn variant uses an SVG `clipPath` whose path wanders only ~±1% laterally
 * with fine whiskers: a hand-torn sheet, NOT a zig-zag. A coarse zig-zag reads
 * as a Bootstrap section divider.
 *
 * Reduced motion: `motionSafe` skips the tween AND the initial clip is never
 * applied (the element renders fully revealed from the start), so content is
 * never left clipped away waiting for a cancelled animation.
 *
 *   <MaskWipe direction="left" mode="scrub">
 *     <KenBurnsImage src="/assets/room.jpg" alt="…" className="h-[80vh]" />
 *   </MaskWipe>
 */
export function MaskWipe({
  children,
  direction = 'left',
  mode = 'once',
  torn = false,
  duration = 1.1,
  ease = 'power3.inOut',
  start,
  end = 'bottom 40%',
  className,
}: MaskWipeProps) {
  const scope = useRef<HTMLDivElement>(null);
  const rawId = useId();
  // useId() emits colons, which are invalid in a CSS url(#…) reference.
  const clipId = `tornclip-${rawId.replace(/:/g, '')}`;

  useGSAP(
    () => {
      motionSafe(() => {
        const el = scope.current?.querySelector('[data-maskwipe-inner]');
        if (!el) return;

        // insetFrom hides the element; insetTo reveals it fully. Written as
        // `inset()` percentages so it is resolution-independent.
        const insetFrom: Record<MaskWipeDirection, string> = {
          left: 'inset(0% 100% 0% 0%)',
          right: 'inset(0% 0% 0% 100%)',
          up: 'inset(100% 0% 0% 0%)',
          down: 'inset(0% 0% 100% 0%)',
          diagonal: 'polygon(0% 0%, 0% 0%, 0% 0%, 0% 0%)',
        };
        const insetTo: Record<MaskWipeDirection, string> = {
          left: 'inset(0% 0% 0% 0%)',
          right: 'inset(0% 0% 0% 0%)',
          up: 'inset(0% 0% 0% 0%)',
          down: 'inset(0% 0% 0% 0%)',
          diagonal: 'polygon(0% 0%, 140% 0%, 0% 140%, 0% 0%)',
        };

        // The torn variant clips via the SVG path, so the inset tween would
        // fight it. Fade + travel the inner layer instead, keeping the ragged
        // silhouette intact throughout.
        if (torn) {
          gsap.fromTo(
            el,
            { xPercent: direction === 'right' ? 8 : -8, opacity: 0 },
            {
              xPercent: 0,
              opacity: 1,
              duration,
              ease,
              scrollTrigger:
                mode === 'scrub'
                  ? { trigger: scope.current, start: start ?? 'top 70%', end, scrub: 1 }
                  : { trigger: scope.current, start: start ?? 'top 80%', once: true },
            },
          );
          return;
        }

        gsap.fromTo(
          el,
          { clipPath: insetFrom[direction] },
          {
            clipPath: insetTo[direction],
            duration,
            ease,
            scrollTrigger:
              mode === 'scrub'
                ? {
                    trigger: scope.current,
                    start: start ?? 'top 70%',
                    end,
                    // scrub: 1 adds ~1s of catch-up so the seam glides rather
                    // than snapping frame-for-frame with the wheel.
                    scrub: 1,
                  }
                : { trigger: scope.current, start: start ?? 'top 80%', once: true },
          },
        );
      });

      // A wipe changes the height of nothing, but images inside it commonly
      // finish decoding after ScrollTrigger measured the page.
      ScrollTrigger.refresh();
    },
    { scope, dependencies: [direction, mode, torn, duration, ease, start, end] },
  );

  return (
    <div ref={scope} className={cn('relative', className)}>
      {torn && (
        <svg aria-hidden="true" className="absolute h-0 w-0" focusable="false">
          <defs>
            {/* objectBoundingBox units: the path is authored 0-1 and stretches
                to whatever the element's box is. The lateral wander stays
                within ~1% so it reads as a torn sheet edge, not a saw. */}
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path
                d={
                  direction === 'right'
                    ? 'M0.012,0 L1,0 L1,1 L0.008,1 C0.019,0.93 0.004,0.87 0.014,0.8 C0.023,0.73 0.006,0.67 0.016,0.6 C0.025,0.53 0.005,0.47 0.015,0.4 C0.024,0.33 0.007,0.27 0.017,0.2 C0.026,0.13 0.006,0.07 0.012,0 Z'
                    : 'M0,0 L0.988,0 C0.981,0.07 0.997,0.13 0.986,0.2 C0.976,0.27 0.994,0.33 0.984,0.4 C0.975,0.47 0.996,0.53 0.985,0.6 C0.975,0.67 0.993,0.73 0.983,0.8 C0.974,0.87 0.99,0.93 0.988,1 L0,1 Z'
                }
              />
            </clipPath>
          </defs>
        </svg>
      )}

      <div
        data-maskwipe-inner
        // will-change hints the compositor before the first scrub frame; without
        // it the first seam movement drops frames on mid-range Android.
        className="h-full w-full will-change-[clip-path,transform]"
        style={torn ? { clipPath: `url(#${clipId})` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export default MaskWipe;
