/**
 * Sort vocabulary for the businesses list.
 *
 * Kept in its own module with NO imports: both the server query and the client
 * filter bar need it, and anything the filter bar imports ends up in the browser
 * bundle. Pulling this out of `businessQuery.ts` is what keeps `pg` (and with it
 * node's `net`/`tls`) out of the client build.
 */

/** Sentinel verdict value meaning "this business has no audit at all". */
export const NO_VERDICT = '__none__';

export const SORT_FIELDS = ['score', 'review_count', 'rating', 'updated_at', 'name'] as const;
export type SortField = typeof SORT_FIELDS[number];

export const SORT_LABELS: Record<SortField, string> = {
  score: 'За балом',
  review_count: 'За відгуками',
  rating: 'За рейтингом',
  updated_at: 'За оновленням',
  name: 'За назвою',
};
