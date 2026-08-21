import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { readRawJson } from '@/lib/objectStore';
import { fmtDate, safeHttpUrl } from '@/lib/format';
import { type BuildSnapshot, ASSET_KIND_LABELS, CHANNEL_LABELS } from '@/lib/snapshot';
import { humanVerdict, gapName, isGapKey } from '@/lib/humanStatus';
import { softGapText } from '@/lib/criticNotes';
import { parseAuditNotes } from '@/lib/auditNotes';
import { factLabel } from '@/lib/factLabels';
import { FactValue } from '@/components/FactValue';

export const dynamic = 'force-dynamic';

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      {title && <h3 className="label">{title}</h3>}
      {children}
    </section>
  );
}

/** The snapshot's fact rows carry `key` outside the declared type. */
function factKey(f: unknown): string {
  return (f as { key?: string }).key ?? '';
}

/** A small source-id chip, resolved against the snapshot's own source list. */
function SourceRefs({ ids, sourceById }: { ids: number[]; sourceById: Map<number, BuildSnapshot['sources'][number]> }) {
  if (!ids || ids.length === 0) {
    return <span className="text-sm text-dot-wait">без джерела</span>;
  }
  return (
    <span className="text-sm flex gap-2 flex-wrap">
      {ids.map((id) => {
        const src = sourceById.get(id);
        if (!src) return <span key={id} className="text-ink-mute">#{id}</span>;
        return (
          <a
            key={id}
            href={safeHttpUrl(src.url)}
            target="_blank"
            rel="noreferrer"
            title={src.method}
            className="link-quiet"
          >
            {src.type} ↗
          </a>
        );
      })}
    </span>
  );
}

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, id));
  if (!biz) notFound();

  const [proj] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.businessId, id))
    .orderBy(desc(schema.siteProjects.createdAt));
  if (!proj?.snapshotKey) notFound();

  const snap = await readRawJson<BuildSnapshot>(proj.snapshotKey);
  if (!snap) notFound();

  const sourceById = new Map(snap.sources.map((s) => [s.id, s]));

  // `review` facts repeat evidence already rendered in full in the dedicated
  // Відгуки panel below (same text, same source), and `google.attributes` is
  // the same list the individual `amenity` facts already break out one-per-row.
  // Both are dropped here rather than upstream: the snapshot is immutable
  // evidence and must keep them; this page just does not show them twice.
  const DUPLICATE_FACT_KEYS = new Set(['review', 'google.attributes']);
  const otherFactsToShow = snap.otherFacts.filter(
    (f) => !DUPLICATE_FACT_KEYS.has((f as unknown as { key?: string }).key ?? ''),
  );

  return (
    <div className="max-w-[900px]">
      <Link href={`/businesses/${id}`} className="link-quiet text-sm">
        ← {biz.name}
      </Link>

      <h1 className="h-page mt-3">Факти збірки</h1>
      <p className="text-sm text-ink-mute mt-1.5">
        Зафіксовано {fmtDate(snap.capturedAt)} — саме з цих даних побудовано демо;
        зміни у фактах бізнесу після цього моменту сюди не потрапляють.
      </p>

      <div className="mt-6 space-y-4">
        <Panel title="Хто це">
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-ink-mute">Назва</dt>
              <dd>{snap.name}</dd>
            </div>
            {snap.category && (
              <div>
                <dt className="text-ink-mute">Категорія</dt>
                <dd>{snap.category}</dd>
              </div>
            )}
            {snap.address && (
              <div>
                <dt className="text-ink-mute">Адреса</dt>
                <dd>{snap.address}{snap.city ? `, ${snap.city}` : ''}</dd>
              </div>
            )}
            <div>
              <dt className="text-ink-mute">Мова сайту</dt>
              <dd>{snap.languageName ?? snap.language}</dd>
            </div>
            {snap.rating !== null && snap.rating !== undefined && (
              <div>
                <dt className="text-ink-mute">Рейтинг</dt>
                <dd>{snap.rating} {snap.reviewCount ? `(${snap.reviewCount} відгуків)` : ''}</dd>
              </div>
            )}
            {snap.hours?.value && (
              <div className="sm:col-span-2">
                <dt className="text-ink-mute">Години роботи</dt>
                <dd className="flex items-baseline gap-2 flex-wrap">
                  <span>{snap.hours.value}</span>
                  <SourceRefs ids={snap.hours.sourceIds} sourceById={sourceById} />
                </dd>
              </div>
            )}
          </dl>
          {snap.description && (
            <p className="text-sm text-ink-soft mt-3 pt-3 border-t border-line">{snap.description}</p>
          )}
          {snap.website && (
            <p className="text-sm text-ink-soft mt-3 pt-3 border-t border-line">
              {/* `no_website` was printing as the raw enum (sweep P1-11). */}
              Їхній нинішній сайт: <span className="font-mono">{snap.website.url}</span>
              {' — '}<span title={snap.website.verdict}>{humanVerdict(snap.website.verdict).text}</span>
              {/* Frozen English in the snapshot JSON; rendered in Ukrainian
                  from the same code-side templates that wrote it. */}
              {snap.website.notes && (
                <span className="text-ink-mute" title={snap.website.notes}>
                  {' · '}{parseAuditNotes(snap.website.notes).map((n) => n.text).join(' · ')}
                </span>
              )}
            </p>
          )}
        </Panel>

        {snap.services.length > 0 && (
          <Panel title={`Послуги (${snap.services.length})`}>
            <ul>
              {snap.services.map((s, i) => (
                <li key={i} className="py-2.5 border-b border-line last:border-0">
                  <div className="flex justify-between gap-3 items-baseline">
                    <span className="text-sm font-medium">{s.value.name}</span>
                    <SourceRefs ids={s.sourceIds} sourceById={sourceById} />
                  </div>
                  {(s.value.price || s.value.description) && (
                    <p className="text-sm text-ink-soft mt-0.5">
                      {[s.value.price, s.value.description].filter(Boolean).join(' — ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {snap.contacts.length > 0 && (
          <Panel title="Контакти">
            <ul>
              {snap.contacts.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
                  <span className="text-sm text-ink-soft w-24 shrink-0">
                    {CHANNEL_LABELS[c.channel] ?? c.channel}
                  </span>
                  <span className="text-sm font-mono break-all flex-1">{c.value}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.verified && <span className="text-sm text-dot-go">підтверджено</span>}
                    <SourceRefs ids={c.sourceIds} sourceById={sourceById} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {snap.reviews.length > 0 && (
          <Panel title={`Відгуки (${snap.reviews.length})`}>
            <ul className="space-y-3">
              {snap.reviews.map((r, i) => (
                <li key={i} className="pl-4 border-l-2 border-line">
                  <p className="text-sm text-ink-soft">
                    {r.value.author && <span className="font-medium text-ink">{r.value.author}</span>}
                    {/* `rating` is often null rather than undefined, which
                        rendered as a bare «· ★» with no number (sweep P1-11). */}
                    {r.value.rating !== undefined && r.value.rating !== null && (
                      <span className="text-ink-mute"> · {r.value.rating}★</span>
                    )}
                  </p>
                  <p className="text-sm mt-0.5">{r.value.text}</p>
                  <div className="mt-1"><SourceRefs ids={r.sourceIds} sourceById={sourceById} /></div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {snap.assets.length > 0 && (
          <Panel title={`Асети (${snap.assets.length})`}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {snap.assets.map((a, i) => (
                <figure key={i}>
                  <img
                    src={`/api/object?bucket=assets&key=${encodeURIComponent(a.objectKey)}`}
                    alt={ASSET_KIND_LABELS[a.kind] ?? a.kind}
                    className="rounded-lg border border-line w-full aspect-square object-cover"
                  />
                  <figcaption className="text-sm text-ink-mute mt-1">
                    {ASSET_KIND_LABELS[a.kind] ?? a.kind}
                    {a.aiGenerated && <span className="text-dot-wait"> · згенеровано ШІ</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Panel>
        )}

        {otherFactsToShow.length > 0 && (
          <Panel title={`Інші факти (${otherFactsToShow.length})`}>
            <ul>
              {otherFactsToShow.map((f, i) => (
                <li key={i} className="py-2.5 border-b border-line last:border-0">
                  <div className="flex justify-between gap-3 items-baseline">
                    {/* Raw keys (`hours.structured`, `identity.brand_name`)
                        printed verbatim here; the same translation the Факти
                        tab uses applies (sweep P1-11). Key kept as tooltip. */}
                    <span className="text-sm text-ink-mute" title={factKey(f)}>
                      {factLabel(factKey(f))}
                    </span>
                    <SourceRefs ids={f.sourceIds} sourceById={sourceById} />
                  </div>
                  <div className="mt-0.5">
                    <FactValue factKey={factKey(f)} value={f.value} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {snap.openGaps.length > 0 && (
          <Panel title="Чого бракувало на момент збірки">
            {/* Eight lines of English (sweep P1-11). The list mixes gate KEYS
                with whole sentences the enrichment agent wrote in the language
                of the evidence, so each line is rendered by whichever of the
                two it is. `openGapsUk` is the translation frozen alongside at
                build time; snapshots taken before it existed have none, and
                fall back to the English-pattern path. */}
            <ul className="space-y-1.5">
              {snap.openGaps.map((g, i) => (
                <li key={i} className="text-sm text-dot-wait" title={g}>
                  {isGapKey(g) ? gapName(g) : softGapText(g, snap.openGapsUk?.[i])}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <p className="text-sm">
          <a
            href={`/api/object?bucket=raw&key=${encodeURIComponent(proj.snapshotKey!)}`}
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
