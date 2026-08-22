'use client';

/**
 * The console's one feedback channel for "your click did something".
 *
 * Roman, 2026-08-22: «Коли я роблю якусь дію — має бути тоаст. Нажав змінити
 * статус — і хз, спрацювало чи ні.» Half the console's actions were server
 * actions submitted from a plain <form>: the page revalidated, the row quietly
 * changed, and nothing ever said so. The other half wrote a sentence into a
 * <p> next to the button, which is fine when you are looking at that button and
 * invisible when the button was in a dialog that has since closed.
 *
 * So every action reports through here instead, and the rules are:
 *
 *  - one toast per action, in Roman's words, naming the RESULT, not the verb
 *    («Стан змінено на "Готово до демо"», not «Статус оновлено»);
 *  - a failure says why, and stays twice as long, because a reason is something
 *    you read rather than glance at;
 *  - nothing is ever ONLY a toast. A toast is confirmation of a change the page
 *    also shows; it is not the place a fact lives.
 *
 * Deliberately not a library and deliberately not React context: an emitter is
 * ~40 lines, works from any component without a provider in its tree, and can
 * be called from a `useTransition` callback that has no hooks of its own.
 * `useSyncExternalStore` is what connects it to React, so there is exactly one
 * subscription for the whole page no matter how many buttons exist.
 */

export type ToastTone = 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  /** One sentence. Shown as-is; no truncation, so keep it a sentence. */
  message: string;
}

/** Anything a server action in this codebase returns. */
export interface ActionLike {
  ok: boolean;
  message: string;
}

/** How long a toast stays, by tone. A reason needs longer than a confirmation. */
export const TOAST_MS: Record<ToastTone, number> = {
  success: 4000,
  error: 8000,
};

/**
 * The most toasts kept at once.
 *
 * A bulk action over twenty businesses returns ONE result, so this is not about
 * bulk — it is about a person clicking four things in a row while the first
 * three are still on screen. Past four the column starts covering the page it
 * is reporting on, so the oldest falls off.
 */
const MAX_TOASTS = 4;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * The reducer, exported so it can be tested without a DOM.
 *
 * Pure on purpose: `scripts/test-toast.ts` asserts the ordering, the cap and
 * the dismiss-by-id behaviour offline, which is the only way this gets
 * exercised at all with docker down.
 */
export function reduceToasts(
  state: Toast[],
  action: { type: 'push'; toast: Toast } | { type: 'dismiss'; id: number } | { type: 'clear' },
): Toast[] {
  switch (action.type) {
    case 'push':
      // Newest last: the column grows downward and the newest toast is nearest
      // the corner your eye is already in after clicking.
      return [...state, action.toast].slice(-MAX_TOASTS);
    case 'dismiss':
      return state.filter((t) => t.id !== action.id);
    case 'clear':
      return [];
  }
}

function dispatch(action: Parameters<typeof reduceToasts>[1]): void {
  const next = reduceToasts(toasts, action);
  if (next === toasts) return;
  toasts = next;
  emit();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number): void {
  dispatch({ type: 'dismiss', id });
}

/** Testing seam: reset module state between assertions. */
export function resetToasts(): void {
  toasts = [];
  nextId = 1;
  emit();
}

/**
 * Show one toast. Returns its id so a caller could dismiss it early.
 *
 * An empty message is dropped rather than shown as an empty box: several server
 * actions return `{ok: true, message: ''}` on a no-op path, and a blank toast
 * is worse than none — it says "something happened" and nothing else.
 */
export function toast(tone: ToastTone, message: string): number | null {
  const text = message.trim();
  if (!text) return null;
  const id = nextId++;
  dispatch({ type: 'push', toast: { id, tone, message: text } });
  return id;
}

export const toastSuccess = (message: string): number | null => toast('success', message);
export const toastError = (message: string): number | null => toast('error', message);

/**
 * The one call every wired-up action makes: hand it whatever the action
 * returned and the tone is decided by `ok`.
 *
 * `fallback` covers actions whose success message is empty or generic — the
 * caller knows what was clicked and the action often does not.
 */
export function toastResult(result: ActionLike, fallback?: string): number | null {
  const message = result.message?.trim() || fallback || '';
  return toast(result.ok ? 'success' : 'error', message);
}

/**
 * Wrap an action call so a thrown error becomes an error toast instead of an
 * unhandled rejection in the console.
 *
 * This matters more than it looks: a server action that throws (a dropped
 * connection to the factory, a Postgres restart mid-click) currently produces
 * NOTHING in the UI — the transition ends, the button un-disables, and the page
 * looks like the click never happened. That is the exact failure Roman
 * described, arriving through a different door.
 */
export async function runWithToast<T extends ActionLike>(
  run: () => Promise<T>,
  opts?: { fallback?: string; onResult?: (result: T) => void },
): Promise<T | null> {
  try {
    const result = await run();
    toastResult(result, opts?.fallback);
    opts?.onResult?.(result);
    return result;
  } catch (err) {
    toastError(`Не вдалося виконати: ${String(err).slice(0, 200)}`);
    return null;
  }
}
