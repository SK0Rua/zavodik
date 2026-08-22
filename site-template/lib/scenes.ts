/**
 * Scene glue — the thin choreography layer over GSAP (MOTION-PLAN phase 3).
 *
 * The scene map in BUILD-TASK.md names scenes as {trigger, motion, handoff};
 * this file is the ONE place their global wiring lives, so every build gets
 * consistent easing, consistent scroll defaults and one load timeline instead
 * of re-invented per-component glue (which is where race bugs and «scattered
 * effects» came from). It is deliberately THIN: it wires triggers and tokens,
 * it does not design — what moves and how is the direction's decision.
 *
 * All helpers are reduced-motion-safe by construction: they run inside
 * `motionSafe`, so under `prefers-reduced-motion: reduce` nothing is created
 * and the page renders complete and static.
 */
import { gsap, ScrollTrigger, motionSafe } from '@/lib/gsap';

/**
 * The motion system tokens. The scene map's `system` line picks from these;
 * using one easing family and one duration scale across every scene is what
 * makes a page read as choreographed rather than decorated.
 */
export const EASE = {
  /** Default for entrances and reveals. */
  out: 'power2.out',
  /** For scrubbed, scroll-tied movement — linear feels mechanical, inOut breathes. */
  scrub: 'power1.inOut',
  /** For the one dramatic signature moment, if the direction calls for it. */
  expo: 'expo.out',
} as const;

/** Duration scale, seconds. Pick from the scale; do not invent 0.73s values. */
export const DUR = { xs: 0.3, s: 0.6, m: 0.9, l: 1.2 } as const;

/**
 * A scene that fires ONCE when its section enters the viewport.
 * `build` receives a timeline already tied to the trigger; add tweens to it.
 */
export function enterScene(
  section: string | Element,
  build: (tl: gsap.core.Timeline) => void,
  opts: { start?: string } = {},
): void {
  motionSafe(() => {
    const tl = gsap.timeline({
      defaults: { ease: EASE.out, duration: DUR.m },
      scrollTrigger: { trigger: section as gsap.DOMTarget, start: opts.start ?? 'top 78%', once: true },
    });
    build(tl);
  });
}

/**
 * A scene SCRUBBED to scroll progress across its section — the backbone of a
 * motion site. Progress 0 → 1 maps to the section traversing the viewport.
 */
export function scrubScene(
  section: string | Element,
  build: (tl: gsap.core.Timeline) => void,
  opts: { start?: string; end?: string } = {},
): void {
  motionSafe(() => {
    const tl = gsap.timeline({
      defaults: { ease: EASE.scrub },
      scrollTrigger: {
        trigger: section as gsap.DOMTarget,
        start: opts.start ?? 'top bottom',
        end: opts.end ?? 'bottom top',
        scrub: 0.6,
      },
    });
    build(tl);
  });
}

/**
 * A PINNED scene: the section holds while its internal timeline plays out over
 * `lengthVh` of scroll. One per page is usually the signature; two is a lot.
 */
export function pinScene(
  section: string | Element,
  build: (tl: gsap.core.Timeline) => void,
  opts: { lengthVh?: number } = {},
): void {
  motionSafe(() => {
    const tl = gsap.timeline({
      defaults: { ease: EASE.scrub },
      scrollTrigger: {
        trigger: section as gsap.DOMTarget,
        start: 'top top',
        end: `+=${opts.lengthVh ?? 120}%`,
        scrub: 0.6,
        pin: true,
        anticipatePin: 1,
      },
    });
    build(tl);
  });
}

/**
 * The one page-load timeline (the `load` trigger of the scene map). Everything
 * that enters on load belongs HERE, sequenced — five components each running
 * their own entrance is the «all at once» slop the ban-list names.
 */
export function loadScene(build: (tl: gsap.core.Timeline) => void): void {
  motionSafe(() => {
    const tl = gsap.timeline({ defaults: { ease: EASE.out, duration: DUR.m } });
    build(tl);
  });
}

/** Refresh triggers after images/fonts settle layout — call once after mount. */
export function refreshScenes(): void {
  ScrollTrigger.refresh();
}
