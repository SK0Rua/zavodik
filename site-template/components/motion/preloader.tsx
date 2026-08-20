'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap, prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface PreloaderProps {
  /** The wordmark — the real business name. Typeset large; this IS the first content. */
  wordmark: React.ReactNode;
  /** Optional micro-line under the wordmark, e.g. city + discipline. */
  caption?: string;
  /** Show the 0-100 counter. Default true. */
  showCounter?: boolean;
  /**
   * Hard cap in ms for the whole thing, exit included. The reference sites run
   * 2-9s; on a demo opened cold on 4G that reads as a broken site. Default 1200.
   * Do not raise this above ~1500.
   */
  maxDuration?: number;
  /** Exit wipe direction. Default 'up'. */
  exitDirection?: 'up' | 'down' | 'left' | 'right';
  /** Run once per browser tab (sessionStorage). Default true. */
  oncePerSession?: boolean;
  className?: string;
}

const SESSION_KEY = 'demo-preloader-shown';

/**
 * Typographic preloader with a HARD CAP — used by 8 of the 17 references
 * (vero-studio, son-daven, serotoninn, beauty-in-stem, izanami, mont-fort,
 * studio-k95, revelatio).
 *
 * Every one of those is too long for our use case, which is exactly why this is
 * built rather than copied. The award-site version holds a visitor who already
 * intends to be there; a cold demo sent to a salon owner gets a few impatient
 * seconds. The cap IS the component.
 *
 * How it stays honest about performance:
 *  - Renders as a FIXED OVERLAY over a fully-rendered page. The hero is in the
 *    DOM and painting underneath from the first frame, so LCP is not blocked
 *    beyond the overlay's own lifetime.
 *  - Dismisses at `window.load` OR at `maxDuration`, whichever comes first.
 *  - Skipped entirely under `prefers-reduced-motion`, and on repeat visits
 *    within the tab (sessionStorage) — a preloader on every navigation is the
 *    thing that makes a site feel slow.
 *  - `aria-hidden` + `inert`: never traps focus or reaches a screen reader.
 *
 * Because it is skipped so often, never put content here that appears nowhere
 * else on the page.
 *
 *   <Preloader wordmark="SALON PATRAS" caption="Πάτρα — Κομμωτήριο" />
 */
export function Preloader({
  wordmark,
  caption,
  showCounter = true,
  maxDuration = 1200,
  exitDirection = 'up',
  oncePerSession = true,
  className,
}: PreloaderProps) {
  // Starts false so the server-rendered HTML contains NO overlay. A static
  // export that ships a full-screen cover would leave a JS-blocked visitor
  // staring at a blank screen forever; instead the overlay only ever exists
  // once JS has decided it should.
  const [active, setActive] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (oncePerSession) {
      try {
        if (sessionStorage.getItem(SESSION_KEY)) return;
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        // Private mode / storage disabled: just show it. Not worth failing over.
      }
    }
    setActive(true);
  }, [oncePerSession]);

  useEffect(() => {
    if (!active) return;

    const root = rootRef.current;
    if (!root) return;

    // Reserve ~35% of the budget for the exit wipe so the cap covers the whole
    // experience, not just the hold.
    const exitMs = Math.min(520, maxDuration * 0.35);
    const holdMs = Math.max(200, maxDuration - exitMs);

    const counterTarget = { v: 0 };
    const tl = gsap.timeline();

    if (showCounter && counterRef.current) {
      tl.to(
        counterTarget,
        {
          v: 100,
          duration: holdMs / 1000,
          ease: 'power1.inOut',
          onUpdate: () => {
            if (counterRef.current) {
              counterRef.current.textContent = String(Math.round(counterTarget.v));
            }
          },
        },
        0,
      );
    }

    const axis = exitDirection === 'up' || exitDirection === 'down' ? 'yPercent' : 'xPercent';
    const sign = exitDirection === 'up' || exitDirection === 'left' ? -100 : 100;

    tl.to(
      root,
      {
        [axis]: sign,
        duration: exitMs / 1000,
        ease: 'power3.inOut',
        onComplete: () => setActive(false),
      },
      holdMs / 1000,
    );

    // window.load short-circuits the hold: if everything is already there,
    // there is no reason to keep the visitor waiting for the full budget.
    const onLoad = () => {
      if (tl.time() < holdMs / 1000) tl.seek(holdMs / 1000);
    };
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }

    // Belt-and-braces: even if the timeline is starved (tab backgrounded, GSAP
    // ticker throttled), the overlay is gone by the cap + a small margin.
    const hardStop = window.setTimeout(() => {
      tl.kill();
      setActive(false);
    }, maxDuration + 400);

    return () => {
      window.removeEventListener('load', onLoad);
      window.clearTimeout(hardStop);
      tl.kill();
    };
  }, [active, maxDuration, showCounter, exitDirection]);

  if (!active) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      // @ts-expect-error — `inert` is valid HTML; React 19 types lag on it.
      inert=""
      className={cn(
        'fixed inset-0 z-[100] flex flex-col justify-between',
        'bg-background px-6 py-8 md:px-12 md:py-12',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        {caption && (
          <p className="font-body text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
            {caption}
          </p>
        )}
      </div>

      <div className="flex items-end justify-between gap-6 border-t border-border pt-6">
        <div className="font-display text-[clamp(2rem,7vw,5rem)] font-light leading-[0.95] tracking-[-0.02em]">
          {wordmark}
        </div>
        {showCounter && (
          <div className="shrink-0 font-body text-sm tabular-nums tracking-[0.1em] text-muted">
            <span ref={counterRef}>0</span>
            <span>%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default Preloader;
