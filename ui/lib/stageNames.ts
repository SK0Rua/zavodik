/**
 * Pipeline stage → what the factory was actually doing.
 *
 * A queue name (`enrich-socials`, `content-and-design`) is meaningful to
 * whoever wrote the worker and to nobody else. Roman needs to know WHAT step
 * stopped so he can judge whether it matters.
 *
 * Kept in `lib/` with no imports, because both server components (the system
 * page, the manual re-run form) and client components (the inbox job card) call
 * it — a `'use client'` module cannot be called from a server render at all.
 */
const STAGE_NAMES: Record<string, string> = {
  'discover': 'пошук бізнесів',
  'normalize': 'впорядкування знайденого',
  'fast-qualify': 'первинний відбір',
  'enrich': 'збір даних про бізнес',
  'enrich-socials': 'пошук соцмереж',
  'refresh-brand': 'оновлення айдентики',
  'collect-assets': 'збір фотографій',
  'audit-website': 'перевірка їхнього сайту',
  'score-and-qa': 'оцінка бізнесу',
  'readiness-gate': 'перевірка готовності',
  'content-and-design': 'підготовка дизайну',
  'build-site': 'збірка демосайту',
  'visual-qa': 'перевірка демосайту',
  'deploy-demo': 'публікація демо',
  'request-approval': 'підготовка до відправки',
  'send-outreach': 'відправка повідомлення',
  'send-followup': 'нагадування',
  'poll-replies': 'перевірка відповідей',
  'daily-summary': 'щоденний звіт',
};

export function stageName(jobType: string): string {
  return STAGE_NAMES[jobType] ?? jobType;
}
