import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { Status, Metric } from '@/components/Status';
import { fmtDate, plural } from '@/lib/format';
import { NewCampaignForm } from '@/components/NewCampaignForm';
import { setCampaignBuildPolicy } from '@/lib/actions';
import { BUILD_POLICIES, BUILD_POLICY_LABELS, normalizeBuildPolicy } from '@/lib/buildPolicy';

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
                      {c.status === 'running' ? 'Працює' : 'Зупинена'}
                    </Status>
                    <span className="text-sm text-ink-mute">
                      {c.mode === 'live' ? 'бойовий режим' : 'тестовий режим'}
                      {' · '}{plural((c.queries as string[]).length, 'запит', 'запити', 'запитів')}
                      {' · '}від {fmtDate(c.createdAt)}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/businesses?campaign=${encodeURIComponent(c.id)}&sort=score&dir=desc`}
                  className="btn-outline btn-sm no-underline"
                >
                  Дивитись бізнеси
                </Link>
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
                <form action={setCampaignBuildPolicy} className="mt-3 pl-4 border-l-2 border-line">
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
                </form>
              </details>
            </section>
          );
        })}

        {campaigns.length === 0 && (
          <div className="card p-8 text-center text-ink-mute">
            Кампаній ще немає. Створи першу — фабрика одразу почне шукати бізнеси.
          </div>
        )}

        <NewCampaignForm />
      </div>
    </div>
  );
}
