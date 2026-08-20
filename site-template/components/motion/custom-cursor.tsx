'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap, prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface CustomCursorProps {
  /** Dot diameter in px. Default 10. */
  size?: number;
  /** Diameter when over an interactive element. Default 44. */
  hoverSize?: number;
  /**
   * Mix the cursor with the page using `mix-blend-mode: difference`, so it is
   * visible on both light and dark grounds without a colour decision. Default true.
   */
  blend?: boolean;
  className?: string;
}

/**
 * Small dot cursor that grows over interactive elements.
 *
 * Worth knowing before reaching for this: essentially NONE of the seventeen
 * reference sites buys its polish with a custom cursor, and our demos are
 * frequently opened on a phone where it does not exist at all. Treat it as a
 * garnish on a desktop-led art direction, never as the wow mechanic.
 *
 * Safety rails baked in:
 *  - Never mounts on touch/coarse-pointer devices, or under reduced motion.
 *  - The NATIVE cursor is left alone (`cursor: none` is not applied globally) —
 *    hiding it and then failing to draw a replacement makes a page unusable, and
 *    that failure mode is not worth the effect.
 *  - `pointer-events: none`, `aria-hidden` — cannot intercept a click.
 */
export function CustomCursor({
  size = 10,
  hoverSize = 44,
  blend = true,
  className,
}: CustomCursorProps) {
  const [enabled, setEnabled] = useState(false);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    setEnabled(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const dot = dotRef.current;
    if (!dot) return;

    gsap.set(dot, { xPercent: -50, yPercent: -50, width: size, height: size });

    const setX = gsap.quickTo(dot, 'x', { duration: 0.18, ease: 'power3.out' });
    const setY = gsap.quickTo(dot, 'y', { duration: 0.18, ease: 'power3.out' });

    const onMove = (e: PointerEvent) => {
      setX(e.clientX);
      setY(e.clientY);
      gsap.to(dot, { opacity: 1, duration: 0.2 });
    };

    // Delegated so links rendered later still trigger the grow state.
    const interactive = 'a, button, [role="button"], input, select, textarea, summary';
    const onOver = (e: PointerEvent) => {
      const hit = (e.target as Element | null)?.closest?.(interactive);
      gsap.to(dot, { width: hit ? hoverSize : size, height: hit ? hoverSize : size, duration: 0.28, ease: 'power3.out' });
    };
    const onLeaveWindow = () => gsap.to(dot, { opacity: 0, duration: 0.2 });

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('pointerleave', onLeaveWindow);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerleave', onLeaveWindow);
    };
  }, [enabled, size, hoverSize]);

  if (!enabled) return null;

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed left-0 top-0 z-[90] rounded-full bg-foreground opacity-0',
        blend && 'mix-blend-difference',
        className,
      )}
    />
  );
}

export default CustomCursor;
