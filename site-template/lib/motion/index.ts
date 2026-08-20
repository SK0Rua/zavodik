'use client';

/**
 * MOTION PACK — single import surface.
 *
 * Everything the components in `components/motion/` need, re-exported from one
 * place so a page never has to remember whether `motionSafe` lives in
 * `@/lib/gsap` or `@/lib/motion`:
 *
 *   import { gsap, ScrollTrigger, motionSafe, useReducedMotion } from '@/lib/motion';
 *
 * These are RE-EXPORTS, not copies. `lib/gsap.ts` remains the single GSAP
 * plugin-registration point and `lib/use-reduced-motion.ts` remains the single
 * reduced-motion hook — duplicating either would double-register plugins or
 * give two components disagreeing answers about the same media query.
 */

export { gsap, ScrollTrigger, SplitText, useGSAP, motionSafe } from '@/lib/gsap';
export { useReducedMotion, prefersReducedMotion } from '@/lib/use-reduced-motion';
export { gsapRegister } from './gsap-register';
export { useInView } from './use-in-view';
