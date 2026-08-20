'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Lenis smooth scroll, wired into the GSAP ticker so ScrollTrigger stays in
 * sync (the two fight each other if they run on separate RAF loops).
 *
 * Disabled entirely when the visitor prefers reduced motion — native scrolling
 * is left untouched in that case.
 *
 * Wrap the page body once, in app/layout.tsx:
 *   <SmoothScroll>{children}</SmoothScroll>
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      duration: 1.05,
      // Gentle exponential ease-out. Anything slower reads as laggy, not smooth.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Never hijack touch scrolling: it breaks the feel on mobile.
      syncTouch: false,
    });

    lenis.on('scroll', ScrollTrigger.update);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}

export default SmoothScroll;
