/**
 * Legacy `website-offers` -> factory mapping (pure functions, no I/O, no DB).
 *
 * Two invariants drive every decision here (CLAUDE.md, spec §5):
 *  - a fact without a resolvable source is NOT verified; it becomes a gap;
 *  - the mapped status is the closest HONEST factory status. Legacy evidence
 *    never earns `production_ready` on import — that gate is earned in the
 *    factory's own readiness worker, not inherited from a legacy folder.
 */
import type { BusinessStatus } from '../orchestrator/statuses.js';
import type { LegacyAddress, LegacyClient, LegacyField } from './types.js';

/** Legacy `confidence` enum -> factory numeric confidence. */
export function confidenceToNumber(c: string | undefined): number {
  switch ((c ?? '').toLowerCase()) {
    case 'high': return 0.9;
    case 'medium': return 0.6;
    case 'low': return 0.3;
    default: return 0.5;
  }
}

/** True when the field carries a real value (null / empty string / empty array are all "no value"). */
export function hasValue(f: LegacyField<unknown> | undefined | null): boolean {
  if (!f) return false;
  const v = f.value;
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => x !== null && x !== undefined && x !== '');
  return true;
}

export function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
  }
  if (value && typeof value === 'object') {
    const v = (value as Record<string, unknown>).value ?? (value as Record<string, unknown>).number;
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

export function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    const v = (value as Record<string, unknown>).value ?? (value as Record<string, unknown>).number;
    return typeof v === 'string' && v.trim() ? [v.trim()] : [];
  }
  return [];
}

export function formatAddress(a: LegacyAddress | null | undefined): string | null {
  if (!a) return null;
  if (typeof a === 'string') return a;
  if (a.full && a.full.trim()) return a.full.trim();
  const parts = [a.street, a.postal_code, a.city, a.country].filter((p): p is string => !!p && p.trim() !== '');
  return parts.length ? parts.join(', ') : null;
}

/**
 * Legacy lifecycle -> factory business status.
 *
 * Legacy and factory share most names, but the meanings diverge at the top of
 * the funnel: legacy `qualified` only means "package looks complete enough for
 * Stage 2", which is weaker than the factory's `qualified` (scoring + independent
 * QA, spec stage 7). So anything at or above legacy `qualified` lands in
 * `needs_review` with an explicit reason: a human decides, nothing is inflated.
 */
export function mapStatus(legacyStatus: string | undefined): { status: BusinessStatus; reason: string } {
  const s = (legacyStatus ?? '').trim().toLowerCase();
  switch (s) {
    case 'discovered':
      return { status: 'discovered', reason: 'legacy-import: legacy status=discovered (Google Maps card only)' };
    case 'enriching':
      return { status: 'needs_review', reason: 'legacy-import: legacy status=enriching, interrupted mid-enrichment' };
    case 'needs_review':
      return { status: 'needs_review', reason: 'legacy-import: legacy status=needs_review' };
    case 'rejected':
      return { status: 'rejected', reason: 'legacy-import: legacy status=rejected' };
    case 'qualified':
    case 'site_in_progress':
    case 'site_ready':
      return {
        status: 'needs_review',
        reason: `legacy-import: legacy status=${s}; legacy qualification is weaker than the factory gate (no factory scoring/QA), needs human review`,
      };
    case 'outreach_approved':
    case 'contacted':
    case 'replied':
    case 'won':
    case 'lost':
      return {
        status: 'needs_review',
        reason: `legacy-import: legacy status=${s} implies prior outreach; re-check before any factory send`,
      };
    case '':
      return { status: 'needs_review', reason: 'legacy-import: legacy status missing' };
    default:
      return { status: 'needs_review', reason: `legacy-import: unmapped legacy status=${s}` };
  }
}

/** Factory production gaps derivable from a legacy package, honestly. */
export function deriveGaps(client: LegacyClient, resolvedSourceCount: number): string[] {
  const gaps = new Set<string>();
  const lead = client.lead;

  const hasIdentityDescription = hasValue(lead.offering?.description as LegacyField<unknown>)
    || hasValue(lead.identity?.brand_notes as LegacyField<unknown>);
  if (!hasIdentityDescription) gaps.add('identity');

  const hasContact = hasValue(lead.contact?.phones) || hasValue(lead.contact?.emails);
  if (!hasContact) gaps.add('verified_contact');

  const services = (lead.offering?.services?.value as unknown[] | null) ?? [];
  if (!Array.isArray(services) || services.length < 3) gaps.add('services_min3');

  if (client.assets.length < 3) gaps.add('assets_min3');
  if (!client.assets.some((a) => ['hero', 'logo'].includes(String(a.kind ?? '').toLowerCase()))) gaps.add('hero_or_logo');

  const reviews = lead.presence?.reviews_count?.value;
  if (typeof reviews !== 'number' || reviews < 1) gaps.add('review_context');

  // No resolvable evidence at all is itself a blocking gap.
  if (resolvedSourceCount === 0) gaps.add('evidence_missing');

  return [...gaps];
}

/** Legacy `status.yaml.gaps[]` carried across verbatim as soft, informational gaps. */
export function legacyGapLabels(client: LegacyClient): Array<{ gap: string; blocking: boolean }> {
  return (client.status.gaps ?? [])
    .filter((g) => g && (g.field || g.problem))
    .map((g) => ({
      gap: `legacy:${g.field ?? 'unknown'}: ${(g.problem ?? '').slice(0, 180)}`.trim(),
      blocking: g.blocking === true,
    }));
}

/** Legacy source_type -> factory `business_sources.source_type` vocabulary. */
export function mapSourceType(legacyType: string | undefined): string {
  const t = (legacyType ?? '').trim().toLowerCase();
  const known = ['google_maps', 'owned_website', 'facebook', 'instagram', 'search', 'directory'];
  if (known.includes(t)) return t;
  if (t.includes('maps')) return 'google_maps';
  if (t.includes('yelp') || t.includes('directory')) return 'directory';
  if (t.includes('website') || t.includes('site')) return 'owned_website';
  return 'search';
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Facts extracted from a legacy lead, each carrying the legacy `source_ids` it
 * claimed. A fact is verified ONLY when at least one of those ids resolves to a
 * source row we actually created — otherwise it is stored unverified.
 */
export interface MappedFact {
  key: string;
  value: unknown;
  legacySourceIds: string[];
  confidence: number;
}

export function mapFacts(client: LegacyClient): MappedFact[] {
  const lead = client.lead;
  const facts: MappedFact[] = [];

  const push = (key: string, field: LegacyField<unknown> | undefined, transform?: (v: unknown) => unknown): void => {
    if (!hasValue(field)) return;
    const value = transform ? transform(field!.value) : field!.value;
    if (value === null || value === undefined) return;
    facts.push({
      key,
      value,
      legacySourceIds: field!.source_ids ?? [],
      confidence: confidenceToNumber(field!.confidence),
    });
  };

  push('identity.display_name', lead.identity?.display_name);
  push('identity.legal_name', lead.identity?.legal_name);
  push('classification.category', lead.classification?.category);
  push('classification.business_status', lead.classification?.business_status);
  push('location.address', lead.location?.address, (v) => formatAddress(v as LegacyAddress) ?? v);
  push('location.coordinates', lead.location?.coordinates);
  push('location.maps_url', lead.location?.maps_url);
  push('location.place_id', lead.location?.place_id);
  push('contact.phones', lead.contact?.phones);
  push('contact.website', lead.contact?.website);
  push('contact.emails', lead.contact?.emails);
  push('presence.rating', lead.presence?.rating);
  push('presence.reviews_count', lead.presence?.reviews_count);
  push('presence.hours', lead.presence?.hours);
  push('presence.socials', lead.presence?.socials);
  push('offering.services', lead.offering?.services);

  return facts;
}
