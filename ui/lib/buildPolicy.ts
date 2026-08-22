/**
 * Build-policy helpers for the UI.
 *
 * The decision logic itself is NOT duplicated here: `ui/factory/buildPolicy.ts`
 * is a symlink to `src/orchestrator/buildPolicy.ts` (the real file is copied in
 * by ui/Dockerfile), exactly like the drizzle schema. The router and the
 * "Будувати демо" button must never be able to disagree about who is eligible.
 *
 * What lives here is UI-only: labels, and the "can this row be built right now"
 * check that also accounts for status and for a build already being in flight.
 */
export {
  BUILD_POLICIES, DEFAULT_BUILD_POLICY, NO_SITE_VERDICTS,
  buildJobPriority, isAutoBuildEligible, normalizeBuildPolicy,
  type BuildPolicy,
} from '@factory/buildPolicy';

import { NO_SITE_VERDICTS, type BuildPolicy } from '@factory/buildPolicy';
import { gapName } from './humanStatus';

/** All five audit verdicts, worst web presence first (mirrors src/workers/audit.ts). */
export const AUDIT_VERDICTS = [
  'no_website', 'broken',
  'working_with_https_issue', 'outdated', 'working_good',
] as const;

/** The "Без сайту" chip on the funnel = exactly the auto-build-eligible set. */
export const NO_SITE_VERDICT_LIST: string[] = [...NO_SITE_VERDICTS];

export const BUILD_POLICY_LABELS: Record<BuildPolicy, string> = {
  no_site_only: 'Тим, хто без сайту',
  all: 'Усім готовим',
  manual: 'Нікому — тільки вручну',
};

export const BUILD_POLICY_HINTS: Record<BuildPolicy, string> = {
  no_site_only: 'Автоматично — але лише тим, у кого сайту немає або він не працює. Решті — тільки твоєю кнопкою.',
  all: 'Автоматично кожному бізнесу, щойно зібрано достатньо матеріалу. Може багато будувати — обережно з підпискою.',
  manual: 'Ніколи сама. Кожне демо запускаєш ти кнопкою «Побудувати демо».',
};

/** Green = opportunity (no real site), red-ish = already has one. */
export function verdictTone(verdict: string | null | undefined): 'ok' | 'warn' | 'bad' | 'info' | 'idle' {
  if (!verdict) return 'idle';
  if (verdict === 'no_website') return 'ok';
  if (verdict === 'broken') return 'warn';
  if (verdict === 'working_good') return 'bad';
  return 'info';
}

/** Statuses from which a build may be started at all. */
export const BUILDABLE_STATUSES: ReadonlySet<string> = new Set(['production_ready', 'needs_review']);

/** Site-project states that mean "a build for this business is already in flight". */
const ACTIVE_PROJECT_STATES: ReadonlySet<string> = new Set([
  'pending', 'brief', 'building', 'qa',
]);

/**
 * Is the build this log belongs to dead, rather than slow?
 *
 * The distinction the live panel could not make (BEAUTIFY Laser, 2026-08-22):
 * a container recreate mid-build leaves the last lines the agent wrote frozen
 * on screen under a header that says the job is `stale`, forever. A frozen feed
 * reads as a slow build, and those need opposite reactions — wait, versus press
 * the button again.
 *
 * All four conditions are load-bearing:
 *  - `active === false`, because a running job is never interrupted;
 *  - not `queued`, because a build waiting its turn has not started, let alone
 *    stopped — that is the one non-live status that must NOT show the banner;
 *  - and then either the reconciler's fingerprint (`stale`), a job row that no
 *    longer exists at all, or a project the reconciler failed.
 *
 * Deliberately NOT "the log has not moved in N minutes": a `pnpm build` inside
 * a 40-minute agent session goes quiet for far longer than any threshold that
 * would catch a real interruption, which is what `QUIET_WARN_SEC` is for. This
 * asks the queue, which knows.
 */
export function isInterruptedBuild(input: {
  active: boolean | null | undefined;
  jobStatus: string | null | undefined;
  projectState: string | null | undefined;
}): boolean {
  if (input.active !== false) return false;
  if (input.jobStatus === 'queued') return false;
  return input.jobStatus === 'stale'
    || input.jobStatus == null
    || input.projectState === 'failed';
}

export function isActiveProjectState(state: string | null | undefined): boolean {
  return ACTIVE_PROJECT_STATES.has(state ?? '');
}

/** Workflow-job states that mean "a build job for this business is already queued/running". */
const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'retry_wait']);

export function isActiveJobStatus(status: string | null | undefined): boolean {
  return ACTIVE_JOB_STATUSES.has(status ?? '');
}

/**
 * WHY the button looks the way it does — the distinction the old boolean lost.
 *
 * `enabled: false` used to mean four unrelated things at once, and `enabled:
 * true` meant two (sweep P1-1, P1-2): a business the factory had explicitly
 * DISQUALIFIED ("вже є добрий сайт") and a business the pipeline had never
 * touched both rendered as a live «Будувати демо», i.e. as readiness.
 *
 *  - `eligible`      — press it, this is the normal case.
 *  - `disqualified`  — the factory decided there is no opportunity here. The
 *                      button is not offered; an override link is, behind a
 *                      confirm, because the verdict can be wrong and Roman
 *                      overrules the factory, not the other way round.
 *  - `unknown`       — nothing has been checked yet. Disabled, and says so.
 *                      Absence of evidence is NOT absence of gaps.
 *  - `busy`          — a build is already running or queued.
 *  - `blocked`       — real open gaps, listed by name.
 *  - `not_applicable`— a stage where building makes no sense at all.
 */
export type BuildAvailability =
  | 'eligible' | 'disqualified' | 'unknown' | 'busy' | 'blocked' | 'not_applicable';

export interface BuildButtonState {
  /** Can the button be pressed? */
  enabled: boolean;
  /** Does pressing it need an explicit confirm (needs_review → production_ready)? */
  needsConfirm: boolean;
  /** Tooltip text: why it is disabled, or what pressing it will do. */
  hint: string;
  /** Which of the six situations above this is. */
  availability: BuildAvailability;
  /**
   * The sentence shown INSTEAD of a button when the factory disqualified the
   * business — the row must state the decision, not stay silent about it.
   */
  disqualifiedText?: string;
}

/**
 * Statuses whose `status_reason` marks a deliberate disqualification.
 *
 * The reason string is written by the qualifier worker; matching on the exact
 * token keeps the UI from inventing a disqualification out of free prose.
 */
const DISQUALIFY_REASONS: Record<string, string> = {
  already_has_a_good_modern_site_no_opportunity:
    'У бізнесу вже нормальний сайт — демо не потрібне',
};

/** Reads a disqualification out of `status_reason`, or null when there is none. */
export function disqualification(statusReason: string | null | undefined): string | null {
  if (!statusReason) return null;
  const trimmed = statusReason.trim();
  const direct = DISQUALIFY_REASONS[trimmed];
  if (direct) return direct;
  const m = /^not qualified:\s*(.+)$/i.exec(trimmed);
  if (m) return DISQUALIFY_REASONS[m[1]!.trim()] ?? 'Фабрика вирішила, що демо тут не потрібне';
  return null;
}

/**
 * Decides what the row's "Будувати демо" button may do.
 *
 * `production_ready` builds directly. `needs_review` is allowed ONLY when the
 * readiness gate left no open hard gaps — the gaps are the reason the gate
 * refused, and a demo built over an unresolved gap would be padded with
 * invention, which the factory does not do (SPEC §5). Otherwise the button is
 * disabled and lists the gaps, so Roman sees WHY rather than a dead control.
 */
export function buildButtonState(input: {
  status: string;
  openGaps: string[];
  activeProjectState: string | null | undefined;
  activeJobStatus: string | null | undefined;
  /** `businesses.status_reason` — carries an explicit disqualification. */
  statusReason?: string | null;
  /** Latest audit verdict, or null when the audit never ran. */
  verdict?: string | null;
  /**
   * Has the pipeline actually LOOKED at this business? False means no facts,
   * no contacts, no audit — an empty row, not a clean one.
   */
  hasEvidence?: boolean;
}): BuildButtonState {
  // Hints are what Roman reads when a button will not press, so they say what is
  // true in his words — a raw state name here ("building", "production_ready")
  // just asks him to learn the state machine to understand a tooltip.
  if (isActiveProjectState(input.activeProjectState)) {
    return {
      enabled: false, needsConfirm: false, availability: 'busy',
      hint: 'Демо для цього бізнесу вже будується',
    };
  }
  if (isActiveJobStatus(input.activeJobStatus)) {
    return {
      enabled: false, needsConfirm: false, availability: 'busy',
      hint: 'Збірка вже стоїть у черзі',
    };
  }

  // The factory already decided there is no opportunity here. Offering the
  // primary action anyway presents a refusal as readiness (sweep P1-1).
  const disqualified = disqualification(input.statusReason);
  if (disqualified && input.status !== 'production_ready') {
    return {
      enabled: false,
      needsConfirm: true,
      availability: 'disqualified',
      disqualifiedText: disqualified,
      hint: `${disqualified}. Можна побудувати попри це — але фабрика вважає, що сенсу немає.`,
    };
  }

  if (input.status === 'production_ready') {
    return {
      enabled: true, needsConfirm: false, availability: 'eligible',
      hint: 'Почати збірку демосайту',
    };
  }

  if (input.status === 'needs_review') {
    if (input.openGaps.length > 0) {
      // The gap KEYS are a machine vocabulary; the header two lines above
      // already prints their Ukrainian names (sweep P1-12).
      const named = input.openGaps.map((g) => gapName(g));
      return {
        enabled: false,
        needsConfirm: false,
        availability: 'blocked',
        hint: `Спершу закрий пропуски: ${named.join(', ')}`,
      };
    }
    // No gaps AND nothing ever checked are not the same answer. A business the
    // pipeline never touched has no gaps for the trivial reason that nobody
    // looked for any (sweep P1-2).
    if (input.hasEvidence === false) {
      return {
        enabled: false,
        needsConfirm: false,
        availability: 'unknown',
        hint: 'Ще не перевірено: фабрика не збирала по цьому бізнесу ні фактів, ні контактів. '
          + 'Спершу має пройти збір даних.',
      };
    }
    return {
      enabled: true,
      needsConfirm: true,
      availability: 'eligible',
      hint: 'Пропусків немає — переведе в «готово до демо» від твого імені і почне збірку',
    };
  }

  return {
    enabled: false, needsConfirm: false, availability: 'not_applicable',
    hint: 'На цьому етапі демо не будується',
  };
}
