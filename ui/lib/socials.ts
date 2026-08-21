/**
 * UI-side helpers for the "Дошукати соцмережі" action.
 *
 * Same discipline as `buildPolicy.ts`: the eligibility decision is computed
 * ONCE, on the server, by the helper both the button and the server action use,
 * so the UI can never offer something the action would refuse.
 */

import { isActiveJobStatus } from './buildPolicy';

/** The social channels this action looks for. */
export const SOCIAL_CHANNELS = ['instagram', 'facebook', 'tiktok'] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export function isSocialChannel(channel: string): channel is SocialChannel {
  return (SOCIAL_CHANNELS as readonly string[]).includes(channel);
}

export interface SocialsButtonState {
  enabled: boolean;
  /** Tooltip: why it is disabled, or what pressing it will do. */
  hint: string;
}

/** Statuses where the business's road has ended; no enrichment is worth doing. */
export const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  'rejected', 'lost', 'closed', 'duplicate', 'do_not_contact',
]);

/**
 * Decides whether the search may be started for one business.
 *
 * Two reasons to refuse, and they are different in kind:
 *  - a job is already queued/running: a second one would be a duplicate browser
 *    session against the same rate-limited engines;
 *  - both Instagram and Facebook are already VERIFIED: there is nothing left to
 *    search for, and the worker would skip it anyway. Saying so up front is
 *    more honest than queueing a job that does nothing.
 *
 * An UNVERIFIED candidate does NOT count as found: it is exactly the case where
 * a second look is worth something.
 */
export function socialsButtonState(input: {
  verifiedPlatforms: string[];
  activeJobStatus?: string | null;
  /** Business status — a closed business is not worth enriching. */
  status?: string | null;
}): SocialsButtonState {
  // Third reason, and the one that was missing: the build action guards on
  // status, this one did not, so a bulk run happily enqueued `enrich-socials`
  // for a REJECTED business (sweep P1-13). Spending a browser session on a
  // business the factory has closed is work that can never be used.
  if (input.status && CLOSED_STATUSES.has(input.status)) {
    return { enabled: false, hint: 'Бізнес закритий — фабрика ним більше не займається' };
  }
  if (isActiveJobStatus(input.activeJobStatus)) {
    return { enabled: false, hint: `Пошук уже в черзі (${input.activeJobStatus})` };
  }
  const verified = new Set(input.verifiedPlatforms);
  if (verified.has('instagram') && verified.has('facebook')) {
    return { enabled: false, hint: 'Instagram і Facebook уже підтверджені — шукати нічого' };
  }
  const missing = (['instagram', 'facebook'] as const).filter((p) => !verified.has(p));
  return {
    enabled: true,
    hint: `Шукає профілі (${missing.join(', ')}) у пошуковиках, а якщо їх заблокували — агентом `
      + `через Claude WebSearch. Кожен профіль потім відкривається і звіряється кодом; сторінки `
      + `зберігаються як evidence. ~1-3 хв.`,
  };
}
