import { Suspense } from 'react';
import { desc } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { BusinessFilters } from '@/components/BusinessFilters';
import { BusinessList, type ListRow } from '@/components/BusinessList';
import { buildButtonState } from '@/lib/buildPolicy';
import { hasAnyFilter, parseFilters, queryBusinesses } from '@/lib/businessQuery';
import { socialsButtonState } from '@/lib/socials';
import {
  humanBusinessStatus, humanStatus, humanStatusLine, humanVerdict,
} from '@/lib/humanStatus';

export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;

/**
 * One list of businesses — what used to be split between /funnel (a
 * campaigns×statuses matrix plus a wide table) and the idea of a separate
 * businesses page. The matrix moved to /campaigns, where per-campaign numbers
 * belong; what is left here is the list itself.
 *
 * Unlike the old /funnel this does NOT redirect a bare visit into a preset
 * filter. Landing on a filtered view that you did not ask for, and that hides
 * most of your data, is disorienting; the presets are one chip away.
 */
export default async function BusinessesPage({
  searchParams,
}: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const filters = parseFilters(params);

  const [campaigns, businesses] = await Promise.all([
    db.select({ id: schema.campaigns.id }).from(schema.campaigns)
      .orderBy(desc(schema.campaigns.createdAt)),
    queryBusinesses(filters),
  ]);

  const rows: ListRow[] = businesses.map((b) => {
    const contacts: string[] = [];
    if (b.hasWhatsapp) contacts.push('WhatsApp');
    if (b.hasInstagram) contacts.push('Instagram');
    if (b.hasEmail) contacts.push('Email');
    if (b.hasPhone && contacts.length === 0) contacts.push('Телефон');

    const displayStatus = humanBusinessStatus({
      status: b.status,
      statusReason: b.statusReason,
      websiteVerdict: b.verdict,
    });

    return {
      id: b.id,
      name: b.name,
      // The gaps are the actionable half of a `needs_review`, so they become the
      // reason clause rather than a separate column of numbers.
      statusText: b.status === 'needs_review' && b.openGaps.length
        ? humanStatusLine(b.status, `${b.openGaps.length} незакритих пропусків`)
        : displayStatus.text,
      statusTone: displayStatus.tone,
      rawStatus: b.status,
      score: b.score,
      verdictText: humanVerdict(b.verdict).text,
      contacts,
      deployUrl: b.deployUrl,
      build: buildButtonState({
        status: b.status,
        openGaps: b.openGaps,
        activeProjectState: b.projectState,
        activeJobStatus: b.buildJobStatus,
        statusReason: b.statusReason,
        verdict: b.verdict,
        hasEvidence: b.hasEvidence,
      }),
      socials: socialsButtonState({
        verifiedPlatforms: b.verifiedSocials,
        activeJobStatus: b.socialsJobStatus,
        status: b.status,
      }),
    };
  });

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-6">
        <h1 className="h-page">Бізнеси</h1>
        <span className="text-sm text-ink-mute tabular-nums">
          {rows.length}{hasAnyFilter(params) ? ' за фільтром' : ''}
        </span>
      </div>

      <div className="space-y-4">
        {/* useSearchParams needs a boundary; the fallback holds the height. */}
        <Suspense fallback={<div className="h-24" />}>
          <BusinessFilters campaigns={campaigns} />
        </Suspense>
        <BusinessList rows={rows} />
      </div>
    </div>
  );
}
