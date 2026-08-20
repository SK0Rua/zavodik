/**
 * Server-side query for the businesses list (funnel).
 *
 * Everything is driven by search params so any view is a shareable URL — Roman
 * opens the same filtered list on his phone that he had on the desktop. The
 * filtering happens in Postgres, not in JS over a fetched page: the "score ≥ N,
 * sorted by score" view has to be right across the whole campaign, not across
 * the first 300 rows.
 *
 * Contacts and gaps are aggregated in correlated subqueries rather than joined
 * and grouped, because a business has many of each and a join would multiply
 * rows before the LIMIT ever applies.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { normalizeBuildPolicy, type BuildPolicy } from './buildPolicy';
import { NO_VERDICT, SORT_FIELDS, type SortField } from './sort';

// The sort/verdict vocabulary lives in `./sort` because the filter bar is a
// CLIENT component: importing it from here would drag `pg` (and `net`/`tls`)
// into the browser bundle and fail the build.
export { NO_VERDICT, SORT_FIELDS, SORT_LABELS, type SortField } from './sort';

/** Whitelisted ORDER BY fragments — the sort key never reaches SQL as a string. */
const ORDER_BY: Record<SortField, { asc: string; desc: string }> = {
  score: { asc: 'b.score asc nulls last', desc: 'b.score desc nulls last' },
  review_count: { asc: 'b.review_count asc nulls last', desc: 'b.review_count desc nulls last' },
  rating: { asc: 'b.rating asc nulls last', desc: 'b.rating desc nulls last' },
  updated_at: { asc: 'b.updated_at asc', desc: 'b.updated_at desc' },
  name: { asc: 'b.name asc', desc: 'b.name desc' },
};

export interface BusinessFilters {
  campaign: string | null;
  statuses: string[];
  verdicts: string[];
  /** 'instagram' | 'whatsapp' | 'email' — each requires at least one such contact. */
  contacts: string[];
  minScore: number | null;
  q: string | null;
  sort: SortField;
  dir: 'asc' | 'desc';
}

export interface BusinessRow {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  statusReason: string | null;
  score: number | null;
  rating: number | null;
  reviewCount: number | null;
  updatedAt: Date;
  verdict: string | null;
  hasInstagram: boolean;
  hasWhatsapp: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  openGaps: string[];
  deployUrl: string | null;
  /** State of the newest site_project, or null when none was ever created. */
  projectState: string | null;
  /** Status of the newest content-and-design/build-site job, or null. */
  buildJobStatus: string | null;
  /** VERIFIED social channels only — an unverified candidate is not "found". */
  verifiedSocials: string[];
  /** Status of the newest enrich-socials job, or null. */
  socialsJobStatus: string | null;
  autoBuild: BuildPolicy;
  /**
   * Has the pipeline actually collected anything about this business?
   *
   * "No open gaps" on a row with zero facts, zero contacts and no audit means
   * nobody looked, not that everything is in order (sweep P1-2). The build gate
   * needs to tell those apart, so the query answers it rather than inferring it
   * from a gap count that is empty for both reasons.
   */
  hasEvidence: boolean;
}

/** Reads the filters out of the URL, applying the defaults Roman asked for. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): BusinessFilters {
  const one = (k: string): string | null => {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : null;
  };
  // Multi-value params arrive either repeated (?status=a&status=b) or
  // comma-joined; both are accepted so hand-edited URLs work.
  const many = (k: string): string[] => {
    const v = params[k];
    if (v === undefined) return [];
    const list = Array.isArray(v) ? v : [v];
    return [...new Set(list.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))];
  };

  const sortRaw = one('sort');
  const sort: SortField = (SORT_FIELDS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as SortField)
    : 'score';
  const dir = one('dir') === 'asc' ? 'asc' : 'desc';
  const minScoreRaw = one('minScore');
  const minScore = minScoreRaw !== null && Number.isFinite(Number(minScoreRaw))
    ? Number(minScoreRaw)
    : null;

  return {
    campaign: one('campaign'),
    statuses: many('status'),
    verdicts: many('verdict'),
    contacts: many('contact'),
    minScore,
    q: one('q'),
    sort,
    dir,
  };
}

/** Is any filter set at all? Used to tell "fresh visit" from "user cleared everything". */
export function hasAnyFilter(params: Record<string, string | string[] | undefined>): boolean {
  return ['campaign', 'status', 'verdict', 'contact', 'minScore', 'q', 'sort', 'dir']
    .some((k) => params[k] !== undefined);
}

/** Serialises filters back into a query string, so links preserve the view. */
export function filtersToQuery(f: Partial<BusinessFilters>): string {
  const p = new URLSearchParams();
  if (f.campaign) p.set('campaign', f.campaign);
  for (const s of f.statuses ?? []) p.append('status', s);
  for (const v of f.verdicts ?? []) p.append('verdict', v);
  for (const c of f.contacts ?? []) p.append('contact', c);
  if (f.minScore !== null && f.minScore !== undefined) p.set('minScore', String(f.minScore));
  if (f.q) p.set('q', f.q);
  if (f.sort) p.set('sort', f.sort);
  if (f.dir) p.set('dir', f.dir);
  return p.toString();
}

/**
 * `x in (…)` from a JS array.
 *
 * NOT `= any(${list})`: drizzle's `sql` template expands an array into separate
 * placeholders (`$2, $3, $4`), which Postgres rejects as "op ANY/ALL (array)
 * requires array on right side". Joining the placeholders into an IN list is
 * what actually parameterises each value.
 */
function inList(column: SQL, values: string[]): SQL {
  return sql`${column} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/** `channel` values in business_contacts that count as each contact filter. */
const CONTACT_CHANNELS: Record<string, string[]> = {
  instagram: ['instagram'],
  whatsapp: ['whatsapp'],
  email: ['email'],
};

export async function queryBusinesses(
  f: BusinessFilters,
  limit = 500,
): Promise<BusinessRow[]> {
  const where = [sql`true`];
  if (f.campaign) where.push(sql`b.campaign_id = ${f.campaign}`);
  if (f.statuses.length) where.push(inList(sql`b.status`, f.statuses));
  if (f.minScore !== null) where.push(sql`coalesce(b.score, 0) >= ${f.minScore}`);
  if (f.q) where.push(sql`(b.name ilike ${`%${f.q}%`} or b.id ilike ${`%${f.q}%`})`);
  // Filtering on the LATEST verdict, not "has ever had one of these verdicts":
  // a re-audit after the business published a site must move it out of the list.
  // `__none__` is the "never audited" bucket, which is a real operator question
  // ("what has the audit not reached yet?") and needs IS NULL, not a value match.
  if (f.verdicts.length) {
    const wantsNone = f.verdicts.includes(NO_VERDICT);
    const named = f.verdicts.filter((v) => v !== NO_VERDICT);
    if (wantsNone && named.length) where.push(sql`(a.verdict is null or ${inList(sql`a.verdict`, named)})`);
    else if (wantsNone) where.push(sql`a.verdict is null`);
    else if (named.length) where.push(inList(sql`a.verdict`, named));
  }
  for (const c of f.contacts) {
    const channels = CONTACT_CHANNELS[c];
    if (!channels) continue;
    where.push(sql`exists (
      select 1 from business_contacts bc
      where bc.business_id = b.id and ${inList(sql`bc.channel`, channels)}
    )`);
  }

  const order = ORDER_BY[f.sort][f.dir];
  const rows = await db.execute(sql`
    select
      b.id, b.campaign_id as "campaignId", b.name, b.status,
      b.status_reason as "statusReason", b.score, b.rating,
      b.review_count as "reviewCount", b.updated_at as "updatedAt",
      a.verdict,
      c.autoBuild as "autoBuild",
      exists (select 1 from business_contacts bc
              where bc.business_id = b.id and bc.channel = 'instagram') as "hasInstagram",
      exists (select 1 from business_contacts bc
              where bc.business_id = b.id and bc.channel = 'whatsapp') as "hasWhatsapp",
      exists (select 1 from business_contacts bc
              where bc.business_id = b.id and bc.channel = 'email') as "hasEmail",
      (b.phone is not null) as "hasPhone",
      -- HARD gaps only. Soft rows are enrichment notes ("no prices listed"),
      -- not readiness blockers, and a production_ready business routinely
      -- carries a dozen of them — counting those would make the column
      -- meaningless and would wrongly disable the build button.
      coalesce(
        (select array_agg(pg.gap order by pg.gap)
         from production_gaps pg
         where pg.business_id = b.id
           and pg.resolved = false and pg.blocker_level = 'hard'),
        '{}'::text[]
      ) as "openGaps",
      -- Only VERIFIED rows. An unverified candidate is precisely the case the
      -- socials action still has work to do on, so counting it as "found" would
      -- make the bulk action skip the businesses that need it most.
      coalesce(
        (select array_agg(distinct bc.channel)
         from business_contacts bc
         where bc.business_id = b.id and bc.verified = true
           and bc.channel in ('instagram', 'facebook', 'tiktok')),
        '{}'::text[]
      ) as "verifiedSocials",
      -- "Did anyone look?" — one fact or one contact is enough to say yes.
      -- exists() stops at the first row, so this costs nothing per business.
      (exists (select 1 from business_facts bf where bf.business_id = b.id)
       or exists (select 1 from business_contacts bc2 where bc2.business_id = b.id))
        as "hasEvidence",
      sp.deploy_url as "deployUrl",
      sp.state as "projectState",
      j.status as "buildJobStatus",
      sj.status as "socialsJobStatus"
    from businesses b
    left join lateral (
      select w.verdict from website_audits w
      where w.business_id = b.id order by w.audited_at desc limit 1
    ) a on true
    left join lateral (
      select cc.auto_build as autoBuild from campaigns cc where cc.id = b.campaign_id
    ) c on true
    left join lateral (
      select s.deploy_url, s.state from site_projects s
      where s.business_id = b.id order by s.created_at desc limit 1
    ) sp on true
    left join lateral (
      select wj.status from workflow_jobs wj
      where wj.business_id = b.id
        and wj.job_type in ('content-and-design', 'build-site')
      order by wj.created_at desc limit 1
    ) j on true
    left join lateral (
      select wj.status from workflow_jobs wj
      where wj.business_id = b.id and wj.job_type = 'enrich-socials'
      order by wj.created_at desc limit 1
    ) sj on true
    where ${sql.join(where, sql` and `)}
    order by ${sql.raw(order)}, b.id asc
    limit ${limit}
  `);

  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    campaignId: String(r.campaignId),
    name: String(r.name),
    status: String(r.status),
    statusReason: (r.statusReason as string | null) ?? null,
    score: r.score === null ? null : Number(r.score),
    rating: r.rating === null ? null : Number(r.rating),
    reviewCount: r.reviewCount === null ? null : Number(r.reviewCount),
    updatedAt: new Date(r.updatedAt as string),
    verdict: (r.verdict as string | null) ?? null,
    hasInstagram: Boolean(r.hasInstagram),
    hasWhatsapp: Boolean(r.hasWhatsapp),
    hasEmail: Boolean(r.hasEmail),
    hasPhone: Boolean(r.hasPhone),
    openGaps: (r.openGaps as string[] | null) ?? [],
    deployUrl: (r.deployUrl as string | null) ?? null,
    projectState: (r.projectState as string | null) ?? null,
    verifiedSocials: (r.verifiedSocials as string[] | null) ?? [],
    socialsJobStatus: (r.socialsJobStatus as string | null) ?? null,
    buildJobStatus: (r.buildJobStatus as string | null) ?? null,
    autoBuild: normalizeBuildPolicy(r.autoBuild as string | null),
    hasEvidence: Boolean(r.hasEvidence),
  }));
}
