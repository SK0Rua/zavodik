'use client';

import { useEffect } from 'react';
import { useInView, useReducedMotion } from '@/lib/motion';
import { KenBurnsImage } from './ken-burns-image';
import { cn } from '@/lib/utils';

export interface VideoHeroSource {
  src: string;
  /** e.g. 'video/webm' — lets the browser skip a format it cannot play. */
  type?: string;
}

export interface VideoHeroProps {
  /**
   * One or more sources, best format FIRST (webm before mp4). Omit or pass an
   * empty array and the component renders the KenBurnsImage fallback instead —
   * which is the common case, since most candidate businesses have no footage.
   */
  sources?: VideoHeroSource[];
  /**
   * REQUIRED. The still frame, shown before the video decodes, when the video
   * fails, and as the entire hero under reduced motion. A video hero without a
   * poster is a black rectangle on a slow connection.
   */
  poster: string;
  /** Alt text for the poster/fallback image, in the site language. */
  posterAlt: string;
  /** Overlay laid between video and content. Default 'gradient'. */
  overlay?: 'none' | 'gradient' | 'scrim' | 'grain';
  /** Overlay strength 0-1. Default 0.45. Ignored when overlay is 'none'. */
  overlayOpacity?: number;
  /** Grade utility applied to the footage, e.g. 'grade-warm'. See globals.css. */
  gradeClassName?: string;
  /** Hero height. Default 'min-h-[92vh]'. */
  className?: string;
  /** Class on the content wrapper — position the headline with this. */
  contentClassName?: string;
  /** The headline block. Sits above the overlay. */
  children?: React.ReactNode;
}

/**
 * Full-bleed looping video hero — the cheapest "wow" in the reference pack
 * (omr-beauty, special-production, indigo-laboratory, siena-film, floema).
 *
 * The whole point is that the first screen moves before the visitor touches
 * anything. omr-beauty runs it with NO scrim at all — the footage is graded
 * dark enough that white type survives on its own — so `overlay="none"` is a
 * legitimate choice when the poster is genuinely dark. Use `gradient` when it
 * is not, and check contrast rather than guessing.
 *
 * Behaviour this bundles so no build has to re-derive it:
 *  - `muted loop playsInline` + `preload="none"` — the only combination iOS
 *    Safari will autoplay, and the only one that does not cost a video
 *    download before the poster paints.
 *  - Plays only while in view, pauses off-screen (IntersectionObserver).
 *  - `prefers-reduced-motion` renders the POSTER ONLY — no <video> element is
 *    mounted at all, so nothing decodes.
 *  - No footage at all -> KenBurnsImage on the poster, so the hero still moves.
 *
 * SPEC constraint: only real footage of the actual business, or an abstract
 * texture recorded as `ai_generated`. AI footage must never imply it shows
 * their premises. Budget: keep the file under ~3 MB.
 *
 *   <VideoHero
 *     sources={[{ src: '/assets/hero.webm', type: 'video/webm' }]}
 *     poster="/assets/hero-poster.jpg"
 *     posterAlt="Ο χώρος του κομμωτηρίου"
 *     overlay="gradient"
 *   >
 *     <h1 className="font-display text-[clamp(3rem,9vw,7rem)]">…</h1>
 *   </VideoHero>
 */
export function VideoHero({
  sources,
  poster,
  posterAlt,
  overlay = 'gradient',
  overlayOpacity = 0.45,
  gradeClassName,
  className,
  contentClassName,
  children,
}: VideoHeroProps) {
  const reduced = useReducedMotion();
  // once: false — we need the leaving edge too, to pause playback.
  const [videoRef, inView] = useInView<HTMLVideoElement>({ once: false, threshold: 0.15 });

  const hasVideo = Array.isArray(sources) && sources.length > 0;
  // `reduced` is false on the server and on first client render, then corrects.
  // Because this only decides whether to PLAY (never whether to render the
  // poster), a reduced-motion visitor sees a complete hero either way.
  const playVideo = hasVideo && !reduced;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (inView && !reduced) {
      // play() rejects when autoplay is blocked (some low-power modes). That is
      // fine — the poster stays up — but the rejection must be swallowed or it
      // surfaces as an unhandled promise rejection in the console, which is a
      // QA gate failure.
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [inView, reduced, videoRef]);

  return (
    <section
      className={cn(
        'relative flex min-h-[92vh] flex-col justify-end overflow-hidden',
        className,
      )}
    >
      {/* z-0, NOT -z-10. A negative z-index sends this behind the nearest
          ancestor that establishes a stacking context — and any parent with an
          opaque `bg-*` (a `<main class="relative bg-background">` is the normal
          case) then paints straight over the video, leaving a blank hero. The
          content sibling below carries z-10, which is what keeps the ordering. */}
      <div className="absolute inset-0 z-0">
        {playVideo ? (
          <video
            ref={videoRef}
            poster={poster}
            muted
            loop
            playsInline
            autoPlay
            // Nothing downloads until the element is near the viewport; the
            // poster carries the first paint.
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            className={cn('h-full w-full object-cover', gradeClassName)}
          >
            {sources!.map((s) => (
              <source key={s.src} src={s.src} type={s.type} />
            ))}
          </video>
        ) : (
          // No footage (or reduced motion): the poster still gets slow motion
          // when allowed, and sits perfectly still when it is not.
          <KenBurnsImage
            src={poster}
            alt={posterAlt}
            direction="out"
            duration={26}
            scale={1.07}
            priority
            className="h-full w-full"
            imageClassName={gradeClassName}
          />
        )}

        {overlay !== 'none' && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0',
              overlay === 'gradient' &&
                'bg-[linear-gradient(to_top,rgb(0_0_0/var(--hero-overlay))_0%,transparent_55%)]',
              overlay === 'scrim' && 'bg-[rgb(0_0_0/var(--hero-overlay))]',
              overlay === 'grain' && 'grain',
            )}
            style={
              overlay === 'grain'
                ? { opacity: overlayOpacity }
                : ({ '--hero-overlay': overlayOpacity } as React.CSSProperties)
            }
          />
        )}
      </div>

      <div className={cn('relative z-10 px-6 pb-16 md:px-12 md:pb-20 lg:px-20', contentClassName)}>
        {children}
      </div>
    </section>
  );
}

export default VideoHero;
