'use client';

import { useRef } from 'react';
import { gsap, useGSAP, motionSafe, useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface SplitScreenWipeProps {
  /** The panel underneath — visible once the seam has passed. */
  base: React.ReactNode;
  /** The panel on top — wiped away as the visitor scrolls. */
  overlay: React.ReactNode;
  /**
   * Caption that travels WITH the seam. In vero-studio it translates
   * horizontally as the seam moves rather than sitting still, which is the
   * detail that makes the transition read as one object instead of two.
   */
  caption?: React.ReactNode;
  /** Seam travel direction. 'left' wipes the overlay away to the left. Default 'left'. */
  direction?: 'left' | 'right';
  /** Section height while pinned. Default 'h-screen'. */
  className?: string;
  /** How much scroll the wipe consumes. Default '+=120%' (~1.2 viewports). */
  scrollDistance?: string;
  /** Draw a hairline on the seam. Default true. */
  showSeam?: boolean;
}

/**
 * Vertical split-screen transition between two full-bleed panels — the
 * vero-studio signature.
 *
 * Mechanically: the section pins, and a hard vertical seam travels across it
 * driven by scroll (`clip-path: inset()` scrubbed, `pin: true, scrub: 1`, over
 * ~1.2 viewports). Measured off the reference, the seam moves 44% -> 30% -> 16%
 * of viewport width across three frames — steady and linear, no easing.
 *
 * The edge is hard with no feather. Softening it turns the whole thing into a
 * cross-fade, which is not the effect.
 *
 * Reduced motion: nothing pins, nothing clips. Both panels render stacked
 * vertically at full height and the caption sits between them — a perfectly
 * readable two-panel section with no motion at all. This is why the fallback is
 * a layout branch rather than "the same thing but instant".
 *
 *   <SplitScreenWipe
 *     base={<KenBurnsImage src="/assets/after.jpg" alt="…" className="h-full" />}
 *     overlay={<div className="h-full bg-accent" />}
 *     caption={<p className="font-body text-xs uppercase tracking-[0.2em]">…</p>}
 *   />
 */
export function SplitScreenWipe({
  base,
  overlay,
  caption,
  direction = 'left',
  className,
  scrollDistance = '+=120%',
  showSeam = true,
}: SplitScreenWipeProps) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      motionSafe(() => {
        const section = scope.current;
        const overlayEl = section?.querySelector('[data-split-overlay]');
        const captionEl = section?.querySelector('[data-split-caption]');
        if (!section || !overlayEl) return;

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: section,
            start: 'top top',
            end: scrollDistance,
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        tl.fromTo(
          overlayEl,
          { clipPath: 'inset(0% 0% 0% 0%)' },
          {
            clipPath:
              direction === 'left' ? 'inset(0% 100% 0% 0%)' : 'inset(0% 0% 0% 100%)',
            ease: 'none',
          },
          0,
        );

        if (captionEl) {
          // Same timeline, same progress: the caption rides the seam.
          tl.fromTo(
            captionEl,
            { xPercent: 0 },
            { xPercent: direction === 'left' ? -110 : 110, ease: 'none' },
            0,
          );
        }
      });
    },
    { scope, dependencies: [direction, scrollDistance] },
  );

  // Reduced motion gets a genuine LAYOUT alternative, not the same markup with
  // the animation removed: with no wipe, an absolutely-positioned overlay would
  // simply cover the base panel forever. Stacked full-height panels show both.
  if (reduced) {
    return (
      <div ref={scope} className={cn('relative w-full', className)}>
        <div className="h-[60vh] w-full overflow-hidden">{overlay}</div>
        {caption && <div className="px-6 py-8 md:px-12">{caption}</div>}
        <div className="h-[60vh] w-full overflow-hidden">{base}</div>
      </div>
    );
  }

  return (
    <div ref={scope} className={cn('relative h-screen w-full overflow-hidden', className)}>
      <div className="absolute inset-0">{base}</div>

      <div data-split-overlay className="absolute inset-0 will-change-[clip-path]">
        {overlay}
        {showSeam && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-0 w-px bg-border',
              direction === 'left' ? 'right-0' : 'left-0',
            )}
          />
        )}
      </div>

      {caption && (
        <div
          data-split-caption
          className="pointer-events-none absolute bottom-10 left-6 z-10 max-w-lg will-change-transform md:bottom-16 md:left-12"
        >
          {caption}
        </div>
      )}
    </div>
  );
}

export default SplitScreenWipe;
