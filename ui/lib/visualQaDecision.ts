import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';

/**
 * Close the workflow wait after Roman has made one of the three build decisions.
 *
 * Project state controls the pipeline; this row controls job reporting. Both
 * must advance, or the resolved QA verdict resurfaces as a fake retryable error.
 */
export async function closeVisualQaVerdict(projectId: number, decision: string): Promise<void> {
  try {
    await db.update(schema.workflowJobs)
      .set({
        status: 'cancelled',
        errorCode: null,
        errorDetail: `Роман вирішив QA-вердикт: ${decision}`,
        finishedAt: new Date(),
      })
      .where(and(
        eq(schema.workflowJobs.jobType, 'visual-qa'),
        eq(schema.workflowJobs.status, 'needs_human'),
        sql`${schema.workflowJobs.payload}->>'projectId' = ${String(projectId)}`,
      ));
  } catch (error) {
    // The project state is the pipeline gate, and Inbox independently suppresses
    // this historical row. Journal cleanup must never abort Roman's real action.
    console.error('failed to close visual-QA verdict journal row', { projectId, decision, error });
  }
}
