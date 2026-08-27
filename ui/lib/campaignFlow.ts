/**
 * Campaign-flow helpers for the UI.
 *
 * The decision logic is NOT duplicated: `ui/factory/campaignFlow.ts` is a symlink
 * to `src/orchestrator/campaignFlow.ts` (copied in by ui/Dockerfile), exactly
 * like the schema and the build policy. The router and the campaign form must
 * never be able to disagree about the stop-point ladder or the discovery filter.
 *
 * What lives here is UI-only: Ukrainian labels and hints for the two knobs.
 */
export {
  AUTO_STAGES, DEFAULT_AUTO_STAGE, DEFAULT_DISCOVERY_FILTER,
  discoveryFilterIsEmpty, discoveryFilterReasons, normalizeAutoStage,
  normalizeDiscoveryFilter,
  type AutoStage, type DiscoveryFilter,
} from '@factory/campaignFlow';

import type { AutoStage, DiscoveryFilter } from '@factory/campaignFlow';

export const AUTO_STAGE_LABELS: Record<AutoStage, string> = {
  discover: 'Тільки список — я оберу вручну',
  enrich: 'Зібрати дані, але демо не будувати',
  build: 'Аж до збірки демо (за політикою нижче)',
};

export const AUTO_STAGE_HINTS: Record<AutoStage, string> = {
  discover: 'Фабрика знайде бізнеси, відсіє за фільтрами — і зупиниться. Ні фото, ні фактів, ні аудиту сайтів. Ти переглядаєш список, обираєш перспективні й тиснеш «Зібрати дані» / «Будувати демо».',
  enrich: 'Фабрика збере дані, зробить аудит сайтів і скоринг — і зупиниться на «готово до демо». Збірку демо запускаєш ти кнопкою.',
  build: 'Повний автозапуск: коли зібрано достатньо матеріалу, фабрика сама починає збірку — але кому саме, вирішує політика «Кому фабрика сама будує демо».',
};

/** Short, human summary of an active discovery filter — «лише без сайту · рейтинг ≥ 4». */
export function discoveryFilterSummary(f: DiscoveryFilter): string[] {
  const parts: string[] = [];
  if (f.websiteNone) parts.push('лише без свого сайту');
  if (f.minRating !== null) parts.push(`рейтинг ≥ ${f.minRating}`);
  if (f.minReviews !== null) parts.push(`відгуків ≥ ${f.minReviews}`);
  if (f.requireContact) parts.push('обов’язковий контакт');
  return parts;
}

/** Ukrainian gloss of a `filter:*` reject reason token from fast-qualify. */
export function discoveryFilterReasonLabel(token: string): string | null {
  if (token === 'filter:has_own_site') return 'відсіяно фільтром: має свій сайт';
  if (token === 'filter:no_contact') return 'відсіяно фільтром: немає контакту';
  const rev = /^filter:below_min_reviews:(.+)$/.exec(token);
  if (rev) return `відсіяно фільтром: відгуків менше ${rev[1]}`;
  const rat = /^filter:below_min_rating:(.+)$/.exec(token);
  if (rat) return `відсіяно фільтром: рейтинг нижче ${rat[1]}`;
  return null;
}
