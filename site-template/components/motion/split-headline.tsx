'use client';

import { useRef } from 'react';
import { gsap, SplitText, useGSAP, motionSafe } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface SplitHeadlineProps {
  /**
   * The headline. May contain markup — mix roman and italic with plain spans:
   *
   *   <SplitHeadline as="h1">
   *     <span className="italic">where</span> INNOVATION<br />
   *     <span className="italic">meets</span> CRAFTSMANSHIP
   *   </SplitHeadline>
   *
   * SplitText preserves the inline elements, so the italic spans survive the
   * split and animate with their line.
   */
  children: React.ReactNode;
  /** Element to render. Default 'h2'. Exactly one <h1> per page. */
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'div';
  /**
   * Granularity. 'lines' is the reference behaviour (vero-studio animates whole
   * lines rising behind an overflow mask) and is also the safest: per-character
   * splitting of Greek text produces a lot of DOM and can break shaping.
   * Default 'lines'.
   */
  by?: 'chars' | 'words' | 'lines';
  /** Seconds per unit. Default 0.9. */
  duration?: number;
  /** Seconds between units. 0.06-0.12 is the house band. Default 0.08. */
  stagger?: number;
  /** Extra seconds before the first unit moves. Default 0. */
  delay?: number;
  /** GSAP ease. Default 'power3.out' — nothing in the pack overshoots or bounces. */
  ease?: string;
  /** ScrollTrigger start. Default 'top 80%'. Pass null to play immediately on mount (hero). */
  start?: string | null;
  className?: string;
}

/**
 * Masked stagger reveal on a headline, via GSAP SplitText.
 *
 * SplitText became free for commercial use with the Webflow acquisition and
 * ships inside the public `gsap` package — `@/lib/gsap` already registers it,
 * no auth token and no private registry.
 *
 * vero-studio is the model: split BY LINE, each line wrapped in its own
 * `overflow: hidden` row (SplitText does this itself with `mask: 'lines'`) and
 * rising from `y: 100%` with `stagger: 0.08`, `duration: 0.9`,
 * `ease: 'power3.out'`, once. The roman/italic mixing that makes that headline
 * distinctive is markup, not animation — pass italic spans as children and they
 * survive the split.
 *
 * Reduced motion: the split never happens and the headline renders as plain
 * static text. That is deliberate — leaving a SplitText headline at y: 100%
 * behind a mask would hide it entirely, the exact trap DESIGN.md §6 warns about.
 *
 * Greek note: use a family that HAS an italic. GFS Didot does not; EB Garamond
 * does, which is why it is the Greek pick for italic-led art direction.
 */
export function SplitHeadline({
  children,
  as: Tag = 'h2',
  by = 'lines',
  duration = 0.9,
  stagger = 0.08,
  delay = 0,
  ease = 'power3.out',
  start = 'top 80%',
  className,
}: SplitHeadlineProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      motionSafe(() => {
        const target = scope.current?.querySelector('[data-split-target]');
        if (!target) return;

        const split = SplitText.create(target as HTMLElement, {
          type: by,
          // `mask` wraps each unit in an overflow-hidden parent, which is what
          // makes the units rise from BEHIND an edge rather than just sliding.
          mask: by,
          // Keeps the headline as one string for assistive tech instead of a
          // pile of per-character spans.
          aria: 'auto',
        });

        const targets =
          by === 'chars' ? split.chars : by === 'words' ? split.words : split.lines;
        if (!targets || targets.length === 0) return;

        gsap.from(targets, {
          yPercent: 110,
          duration,
          delay,
          ease,
          stagger,
          scrollTrigger: start ? { trigger: scope.current, start, once: true } : undefined,
        });

        // Returning the revert puts the DOM back exactly as React rendered it
        // when matchMedia reverts or the component unmounts — without this,
        // React and SplitText fight over the same nodes.
        return () => split.revert();
      });
    },
    { scope, dependencies: [by, duration, stagger, delay, ease, start] },
  );

  return (
    <div ref={scope} className={className}>
      <Tag data-split-target className={cn('m-0')}>
        {children}
      </Tag>
    </div>
  );
}

export default SplitHeadline;
