'use client';

import { gsap, ScrollTrigger, SplitText } from '@/lib/gsap';

/**
 * Idempotent GSAP plugin registration.
 *
 * `@/lib/gsap` already registers ScrollTrigger + SplitText at module scope, so
 * in practice importing anything from there is enough. This function exists for
 * the case where a component is written defensively or a builder agent copies a
 * snippet out of the GSAP docs that opens with a `registerPlugin` line: calling
 * it is free and cannot double-register (gsap.registerPlugin is itself
 * idempotent, and the guard below skips the call entirely after the first).
 *
 * Returns the registered namespace so it can be used as a one-liner:
 *
 *   const { gsap, ScrollTrigger } = gsapRegister();
 */
let registered = false;

export function gsapRegister() {
  if (typeof window !== 'undefined' && !registered) {
    gsap.registerPlugin(ScrollTrigger, SplitText);
    registered = true;
  }
  return { gsap, ScrollTrigger, SplitText };
}
