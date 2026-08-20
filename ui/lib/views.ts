/**
 * Named URL presets for the funnel.
 *
 * Pure strings, no imports beyond the verdict vocabulary — both the server page
 * (for its default redirect) and the client filter bar link to these, so they
 * must not drag anything server-only into the browser bundle.
 */
import { NO_SITE_VERDICT_LIST } from './buildPolicy';

/**
 * Roman's working list: production_ready businesses with no site of their own,
 * best score first. This is what a bare `/funnel` redirects to.
 */
export const DEFAULT_VIEW_QUERY =
  `status=production_ready&${NO_SITE_VERDICT_LIST.map((v) => `verdict=${v}`).join('&')}&sort=score&dir=desc`;
