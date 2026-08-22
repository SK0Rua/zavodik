'use client';

/**
 * The toast column. Mounted once, in the console layout.
 *
 * Visual decisions, all of them constrained by the paper theme rather than
 * inventing a second one:
 *
 *  - a white card with the same hairline and `shadow-pop` the dialog uses, so a
 *    toast reads as the same material as everything else that floats;
 *  - the tone is a 3px rail down the left edge in `dot-go` / `dot-stop` — the
 *    console's rule is "status is a word with a dot, never a filled pill", and a
 *    saturated green rectangle in the corner would break it louder than
 *    anything on the page;
 *  - bottom-RIGHT on desktop, bottom-full-width on a phone. Bottom because the
 *    thing you just clicked is usually mid-page and a top toast makes you look
 *    away from it; right because the left edge is where the nav lives.
 *
 * The auto-dismiss timer pauses while the pointer is over the toast, so a long
 * failure reason cannot expire out from under someone reading it. Reduced
 * motion is respected by globals.css, which flattens the transition globally.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  dismissToast, getToasts, subscribeToasts, TOAST_MS, type Toast,
} from '@/lib/toast';

/** Server render has no toasts, and neither does the first client paint. */
const EMPTY: Toast[] = [];

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);

  return (
    <div
      // `aria-live` on the container rather than each toast: a region that
      // exists from first paint is announced when its children change, whereas
      // a live region that is itself inserted may be missed entirely.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-stretch
                 gap-2 p-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:p-0 sm:w-[min(26rem,calc(100vw-2rem))]"
    >
      {toasts.map((t) => <ToastRow key={t.id} toast={t} />)}
    </div>
  );
}

function ToastRow({ toast }: { toast: Toast }) {
  const [paused, setPaused] = useState(false);
  // Mounted-then-shown, so the first paint has the pre-transition styles and
  // the second has the final ones — otherwise there is nothing to animate from
  // and the toast simply appears.
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (paused) return;
    timer.current = setTimeout(() => dismissToast(toast.id), TOAST_MS[toast.tone]);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // Restarting the countdown on unpause is deliberate: someone who hovered to
    // read gets the full window again once they move away.
  }, [paused, toast.id, toast.tone]);

  const success = toast.tone === 'success';

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto card shadow-pop overflow-hidden flex items-start gap-3
                  py-3 pr-2.5 pl-0 transition-all duration-200
                  ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {/* The tone, as a rail. Not a coloured background and not an emoji:
          one is a badge, the other is a second visual language. */}
      <span
        aria-hidden
        className={`self-stretch w-[3px] shrink-0 rounded-r ${success ? 'bg-dot-go' : 'bg-dot-stop'}`}
      />

      <p className={`min-w-0 flex-1 text-sm py-0.5 ${success ? 'text-ink' : 'text-dot-stop'}`}>
        {toast.message}
      </p>

      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="btn-quiet btn-sm shrink-0 min-h-0 py-1 px-2 -my-0.5"
        aria-label="Закрити повідомлення"
      >
        ✕
      </button>
    </div>
  );
}
