'use client';

/**
 * Central GSAP entry point. Import from here, never from 'gsap' directly, so
 * plugin registration happens exactly once.
 *
 * All GSAP plugins are free for commercial use (GreenSock/Webflow, 2025) and
 * ship inside the public `gsap` npm package — no auth token, no private registry.
 *
 *   import { gsap, ScrollTrigger, SplitText } from '@/lib/gsap';
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
}

export { gsap, ScrollTrigger, SplitText, useGSAP };

/**
 * Run motion only when the visitor allows it.
 *
 * gsap.matchMedia() handles the reduced-motion branch natively and cleans up
 * every animation created inside the callback on revert, which is exactly what
 * React needs on unmount.
 *
 *   useGSAP(() => {
 *     motionSafe((mm) => {
 *       gsap.from('.hero-line', { y: 40, opacity: 0, stagger: 0.08 });
 *     });
 *   }, { scope: container });
 */
export function motionSafe(fn: (context: gsap.Context) => void): gsap.MatchMedia {
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', (context) => {
    fn(context);
  });
  return mm;
}
