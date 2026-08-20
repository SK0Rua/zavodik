/**
 * Everything waiting for Roman, as ONE list.
 *
 * Before this, the four things that need a human lived on four pages: approvals
 * on /approvals, a rejected build only inside a business card (invisible unless
 * you knew to look), broken jobs on /jobs, replies on /conversations. The
 * question "what do I have to do right now?" had no single answer.
 *
 * So the inbox is defined by that question and nothing else: an item is here iff
 * the factory cannot proceed without a decision from Roman. Everything the
 * factory can still do on its own stays out, however interesting it is.
 */
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { loadApprovalQueue, type ApprovalItem } from './approvals';

export type InboxKind = 'approval' | 'build_review' | 'job' | 'reply';

export interface BuildReviewItem {
  projectId: number;
  businessId: string;
  name: string;
  campaignId: string;
  score: number | null;
  qaIterations: number;
  openIssues: string[];
  designDirection: string | null;
  /** QA wow score out of 18, when the critic scored it. */
  wowTotal: number | null;
  wowPassed: boolean | null;
  screenshotKeys: string[];
  qaReportKeys: string[];
  updatedAt: Date;
}

export interface JobProblemItem {
  jobId: number;
  jobType: string;
  status: string;
  businessId: string | null;
  businessName: string | null;
  campaignId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempts: number;
  createdAt: Date;
  /** Blocks the business until decided — shown differently and never ages out. */
  actionable: boolean;
}

export interface ReplyItem {
  businessId: string;
  name: string;
  dealState: string;
  preview: string;
  at: Date;
}

export interface InboxData {
  approvals: ApprovalItem[];
  buildReviews: BuildReviewItem[];
  jobs: JobProblemItem[];
  replies: ReplyItem[];
  /** Shown in the empty state: proof the factory is working without him. */
  counts: { working: number; demosReady: number; contacted: number };
}

/**
 * Builds the critic rejected after MAX_QA_ITERATIONS.
 *
 * These are the items that were previously invisible: the business goes to
 * `needs_review` and the project to `needs_human_review`, a Telegram push goes
 * out, and then the only way to act on it was to open the business card and read
 * a paragraph. Now it is an item with three buttons.
 */
async function loadBuildReviews(): Promise<BuildReviewItem[]> {
  const projects = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.state, 'needs_human_review'))
    .orderBy(desc(schema.siteProjects.createdAt));
  if (!projects.length) return [];

  const businesses = await db.select().from(schema.businesses)
    .where(inArray(schema.businesses.id, [...new Set(projects.map((p) => p.businessId))]));
  const bizById = new Map(businesses.map((b) => [b.id, b]));

  // Only the NEWEST rejected project per business: an older one is history, and
  // two cards for one business is exactly the noise this page removes.
  const seen = new Set<string>();
  const items: BuildReviewItem[] = [];
  for (const p of projects) {
    if (seen.has(p.businessId)) continue;
    seen.add(p.businessId);
    const biz = bizById.get(p.businessId);
    if (!biz) continue;
    const qa = p.wowScores?.qa ?? null;
    items.push({
      projectId: p.id,
      businessId: p.businessId,
      name: biz.name,
      campaignId: biz.campaignId,
      score: biz.score,
      qaIterations: p.qaIterations,
      openIssues: (p.openIssues as string[] | null) ?? [],
      designDirection: p.designDirection,
      wowTotal: qa?.total ?? null,
      wowPassed: qa?.passed ?? null,
      screenshotKeys: (p.screenshotKeys as string[] | null) ?? [],
      qaReportKeys: (p.qaReportKeys as string[] | null) ?? [],
      updatedAt: biz.updatedAt,
    });
  }
  return items;
}

/**
 * How long an INFORMATIONAL broken job stays in the inbox before it is only
 * history.
 *
 * The window exists because the page would otherwise fill with weeks of
 * failures from stages that have been fixed and re-run since — thirty cards
 * saying "збір даних про бізнес упав" for businesses that finished enrichment
 * days later. That is a log, not a to-do list.
 *
 * But it was applied to EVERYTHING, and that turned ageing into a way for work
 * to leave the to-do list without being done (audit 2026-08-20, P0-1 and P1-6):
 * the `request-approval` failure that blocked the factory's only finished demo
 * became invisible on day four, and the «Вхідні» badge dropped from 2 to 1
 * mid-session with nothing having happened. A to-do list that quietly forgets
 * is worse than a long one.
 *
 * So the window now applies ONLY to jobs whose card is informational — "this
 * stage failed, you may want to retry it". Anything that BLOCKS the pipeline
 * for a business and needs a decision stays until it is decided, however old.
 * See `BLOCKING_JOB_TYPES`.
 */
const JOB_INBOX_WINDOW_MS = 3 * 24 * 3600 * 1000;

/**
 * Job types whose failure stops a business dead and can only be cleared by
 * Roman. These never age out of the inbox.
 *
 * The test is not "how bad was the error" but "can the factory still make
 * progress on this business without him". A failed `enrich` leaves the business
 * where it was and a later re-run fixes it; a failed `request-approval` means a
 * finished, deployed demo has no way to ever be sent, and no amount of waiting
 * changes that.
 */
const BLOCKING_JOB_TYPES: ReadonlySet<string> = new Set([
  // The funnel terminates here: without an approvals row the demo is unsendable.
  'request-approval',
  // A send that broke needs a human by construction — sends are NEVER auto-retried.
  'send-outreach',
  'send-followup',
  // The build path: a business parked in a transient status with a dead build
  // is the "10–30 хвилин" lie the audit found (P0-2). It waits for a decision.
  'content-and-design',
  'build-site',
  'deploy-demo',
]);

/** Does this job need a decision from Roman, rather than just informing him? */
function isActionableJob(jobType: string): boolean {
  return BLOCKING_JOB_TYPES.has(jobType);
}

/**
 * Jobs that stopped, will not restart themselves, and are recent enough to act on.
 *
 * `retry_wait` is deliberately EXCLUDED: a subscription-limit pause resumes on
 * its own (SPEC §2.3b), so putting it in a list titled "waiting for you" would
 * be a lie. It is visible under Налаштування → Система.
 *
 * Two more things are excluded, both for the same reason — they would be a
 * SECOND card about a fact the inbox already shows once:
 *  - a job for a business whose build is already in the list as a build review
 *    (the `visual-qa` job that PARKED that build is exactly that item);
 *  - repeats of the same stage for the same business: one card per business per
 *    stage, the newest, because retrying is per stage and not per attempt.
 */
async function loadJobProblems(excludeBusinessIds: Set<string>): Promise<JobProblemItem[]> {
  const since = new Date(Date.now() - JOB_INBOX_WINDOW_MS);
  // Fetched WITHOUT a date filter, then filtered per type below: an actionable
  // job must be reachable at any age, and only informational ones are windowed.
  const all = await db.select().from(schema.workflowJobs)
    .where(inArray(schema.workflowJobs.status, ['failed', 'needs_human']))
    .orderBy(desc(schema.workflowJobs.createdAt))
    .limit(400);

  const seen = new Set<string>();
  const jobs = all.filter((j) => {
    if (!isActionableJob(j.jobType) && j.createdAt < since) return false;
    if (j.businessId && excludeBusinessIds.has(j.businessId)) return false;
    const key = `${j.jobType}:${j.businessId ?? j.campaignId ?? 'global'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
    // Actionable first, so an old blocking failure is never pushed off the end
    // of the list by a fresh informational one.
    .sort((a, b) => Number(isActionableJob(b.jobType)) - Number(isActionableJob(a.jobType)))
    .slice(0, 20);
  if (!jobs.length) return [];

  const ids = [...new Set(jobs.map((j) => j.businessId).filter((x): x is string => Boolean(x)))];
  const businesses = ids.length
    ? await db.select({ id: schema.businesses.id, name: schema.businesses.name })
        .from(schema.businesses).where(inArray(schema.businesses.id, ids))
    : [];
  const nameById = new Map(businesses.map((b) => [b.id, b.name]));

  return jobs.map((j) => ({
    jobId: j.id,
    jobType: j.jobType,
    status: j.status,
    businessId: j.businessId,
    businessName: j.businessId ? nameById.get(j.businessId) ?? null : null,
    campaignId: j.campaignId,
    errorCode: j.errorCode,
    errorDetail: j.errorDetail,
    attempts: j.attempts,
    createdAt: j.createdAt,
    actionable: isActionableJob(j.jobType),
  }));
}

/** Businesses that answered. The only inbound item, and the most valuable one. */
async function loadReplies(): Promise<ReplyItem[]> {
  const events = await db.select().from(schema.outreachEvents)
    .where(eq(schema.outreachEvents.event, 'replied'))
    .orderBy(desc(schema.outreachEvents.at))
    .limit(30);
  if (!events.length) return [];

  const ids = [...new Set(events.map((e) => e.businessId))];
  const businesses = await db.select().from(schema.businesses)
    .where(inArray(schema.businesses.id, ids));
  const bizById = new Map(businesses.map((b) => [b.id, b]));
  const deals = await db.select().from(schema.deals)
    .where(inArray(schema.deals.businessId, ids));
  const dealByBiz = new Map(deals.map((d) => [d.businessId, d]));

  // A reply stops being an inbox item once the deal has moved past `replied` —
  // Roman has already acted on it.
  const seen = new Set<string>();
  const items: ReplyItem[] = [];
  for (const e of events) {
    if (seen.has(e.businessId)) continue;
    seen.add(e.businessId);
    const biz = bizById.get(e.businessId);
    if (!biz) continue;
    const deal = dealByBiz.get(e.businessId);
    if (deal && !['contacted', 'replied'].includes(deal.state)) continue;
    items.push({
      businessId: e.businessId,
      name: biz.name,
      dealState: deal?.state ?? 'replied',
      preview: String((e.detail as Record<string, unknown> | null)?.preview ?? '').slice(0, 240),
      at: e.at,
    });
  }
  return items;
}

/** The three numbers the empty state shows: proof the factory is still running. */
async function loadCounts(): Promise<InboxData['counts']> {
  const rows = await db.execute(sql`
    select
      count(*) filter (where status in
        ('enriching','qualified','production_ready','site_in_progress'))::int as working,
      count(*) filter (where status = 'site_ready')::int as "demosReady",
      count(*) filter (where status in ('contacted','replied','meeting','proposal','won'))::int as contacted
    from businesses
  `);
  const r = (rows.rows[0] ?? {}) as Record<string, number>;
  return {
    working: Number(r.working ?? 0),
    demosReady: Number(r.demosReady ?? 0),
    contacted: Number(r.contacted ?? 0),
  };
}

export async function loadInbox(): Promise<InboxData> {
  const [approvals, buildReviews, replies, counts] = await Promise.all([
    loadApprovalQueue(),
    loadBuildReviews(),
    loadReplies(),
    loadCounts(),
  ]);
  // A build waiting for a decision already explains itself; the job that parked
  // it must not become a second card saying the same thing in worse words.
  //
  // The same now applies to approvals. Removing the inbox window for actionable
  // jobs (see JOB_INBOX_WINDOW_MS) means a `request-approval` that failed once
  // stays visible forever — correct while it is still blocking, but once the
  // stage has been re-run and the approval row EXISTS, the old failure is
  // history and the decision is the card. Without this, Pagoulatos showed both
  // its approval card and the 2026-08-16 «Крок зупинився» card for the very
  // job that has since succeeded.
  const covered = new Set([
    ...buildReviews.map((b) => b.businessId),
    ...approvals.map((a) => a.businessId),
  ]);
  const jobs = await loadJobProblems(covered);
  return { approvals, buildReviews, jobs, replies, counts };
}

/** How many items are waiting overall — the number next to «Вхідні» in the nav. */
export async function inboxCount(): Promise<number> {
  try {
    // Counted the same way the page filters, or the badge promises work that
    // is not there — the fastest way to make Roman stop trusting the number.
    const { approvals, buildReviews, jobs, replies } = await loadInbox();
    return approvals.length + buildReviews.length + jobs.length + replies.length;
  } catch {
    return 0;
  }
}
