import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { readRawJson } from '@/lib/objectStore';
import { Status } from '@/components/Status';
import { fmtDate } from '@/lib/format';
import {
  type QaReport, type QaIssue,
  WOW_AXIS_LABELS, WOW_AXIS_ORDER, RUBRIC_AXIS_LABELS, CATEGORY_LABELS,
  SEVERITY_LABELS, VIEWPORT_LABELS, shotLabel, deterministicByViewport, metricLabel,
} from '@/lib/qaReport';

export const dynamic = 'force-dynamic';

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      {title && <h3 className="label">{title}</h3>}
      {children}
    </section>
  );
}

/** 0–3 wow score as a labelled bar, matching the card's own reading of the axis. */
function WowBar({ axisKey, value }: { axisKey: string; value: number }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-ink-soft w-44 shrink-0">{WOW_AXIS_LABELS[axisKey] ?? axisKey}</span>
      <span className="flex gap-1 flex-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-2 flex-1 rounded-sm ${i < value ? 'bg-accent' : 'bg-paper-sunk border border-line'}`}
          />
        ))}
      </span>
      <span className={`text-sm tabular-nums w-10 text-right ${value <= 1 ? 'text-dot-wait' : 'text-ink'}`}>
        {value} / 3
      </span>
    </li>
  );
}

function RubricBar({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-ink-soft w-44 shrink-0">{label}</span>
      <span className="flex-1 h-2 rounded-sm bg-paper-sunk border border-line overflow-hidden" aria-hidden>
        <span className="block h-full bg-accent" style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%` }} />
      </span>
      <span className="text-sm tabular-nums w-12 text-right text-ink">{value} / 10</span>
    </li>
  );
}

const SEVERITY_TONE: Record<string, 'stop' | 'wait' | 'idle'> = {
  high: 'stop', medium: 'wait', low: 'idle',
};

function IssueRow({ issue }: { issue: QaIssue }) {
  return (
    <li className="py-3 border-b border-line last:border-0">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <Status tone={SEVERITY_TONE[issue.severity] ?? 'idle'} title={issue.severity}>
          {SEVERITY_LABELS[issue.severity] ?? issue.severity}
        </Status>
        <span className="text-sm text-ink-mute px-2 py-0.5 rounded-full border border-line">
          {CATEGORY_LABELS[issue.category] ?? issue.category}
        </span>
        <span className="text-sm text-ink-mute">{VIEWPORT_LABELS[issue.viewport] ?? issue.viewport}</span>
      </div>
      <p className="text-sm text-ink">{issue.issue}</p>
      <p className="text-sm text-ink-soft mt-1">
        <span className="text-ink-mute">Виправлення: </span>{issue.fix}
      </p>
    </li>
  );
}

export default async function QaReportPage({ params }: {
  params: Promise<{ id: string; n: string }>;
}) {
  const { id, n } = await params;
  const index = Number.parseInt(n, 10);
  if (!Number.isFinite(index) || index < 1) notFound();

  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, id));
  if (!biz) notFound();

  // The card always links to the LATEST project (`projects[0]` on the business
  // page, ordered `desc(createdAt)`); mirror that ordering here so "спроба N"
  // means the same project the card was showing when the link was clicked.
  const [proj] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.businessId, id))
    .orderBy(desc(schema.siteProjects.createdAt));
  if (!proj) notFound();

  const keys = (proj.qaReportKeys as string[] | null) ?? (proj.qaReportKey ? [proj.qaReportKey] : []);
  const key = keys[index - 1];
  if (!key) notFound();

  const report = await readRawJson<QaReport>(key);
  if (!report) notFound();

  const critique = report.critique;
  const wow = report.wow?.axes ?? critique?.wow;
  const wowTotal = report.wow?.total;
  const wowAmbition = report.wow?.ambition;
  const approved = critique?.approved ?? report.passed;
  const issues = critique?.issues ?? report.issues ?? [];
  const strengths = critique?.strengths ?? [];
  const rubric = critique?.rubric;
  const refCompare = critique?.referenceComparison;
  const detRows = deterministicByViewport(report.metrics);
  const shots = report.screenshotKeys ?? [];

  const bySeverity = {
    high: issues.filter((i) => i.severity === 'high'),
    medium: issues.filter((i) => i.severity === 'medium'),
    low: issues.filter((i) => i.severity === 'low'),
  };

  return (
    <div className="max-w-[900px]">
      <Link href={`/businesses/${id}`} className="link-quiet text-sm">
        ← {biz.name}
      </Link>

      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3">
        <h1 className="h-page">Звіт перевірки · спроба {index}</h1>
        <Status tone={approved ? 'go' : 'stop'}>
          {approved ? 'Схвалено' : 'Не схвалено'}
        </Status>
      </div>
      <p className="text-sm text-ink-mute mt-1.5">
        {fmtDate(report.at)}
        {report.designDirection && ` · ${report.designDirection}`}
        {report.durationSeconds !== undefined && ` · перевірка тривала ${Math.round(report.durationSeconds / 60)} хв`}
      </p>

      <div className="mt-6 space-y-4">
        {wow && (
          <Panel title="Враження (wow)">
            <p className="text-sm text-ink-soft mb-3">
              {wowTotal !== undefined && <>{wowTotal} з 18 загалом</>}
              {wowAmbition !== undefined && <> · амбіція {wowAmbition} з 15</>}
              {report.wow && (
                <> · поріг: {report.wow.passed
                  ? <span className="text-dot-go">пройдено</span>
                  : <span className="text-dot-stop">не пройдено</span>}
                </>
              )}
            </p>
            <ul>
              {WOW_AXIS_ORDER.map((k) => (
                wow[k as keyof typeof wow] !== undefined
                  ? <WowBar key={k} axisKey={k} value={wow[k as keyof typeof wow] as number} />
                  : null
              ))}
            </ul>
            {report.wow?.reasons && report.wow.reasons.length > 0 && (
              <div className="mt-3 pt-3 border-t border-line space-y-1.5">
                {report.wow.reasons.map((r, i) => (
                  <p key={i} className="text-sm text-dot-wait">{r}</p>
                ))}
              </div>
            )}
          </Panel>
        )}

        {rubric && (
          <Panel title="Оцінка за рубрикою §2.4">
            <ul>
              {Object.entries(rubric).map(([k, v]) => (
                <RubricBar key={k} label={RUBRIC_AXIS_LABELS[k] ?? k} value={v} />
              ))}
            </ul>
          </Panel>
        )}

        {refCompare && (
          <Panel title="Порівняння з референсом">
            <p className="text-sm text-ink-soft">
              Референс: <span className="font-mono">{refCompare.slug}</span>
              {' · '}близькість {refCompare.closeness} з 10
            </p>
            <p className="text-sm text-ink mt-2">{refCompare.gap}</p>
          </Panel>
        )}

        {detRows.length > 0 && (
          <Panel title="Технічні перевірки">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-mute border-b border-line">
                    <th className="py-1.5 pr-3 font-medium">В’юпорт</th>
                    <th className="py-1.5 pr-3 font-medium">{metricLabel('pageHeight')}</th>
                    <th className="py-1.5 pr-3 font-medium">{metricLabel('clippedText')}</th>
                    <th className="py-1.5 pr-3 font-medium">{metricLabel('consoleErrors')}</th>
                    <th className="py-1.5 pr-3 font-medium">{metricLabel('failedRequests')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detRows.map((r) => (
                    <tr key={r.viewport} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3">{VIEWPORT_LABELS[r.viewport] ?? r.viewport}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{r.pageHeight ?? '—'}</td>
                      <td className={`py-1.5 pr-3 tabular-nums ${r.clippedText ? 'text-dot-stop' : ''}`}>
                        {r.clippedText ?? '—'}
                      </td>
                      <td className={`py-1.5 pr-3 tabular-nums ${r.consoleErrors ? 'text-dot-stop' : ''}`}>
                        {r.consoleErrors ?? '—'}
                      </td>
                      <td className={`py-1.5 pr-3 tabular-nums ${r.failedRequests ? 'text-dot-stop' : ''}`}>
                        {r.failedRequests ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.motion && (
              <p className="text-sm text-ink-soft mt-3 pt-3 border-t border-line">
                Рух на першому екрані: {report.motion.heroMotionDetected ? 'виявлено' : 'не виявлено'}
                {report.motion.heroSustainedMotion !== undefined
                  && `, тримається ${report.motion.heroSustainedMotion ? 'до кінця вступу' : 'коротко'}`}
                {report.motion.animationEngines && report.motion.animationEngines.length > 0
                  && ` · механізм: ${report.motion.animationEngines.join(', ')}`}
              </p>
            )}
          </Panel>
        )}

        {/* The critic writes in English, at length. The COUNTS and severities
            are ours and stay in the open — they are what Roman judges a build
            by. The prose itself is the critic's own words and is folded, and
            labelled as English, rather than translated: paraphrasing a critic's
            findings on the page that records them would put words in its mouth
            (sweep P0-6). */}
        {issues.length > 0 && (
          <Panel title={`Зауваження критика (${issues.length})`}>
            <p className="text-sm text-ink-soft">
              {(['high', 'medium', 'low'] as const)
                .filter((sev) => bySeverity[sev].length > 0)
                .map((sev) => `${SEVERITY_LABELS[sev]} — ${bySeverity[sev].length}`)
                .join(' · ')}
            </p>
            <details className="mt-3">
              <summary className="disclosure">
                звіт критика (EN) — усі {issues.length} зауважень
              </summary>
              <div className="mt-3 pl-4 border-l-2 border-line">
                {(['high', 'medium', 'low'] as const).map((sev) => (
                  bySeverity[sev].length > 0 && (
                    <div key={sev} className="mb-4 last:mb-0">
                      <p className="text-sm text-ink-mute mb-1">
                        {SEVERITY_LABELS[sev]} ({bySeverity[sev].length})
                      </p>
                      <ul>
                        {bySeverity[sev].map((issue, i) => <IssueRow key={i} issue={issue} />)}
                      </ul>
                    </div>
                  )
                ))}
              </div>
            </details>
          </Panel>
        )}

        {strengths.length > 0 && (
          <Panel title="Що вийшло добре">
            <details>
              <summary className="disclosure">
                {strengths.length} сильних сторін — оцінка критика (EN)
              </summary>
              <ul className="space-y-2 mt-3">
                {strengths.map((s, i) => (
                  <li key={i} className="text-sm text-ink-soft pl-4 border-l-2 border-line">{s}</li>
                ))}
              </ul>
            </details>
          </Panel>
        )}

        {shots.length > 0 && (
          <Panel title="Скриншоти цієї перевірки">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {shots.map((k) => (
                <figure key={k}>
                  <a
                    href={`/api/object?bucket=raw&key=${encodeURIComponent(k)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block no-underline"
                  >
                    <img
                      src={`/api/object?bucket=raw&key=${encodeURIComponent(k)}`}
                      alt="Скриншот під час перевірки"
                      className="rounded-lg border border-line w-full h-48 object-cover object-top"
                    />
                  </a>
                  <figcaption className="text-sm text-ink-mute mt-1 truncate" title={k}>
                    {shotLabel(k)}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Panel>
        )}

        {(report.builderNotes || (report.builderUnresolved && report.builderUnresolved.length > 0)) && (
          <Panel title="Нотатки будівельника">
            {report.builderNotes && (
              <details>
                <summary className="disclosure">
                  нотатки збірки (EN)
                </summary>
                <p className="text-sm text-ink-soft whitespace-pre-wrap mt-3 pl-4 border-l-2 border-line">
                  {report.builderNotes}
                </p>
              </details>
            )}
            {report.builderUnresolved && report.builderUnresolved.length > 0 && (
              <ul className="mt-3 pt-3 border-t border-line space-y-1.5">
                {report.builderUnresolved.map((u, i) => (
                  <li key={i} className="text-sm text-dot-wait">{u}</li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <p className="text-sm">
          <a
            href={`/api/object?bucket=raw&key=${encodeURIComponent(key)}`}
            target="_blank"
            rel="noreferrer"
            className="link-quiet"
          >
            сирий JSON ↗
          </a>
        </p>
      </div>
    </div>
  );
}
