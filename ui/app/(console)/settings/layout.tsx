import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { SettingsNav } from '@/components/SettingsNav';

export const dynamic = 'force-dynamic';

/**
 * Shared shell for every settings section: the page title once, the sidebar
 * once, and the content of exactly one section beside it. The problem count for
 * «Діагностика» is loaded here so a failed job is visible from ANY section, not
 * only when Roman happens to open the diagnostics page itself.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const problemRows = await db.select({ n: sql<number>`count(*)` }).from(schema.workflowJobs)
    .where(inArray(schema.workflowJobs.status, ['failed', 'needs_human']));

  return (
    <div>
      <h1 className="h-page mb-5">Налаштування</h1>
      <div className="flex flex-col md:flex-row md:items-start gap-5 md:gap-8">
        <SettingsNav problemCount={Number(problemRows[0]?.n ?? 0)} />
        <div className="flex-1 min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
