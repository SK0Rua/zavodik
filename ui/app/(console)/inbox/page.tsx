import Link from 'next/link';
import { loadInbox } from '@/lib/inbox';
import { ApprovalCard } from '@/components/ApprovalCard';
import { BuildReviewCard } from '@/components/BuildReviewCard';
import { InterruptedBuildCard, JobProblemCard, ReplyCard } from '@/components/InboxSmallCards';
import { Metric } from '@/components/Status';

export const dynamic = 'force-dynamic';

/**
 * The home page: everything waiting for Roman, newest first, one card each.
 *
 * Ordering is by how much a decision is worth, not by timestamp alone: a reply
 * from a real business beats a demo waiting for approval, which beats a build
 * the critic rejected, which beats a broken job. Within a kind, newest first.
 * There are no tabs and no filters here on purpose — a to-do list you have to
 * filter is a to-do list you do not trust.
 */
export default async function InboxPage({
  searchParams,
}: { searchParams: Promise<{ business?: string }> }) {
  const { business } = await searchParams;
  const { approvals, buildReviews, interruptedBuilds, jobs, replies, counts } = await loadInbox();

  // Telegram links carry ?business=<id> so a push lands on that one card.
  const focus = business
    ? {
        approvals: approvals.filter((a) => a.businessId === business),
        buildReviews: buildReviews.filter((b) => b.businessId === business),
        interruptedBuilds: interruptedBuilds.filter((b) => b.businessId === business),
        jobs: jobs.filter((j) => j.businessId === business),
        replies: replies.filter((r) => r.businessId === business),
      }
    : { approvals, buildReviews, interruptedBuilds, jobs, replies };

  const total = focus.approvals.length + focus.buildReviews.length
    + focus.interruptedBuilds.length + focus.jobs.length + focus.replies.length;
  const allTotal = approvals.length + buildReviews.length + interruptedBuilds.length
    + jobs.length + replies.length;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-6">
        <h1 className="h-page">Вхідні</h1>
        {business && allTotal > total && (
          <Link href="/inbox" className="link text-sm">Показати все ({allTotal})</Link>
        )}
      </div>

      {total === 0 ? (
        <div className="card p-8 sm:p-12 text-center">
          <p className="text-lg font-medium">
            {business ? 'Для цього бізнесу нічого не чекає.' : 'Нічого не чекає. Фабрика працює.'}
          </p>
          <div className="flex justify-center gap-10 sm:gap-14 mt-8">
            <Metric value={counts.working} label="у роботі" />
            <Metric value={counts.demosReady} label="демо готові" />
            <Metric value={counts.contacted} label="відправлено" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {focus.replies.map((r) => <ReplyCard key={`reply-${r.businessId}`} item={r} />)}
          {focus.approvals.map((a) => (
            <ApprovalCard key={`approval-${a.approvalId ?? a.businessId}`} item={a} />
          ))}
          {focus.buildReviews.map((b) => (
            <BuildReviewCard key={`build-${b.projectId}`} item={b} />
          ))}
          {/* Above the broken steps: this one is a single button away from
              being resolved, and it is the newest thing that went wrong. */}
          {focus.interruptedBuilds.map((b) => (
            <InterruptedBuildCard key={`interrupted-${b.projectId}`} item={b} />
          ))}
          {focus.jobs.map((j) => <JobProblemCard key={`job-${j.jobId}`} item={j} />)}
        </div>
      )}
    </div>
  );
}
