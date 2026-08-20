/**
 * Build policy — WHO gets a demo built, and in WHAT ORDER.
 *
 * Roman's rule (2026-08-16): "В першу чергу я хочу робити сайти бізнесам, які
 * не мають сайта." Before this, every business that reached `production_ready`
 * was pushed straight into `content-and-design` by the router, so a salon with
 * a good modern site consumed the same 40 minutes of subscription time as one
 * with nothing but an Instagram page.
 *
 * This module is pure decision logic, deliberately free of DB and queue imports
 * so both the worker side (`router.ts`) and the UI (`ui/lib/buildPolicy.ts`
 * re-exports it) reach the same verdict from the same code. It decides only
 * WHETHER to enqueue and with what priority — it never moves a business between
 * statuses. An ineligible business stays in `production_ready` and waits for the
 * "Будувати демо" button; that is a normal resting state, not a stall.
 */

/** Values of `campaigns.auto_build`. */
export const BUILD_POLICIES = ['no_site_only', 'all', 'manual'] as const;
export type BuildPolicy = typeof BUILD_POLICIES[number];

export const DEFAULT_BUILD_POLICY: BuildPolicy = 'no_site_only';

/**
 * Verdicts that mean "this business has no usable web presence of its own" —
 * i.e. exactly the leads a demo site is worth building for.
 *
 * `no_website` covers "nothing at all" AND "only an Instagram/booking profile"
 * — a social profile is not an owned site (SPEC §5), and since social discovery
 * fills contacts for everyone the old `social_only` verdict said nothing extra
 * (Roman, 2026-08-19). `broken` is in: a domain that renders nothing is, to a
 * customer, the same as no site. `outdated` and `working_good` are NOT — they
 * get built only under the `all` policy or by hand.
 */
export const NO_SITE_VERDICTS: ReadonlySet<string> = new Set([
  'no_website', 'broken',
]);

/** Priority ladder inside the build queue: worst web presence goes first. */
const VERDICT_PRIORITY: Record<string, number> = {
  no_website: 300,
  broken: 200,
};

export function normalizeBuildPolicy(value: string | null | undefined): BuildPolicy {
  return (BUILD_POLICIES as readonly string[]).includes(value ?? '')
    ? (value as BuildPolicy)
    : DEFAULT_BUILD_POLICY;
}

export interface BuildEligibility {
  eligible: boolean;
  /** Short Ukrainian explanation, shown in logs and as the UI tooltip. */
  reason: string;
}

/**
 * Does the campaign policy allow the factory to start a build for this business
 * on its own?
 *
 * A missing audit is treated as NOT eligible under `no_site_only`: "we never
 * looked" is not evidence of "there is no site", and the factory does not spend
 * a build on a guess. Under `all` the audit is irrelevant.
 */
export function isAutoBuildEligible(input: {
  policy: BuildPolicy;
  latestVerdict: string | null | undefined;
}): BuildEligibility {
  switch (input.policy) {
    case 'all':
      return { eligible: true, reason: 'політика кампанії: all' };
    case 'manual':
      return { eligible: false, reason: 'політика кампанії: manual — тільки кнопкою' };
    case 'no_site_only': {
      if (!input.latestVerdict) {
        return { eligible: false, reason: 'немає аудиту сайту — вердикт невідомий' };
      }
      if (NO_SITE_VERDICTS.has(input.latestVerdict)) {
        return { eligible: true, reason: `без сайту (${input.latestVerdict})` };
      }
      return { eligible: false, reason: `має сайт (${input.latestVerdict})` };
    }
  }
}

/**
 * pg-boss priority for a `content-and-design` job: higher runs first.
 *
 * Verdict dominates score, so a `no_website` lead with score 60 is still built
 * before a `working_good` lead with score 85 — that is the whole point of the
 * policy. Score only orders businesses that share a verdict tier. Score is
 * 0–100, so the ×0.9 keeps it strictly inside its tier's 100-point band and a
 * tier can never overtake the one above it.
 */
export function buildJobPriority(input: {
  latestVerdict: string | null | undefined;
  score: number | null | undefined;
}): number {
  const tier = VERDICT_PRIORITY[input.latestVerdict ?? ''] ?? 0;
  const score = Math.max(0, Math.min(100, input.score ?? 0));
  return tier + Math.round(score * 0.9);
}
