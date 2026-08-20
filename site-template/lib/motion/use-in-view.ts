'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseInViewOptions {
  /** Fire once and stop observing. Default true. */
  once?: boolean;
  /** IntersectionObserver rootMargin, e.g. '-10% 0px'. Default '0px'. */
  rootMargin?: string;
  /** Visible fraction that counts as "in view". Default 0.2. */
  threshold?: number;
}

/**
 * IntersectionObserver as a hook, returning [ref, inView].
 *
 * Used by `VideoHero` to pause off-screen playback (a looping video that keeps
 * decoding behind the fold is the single biggest battery cost in the pack) and
 * available to any component that needs to know visibility without pulling in
 * motion/react's `useInView`.
 *
 * With `once: false` this reports both entering AND leaving the viewport, which
 * is what play/pause needs; motion/react's `useInView({ once: true })` cannot.
 *
 *   const [ref, inView] = useInView<HTMLVideoElement>({ once: false, threshold: 0.1 });
 *
 * Static-export note: returns `false` until after mount. Never gate RENDERING
 * of content on it — only playback or animation.
 */
export function useInView<T extends Element>({
  once = true,
  rootMargin = '0px',
  threshold = 0.2,
}: UseInViewOptions = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No IntersectionObserver (very old browser): assume visible so content
    // and playback are never withheld.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) observer.disconnect();
      },
      { rootMargin, threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [once, rootMargin, threshold]);

  return [ref, inView];
}
