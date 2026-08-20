'use client';

import { useRef } from 'react';
import { gsap, useGSAP, motionSafe } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type KenBurnsDirection = 'in' | 'out' | 'left' | 'right' | 'up' | 'down';

export interface KenBurnsImageProps {
  /** Path under public/, e.g. '/assets/interior.jpg'. Real business photo only. */
  src: string;
  /** Meaningful alt in the site language. Empty string only if truly decorative. */
  alt: string;
  /**
   * 'in'  — slow push in (the classic).
   * 'out' — starts slightly zoomed and settles back (izanami's variant; the
   *         calmer of the two, and the one that suits "quiet luxury").
   * left/right/up/down — zoomed in throughout, drifting laterally.
   * Default 'in'.
   */
  direction?: KenBurnsDirection;
  /** Seconds for one pass. 12-30 is the useful band; below 8 reads as a zoom effect rather than atmosphere. Default 20. */
  duration?: number;
  /** Peak scale. Keep under 1.12 or edge softness becomes visible. Default 1.08. */
  scale?: number;
  /** Loop back and forth forever instead of holding at the end. Default false. */
  loop?: boolean;
  /** Class on the clipping wrapper (set the aspect/height here). */
  className?: string;
  /** Class on the <img> itself — this is where a `.grade-*` utility goes. */
  imageClassName?: string;
  /** Intrinsic pixel size. Always pass both: prevents layout shift on load. */
  width?: number;
  height?: number;
  /** Skip lazy-loading for an above-the-fold hero image. Default false. */
  priority?: boolean;
}

/**
 * Slow scale/pan on a still photograph — what makes one image feel cinematic.
 *
 * Seen in izanami, mont-fort, ellmerers-hof, siena-film. In izanami it is a
 * ~30s settle from 1.06 back to 1.0 with `ease: 'none'`, which is why the
 * default here is deliberately slow and linear: an eased Ken Burns has a
 * visible "arrival" and stops feeling ambient.
 *
 * Reduced motion: the tween never runs (motionSafe), so the photo simply sits
 * static at its natural scale. Nothing is hidden.
 *
 *   <KenBurnsImage
 *     src="/assets/interior.jpg"
 *     alt="Ο χώρος του κομμωτηρίου"
 *     direction="out"
 *     duration={26}
 *     className="h-[70vh] w-full"
 *     imageClassName="grade-warm"
 *     width={2400} height={1600} priority
 *   />
 */
export function KenBurnsImage({
  src,
  alt,
  direction = 'in',
  duration = 20,
  scale = 1.08,
  loop = false,
  className,
  imageClassName,
  width,
  height,
  priority = false,
}: KenBurnsImageProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      motionSafe(() => {
        const img = scope.current?.querySelector('[data-kenburns-img]');
        if (!img) return;

        // Pan distance is expressed in % of the element, and only ever within
        // the overscan the scale already bought us — so no edge can slide into
        // frame. At scale 1.08 the safe travel is ~ (1.08-1)/2 = 4%.
        const travel = ((scale - 1) / 2) * 100;

        const from: gsap.TweenVars = { scale, xPercent: 0, yPercent: 0 };
        const to: gsap.TweenVars = { scale, xPercent: 0, yPercent: 0 };

        switch (direction) {
          case 'in':
            from.scale = 1;
            to.scale = scale;
            break;
          case 'out':
            from.scale = scale;
            to.scale = 1;
            break;
          case 'left':
            from.xPercent = travel;
            to.xPercent = -travel;
            break;
          case 'right':
            from.xPercent = -travel;
            to.xPercent = travel;
            break;
          case 'up':
            from.yPercent = travel;
            to.yPercent = -travel;
            break;
          case 'down':
            from.yPercent = -travel;
            to.yPercent = travel;
            break;
        }

        gsap.fromTo(img, from, {
          ...to,
          duration,
          // Linear on purpose: an eased zoom has a perceptible start and stop.
          ease: 'none',
          repeat: loop ? -1 : 0,
          yoyo: loop,
        });
      });
    },
    { scope, dependencies: [direction, duration, scale, loop] },
  );

  return (
    <div ref={scope} className={cn('relative overflow-hidden', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-kenburns-img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // `will-change: transform` keeps the long tween off the main-thread
        // paint path; without it a 20s scale repaints the whole image.
        className={cn('h-full w-full object-cover will-change-transform', imageClassName)}
      />
    </div>
  );
}

export default KenBurnsImage;
