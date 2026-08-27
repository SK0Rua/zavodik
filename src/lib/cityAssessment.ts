/**
 * City-assessment verdict — pure decision logic, no DB, no I/O, so both the
 * probe worker and the UI can reach the same verdict from the same code and a
 * test can lock the thresholds.
 *
 * The question is only "is this city+niche worth a campaign?", answered from two
 * numbers gosom's probe returns: how many businesses were found, and how many of
 * them have no site of their own (the opportunity). A city with lots of leads and
 * a high no-site share is a `go`; too few leads, or almost everyone already has a
 * site, is a `skip`; everything between is a `maybe`.
 *
 * Thresholds are deliberately conservative and exported so the UI can explain the
 * verdict in the same words the code decided it.
 */
export type CityVerdict = 'go' | 'maybe' | 'skip';

/** A city is worth it at or above this many found businesses AND no-site share. */
export const GO_MIN_FOUND = 12;
export const GO_MIN_NO_SITE_SHARE = 0.4;
/** Below this many found, OR below this no-site share, it is not worth a campaign. */
export const SKIP_MAX_FOUND = 6;
export const SKIP_MAX_NO_SITE_SHARE = 0.2;

export interface CityStats {
  found: number;
  /** Businesses with no owned website (social/booking profile counts as none). */
  noSite: number;
}

/** Share of found businesses that have no site of their own, 0 when none found. */
export function noSiteShare(s: CityStats): number {
  return s.found > 0 ? s.noSite / s.found : 0;
}

export function cityVerdict(s: CityStats): CityVerdict {
  if (s.found === 0) return 'skip';
  const share = noSiteShare(s);
  if (s.found >= GO_MIN_FOUND && share >= GO_MIN_NO_SITE_SHARE) return 'go';
  if (s.found < SKIP_MAX_FOUND || share < SKIP_MAX_NO_SITE_SHARE) return 'skip';
  return 'maybe';
}
