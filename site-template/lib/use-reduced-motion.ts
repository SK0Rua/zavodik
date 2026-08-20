'use client';

import { useEffect, useState } from 'react';

/**
 * Reactive `prefers-reduced-motion` state.
 *
 * SSR/static-export note: this returns `false` on the server and on the first
 * client render, then corrects after mount. Never use it to decide whether to
 * RENDER content — only to decide whether to ANIMATE it. Gating content on this
 * causes hydration mismatch and, worse, hides content from reduced-motion users.
 *
 *   const reduced = useReducedMotion();
 *   <motion.div animate={reduced ? undefined : { y: 0, opacity: 1 }} />
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);

    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Non-reactive one-shot check, for imperative code (GSAP setup, Lenis init)
 * that runs once inside an effect and does not need to re-render.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
