import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { Status, Metric } from '@/components/Status';
import { fmtDate, plural } from '@/lib/format';
import { NewCampaignForm } from '@/components/NewCampaignForm';
import { CityAssessment, type AssessmentRow } from '@/components/CityAssessment';
import { ActionForm } from '@/components/ActionForm';
import { setCampaignBuildPolicy, setCampaignFlow, setCampaignRunning } from '@/lib/actions';
import { effectiveValue } from '@/lib/settings';
import { BUILD_POLICIES, BUILD_POLICY_LABELS, normalizeBuildPolicy } from '@/lib/buildPolicy';
import {
  AUTO_STAGES, AUTO_STAGE_LABELS, discoveryFilterSummary,
  normalizeAutoStage, normalizeDiscoveryFilter,
} from '@/lib/campaignFlow';

export const dynamic = 'force-dynamic';

/**
 * Campaigns, each as a card with the four numbers that describe its state.
 *
 * The per-campaign funnel counts used to be a campaigns×statuses matrix at the
 * top of /funnel — a grid where most cells were a dot and the reader had to
 * decode column headers to learn anything. Four numbers per campaign say the
 * same thing: how many we found, how many are ready, how many demos exist, how
 * many we have written to.
 */
export default async function CampaignsPage() {
  const campaigns = await db.select().from(schema.campaigns)
    .orderBy(desc(schema.campaigns.createdAt));

  // The «Нова кампанія» form opens on Roman's chosen country/language rather
  // than a hard-coded Greek pair (see /settings → Система).
  const [defaultCountry, defaultLanguage] = await Promise.all([
    effectiveValue('CAMPAIGN_DEFAULT_COUNTRY'),
    effectiveValue('CAMPAIGN_DEFAULT_LANGUAGE'),
  ]);

  // Recent city assessments (the "worth a campaign?" probes) — newest first.
  const assessmentsRaw = await db.select().from(schema.cityAssessments)
    .orderBy(desc(schema.cityAssessments.createdAt)).limit(8);
  const assessments: AssessmentRow[] = assessmentsRaw.map((a) => ({
    id: a.id, city: a.city, niche: a.niche, country: a.country, status: a.status,
    found: a.found, noSite: a.noSite, hasSite: a.hasSite, socialOnly: a.socialOnly,
    avgRating: a.avgRating, verdict: a.verdict, sample: a.sample, error: a.error,
    createdAt: a.createdAt.toISOString(),
  }));

  // «готові до демо» counts EXACTLY `production_ready` — the businesses that
  // are ready and not yet started. It used to include `site_in_progress`, so
  // five builds that had been stuck for days were counted as "ready" and the
  // card showed 16 where SQL had 11 (sweep P1-3). A build in flight is its own
  // number; a label and its number must agree.
  const counts = await db.execute(sql`
    select campaign_id as "campaignId",
           count(*)::int as total,
           count(*) filter (where status = 'production_ready')::int as ready,
           count(*) filter (where status = 'site_in_progress')::int as building,
           count(*) filter (where status in
             ('site_ready','outreach_approved'))::int as demos,
           count(*) filter (where status in
             ('contacted','replied','meeting','proposal','won'))::int as contacted,
           count(*) filter (where status = 'needs_review')::int as waiting
    from businesses group by campaign_id
  `);
  const byId = new Map(
    (counts.rows as Array<Record<string, string | number>>)
      .map((r) => [String(r.campaignId), r]),
  );

  return (
    <div>
      <h1 className="h-page mb-6">Кампанії</h1>

      <div className="space-y-4">
        {campaigns.map((c) => {
          const stat = byId.get(c.id);
          const n = (k: string) => Number(stat?.[k] ?? 0);
          const stage = normalizeAutoStage(c.autoStage);
          const filterParts = discoveryFilterSummary(normalizeDiscoveryFilter(c.discoveryFilter));
          const paused = c.status === 'paused';
          return (
            <section key={c.id} className="card p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="h-section">
                    {c.city} · {c.niche}
                  </h2>
                  {/* Two campaigns render as «Patras · beauty» — city and niche
                      are not an identity. The id is, and without it the two are
                      indistinguishable except by their numbers (sweep P1-4).
                      It sits under the title as a quiet slug rather than in the
                      heading, which is still what a person reads first. */}
                  <p className="text-sm text-ink-mute font-mono mt-0.5">{c.id}</p>
                  <div className="mt-1 flex items-center gap-3 flex-wrap">
                    <Status tone={c.status === 'running' ? 'go' : 'idle'}>
                      {c.status === 'running' ? 'Працює' : paused ? 'На паузі' : 'Зупинена'}
                    </Status>
                    <span className="text-sm text-ink-mute">
                      {c.mode === 'live' ? 'бойовий режим' : 'тестовий режим'}
                      {' · '}{plural((c.queries as string[]).length, 'запит', 'запити', 'запитів')}
                      {' · '}від {fmtDate(c.createdAt)}
                    </span>
                  </div>
                  {/* What the campaign is doing on its own, in one line: the
                      stop-point and any active search filter. */}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap text-sm text-ink-mute">
                    <span>Сама: <span className="text-ink">{AUTO_STAGE_LABELS[stage]}</span></span>
                    {filterParts.length > 0 && (
                      <span>· фільтр: <span className="text-ink">{filterParts.join(' · ')}</span></span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Roman's «Зупинити» / «Продовжити»: a paused campaign starts
                      no new work; running jobs finish on their own. */}
                  <ActionForm action={setCampaignRunning}>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <input type="hidden" name="paused" value={paused ? 'false' : 'true'} />
                    <button type="submit" className={paused ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}>
                      {paused ? 'Продовжити' : 'Зупинити'}
                    </button>
                  </ActionForm>
                  <Link
                    href={`/businesses?campaign=${encodeURIComponent(c.id)}&sort=score&dir=desc`}
                    className="btn-outline btn-sm no-underline"
                  >
                    Дивитись бізнеси
                  </Link>
                </div>
              </div>

              <div className="flex gap-8 sm:gap-12 flex-wrap mt-6">
                <Metric value={n('total')} label="знайдено" />
                <Metric value={n('ready')} label="готові до демо" />
                {n('building') > 0 && <Metric value={n('building')} label="будуються" />}
                <Metric value={n('demos')} label="демо зроблено" />
                <Metric value={n('contacted')} label="написали" />
                {n('waiting') > 0 && <Metric value={n('waiting')} label="чекають мене" />}
              </div>

              <details className="mt-5">
                {/* Roman's report, verbatim: «просто текст; якби не навів, не
                    поняв би, що клікабельне». `.disclosure` draws the ▸ that
                    says this opens. */}
                <summary className="disclosure">Налаштування кампанії</summary>
                <div className="mt-3 pl-4 border-l-2 border-line space-y-4">
                  <ActionForm action={setCampaignFlow}>
                    <label className="label" htmlFor={`as-${c.id}`}>
                      Наскільки далеко фабрика йде сама
                    </label>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <div className="flex gap-2 items-center flex-wrap">
                      <select
                        id={`as-${c.id}`}
                        name="autoStage"
                        defaultValue={stage}
                        className="w-auto min-w-[260px]"
                      >
                        {AUTO_STAGES.map((s) => (
                          <option key={s} value={s}>{AUTO_STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                      <button type="submit" className="btn-outline btn-sm">Зберегти</button>
                    </div>
                  </ActionForm>

                  <ActionForm action={setCampaignBuildPolicy}>
                    <label className="label" htmlFor={`ab-${c.id}`}>
                      Кому фабрика сама будує демо
                    </label>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <div className="flex gap-2 items-center flex-wrap">
                      <select
                        id={`ab-${c.id}`}
                        name="autoBuild"
                        defaultValue={normalizeBuildPolicy(c.autoBuild)}
                        className="w-auto min-w-[220px]"
                      >
                        {BUILD_POLICIES.map((p) => (
                          <option key={p} value={p}>{BUILD_POLICY_LABELS[p]}</option>
                        ))}
                      </select>
                      <button type="submit" className="btn-outline btn-sm">Зберегти</button>
                    </div>
                    <p className="text-sm text-ink-mute mt-1.5">
                      Діє лише коли фабрика доходить до збірки сама (перший пункт — «аж до збірки демо»).
                    </p>
                  </ActionForm>
                </div>
              </details>
            </section>
          );
        })}

        {campaigns.length === 0 && (
          <div className="card p-8 text-center text-ink-mute">
            Кампаній ще немає. Створи першу — фабрика одразу почне шукати бізнеси.
          </div>
        )}

        <CityAssessment
          recent={assessments}
          defaultCountry={defaultCountry || 'GR'}
          defaultLanguage={defaultLanguage || 'el'}
        />

        <NewCampaignForm
          defaultCountry={defaultCountry || 'GR'}
          defaultLanguage={defaultLanguage || 'el'}
        />
      </div>
    </div>
  );
}
