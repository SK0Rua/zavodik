'use client';

import { useRef } from 'react';
import { gsap, useGSAP, motionSafe } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface MagneticButtonProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  /** Max px the element travels toward the pointer. Keep small — 12-24. Default 16. */
  strength?: number;
  /** Pointer distance in px at which the pull begins. Default 90. */
  radius?: number;
  className?: string;
}

/**
 * A link that leans toward the cursor within a small radius.
 *
 * Deliberately modest: `strength` defaults to 16px because a button that flees
 * across the screen is a novelty, and the reference pack — notably — contains
 * almost no magnetic buttons at all. Use it on ONE element, normally the primary
 * CTA, or not at all.
 *
 * Renders an `<a>`, so it needs a real `href` (a phone or booking link from the
 * snapshot). Pointer tracking is bound only under a fine pointer, so touch
 * devices get an ordinary link and reduced motion disables the pull entirely.
 * The element never moves far enough to break its own hit target.
 */
export function MagneticButton({
  children,
  strength = 16,
  radius = 90,
  className,
  ...props
}: MagneticButtonProps) {
  const scope = useRef<HTMLAnchorElement>(null);

  useGSAP(
    () => {
      motionSafe(() => {
        const el = scope.current;
        // `(hover: hover) and (pointer: fine)` is the honest test for "has a
        // cursor"; width-based checks misclassify touch laptops both ways.
        if (!el || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

        const setX = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
        const setY = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });

        const onMove = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const dist = Math.hypot(dx, dy);

          if (dist > radius + Math.max(r.width, r.height) / 2) {
            setX(0);
            setY(0);
            return;
          }
          const pull = Math.min(1, 1 - dist / (radius * 2));
          setX(dx * pull * (strength / 40));
          setY(dy * pull * (strength / 40));
        };

        const onLeave = () => {
          setX(0);
          setY(0);
        };

        window.addEventListener('pointermove', onMove, { passive: true });
        el.addEventListener('pointerleave', onLeave);
        // Keyboard users never fire pointermove; make sure a focused element is
        // never left offset by a stale pointer position.
        el.addEventListener('blur', onLeave);

        return () => {
          window.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerleave', onLeave);
          el.removeEventListener('blur', onLeave);
        };
      });
    },
    { scope, dependencies: [strength, radius] },
  );

  return (
    <a
      ref={scope}
      {...props}
      className={cn(
        'inline-flex items-center justify-center will-change-transform',
        className,
      )}
    >
      {children}
    </a>
  );
}

export default MagneticButton;
