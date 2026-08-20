/**
 * Shape of a QA report JSON, as written by the build pipeline's stage 11
 * (`src/build/schemas.ts` VisualCritiqueSchema + the deterministic metrics and
 * motion frames wrapped around it). Every field is optional at the TYPE level
 * even where the schema requires it, because older reports on disk (before a
 * schema field existed) are read by this same page — see CLAUDE.md: the code
 * predates parts of the spec, and evidence already written never changes shape
 * retroactively.
 */

export interface QaIssue {
  severity: 'low' | 'medium' | 'high';
  category: string;
  viewport: 'mobile' | 'tablet' | 'desktop' | 'all';
  issue: string;
  fix: string;
}

export interface WowScores {
  heroMotion?: number;
  scrollChoreography?: number;
  typeAsDesign?: number;
  photoTreatment?: number;
  microInteraction?: number;
  performanceReducedMotion?: number;
}

export interface QaReport {
  iteration: number;
  businessId: string;
  projectId: number;
  at: string;
  durationSeconds?: number;
  designDirection?: string | null;
  passed: boolean;
  metrics?: Record<string, unknown>;
  issues: QaIssue[];
  provenanceFindings?: string[];
  builderNotes?: string;
  builderUnresolved?: string[];
  critique?: {
    approved: boolean;
    rubric?: {
      typographicHierarchy: number;
      spacingRhythm: number;
      photoTreatment: number;
      motionAppropriateness: number;
    };
    wow?: WowScores;
    referenceComparison?: {
      slug: string;
      closeness: number;
      gap: string;
    };
    issues?: QaIssue[];
    strengths?: string[];
  };
  wow?: {
    total: number;
    ambition?: number;
    passed: boolean;
    reasons: string[];
    axes: WowScores;
  };
  motion?: {
    heroMotionDetected?: boolean;
    heroMotionPixelDelta?: number;
    heroSustainedPixelDelta?: number;
    heroSustainedMotion?: boolean;
    animationEngines?: string[];
    transformedAtRest?: number;
    frames?: string[];
  };
  referenceSlug?: string;
  screenshotKeys?: string[];
}

/** The six wow axes, in words rather than camelCase keys — matches BuildReviewCard. */
export const WOW_AXIS_LABELS: Record<string, string> = {
  heroMotion: 'рух на першому екрані',
  scrollChoreography: 'рух при скролі',
  typeAsDesign: 'типографіка',
  photoTreatment: 'фото',
  microInteraction: 'дрібні деталі',
  performanceReducedMotion: 'швидкість і доступність',
};

export const WOW_AXIS_ORDER = [
  'heroMotion', 'scrollChoreography', 'typeAsDesign',
  'photoTreatment', 'microInteraction', 'performanceReducedMotion',
];

export const RUBRIC_AXIS_LABELS: Record<string, string> = {
  typographicHierarchy: 'типографічна ієрархія',
  spacingRhythm: 'ритм і відступи',
  photoTreatment: 'робота з фото',
  motionAppropriateness: 'доречність руху',
};

export const CATEGORY_LABELS: Record<string, string> = {
  'typographic-hierarchy': 'типографіка',
  'spacing-rhythm': 'відступи',
  'photo-treatment': 'фото',
  'motion-appropriateness': 'рух',
  slop: 'шаблонність',
  layout: 'верстка',
  contrast: 'контраст',
  content: 'контент',
  wow: 'враження',
};

export const SEVERITY_LABELS: Record<string, string> = {
  high: 'критично',
  medium: 'помітно',
  low: 'дрібниця',
};

export const VIEWPORT_LABELS: Record<string, string> = {
  mobile: 'телефон',
  tablet: 'планшет',
  desktop: 'комп’ютер',
  all: 'усюди',
};

/** Which viewport / moment a QA screenshot came from, out of its object key. */
export function shotLabel(key: string): string {
  const base = key.split('/').pop() ?? key;
  if (base.includes('desktop-reduced-motion')) return 'без анімацій';
  if (base.includes('desktop')) return 'комп’ютер';
  if (base.includes('tablet')) return 'планшет';
  if (base.includes('mobile')) return 'телефон';
  const load = /motion-load-t([\d.]+)s/.exec(base);
  if (load) return `рух, ${load[1]}с після відкриття`;
  const scroll = /motion-scroll-(\d+)pct/.exec(base);
  if (scroll) return `скрол ${Number(scroll[1])}%`;
  return base;
}

const METRIC_LABELS: Record<string, string> = {
  pageHeight: 'висота сторінки, px',
  inkPer1000px: 'щільність контенту (на 1000px)',
  inkElements: 'елементів з контентом',
  clippedText: 'обрізаного тексту',
  scrollWidth: 'ширина скролу, px',
  consoleErrors: 'помилок у консолі',
  failedRequests: 'невдалих запитів',
};

export interface DeterministicSummary {
  viewport: string;
  pageHeight?: number;
  inkPer1000px?: number;
  clippedText?: number;
  consoleErrors?: number;
  failedRequests?: number;
  scrollWidth?: number;
}

/** Per-viewport deterministic checks, pulled out of the flat `metrics` bag. */
export function deterministicByViewport(metrics: Record<string, unknown> | undefined): DeterministicSummary[] {
  if (!metrics) return [];
  const viewports = ['desktop', 'tablet', 'mobile'];
  const out: DeterministicSummary[] = [];
  for (const vp of viewports) {
    const num = (suffix: string) => {
      const v = metrics[`${vp}.${suffix}`];
      return typeof v === 'number' ? v : undefined;
    };
    const row: DeterministicSummary = {
      viewport: vp,
      pageHeight: num('pageHeight'),
      inkPer1000px: num('inkPer1000px'),
      clippedText: num('clippedText'),
      consoleErrors: num('consoleErrors'),
      failedRequests: num('failedRequests'),
      scrollWidth: num('scrollWidth'),
    };
    if (Object.values(row).some((v) => v !== undefined && v !== vp)) out.push(row);
  }
  return out;
}

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}
