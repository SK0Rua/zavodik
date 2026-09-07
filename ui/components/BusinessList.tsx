'use client';

import { useState, useTransition } from 'react';
import { Status } from './Status';
import { QuickViewModal } from './QuickViewModal';
import { safeHttpUrl } from '@/lib/format';
import type { DotTone } from '@/lib/humanStatus';
import {
  startDemoBuild, startDemoBuildBulk, startEnrichment, startEnrichmentBulk,
  startSocialsDiscoveryBulk,
} from '@/lib/actions';
import {
  archiveBusinessAction, deleteBusinessAction, unarchiveBusinessAction,
} from '@/lib/archiveActions';
import { runWithToast } from '@/lib/toast';
import type { BuildButtonState } from '@/lib/buildPolicy';
import type { SocialsButtonState } from '@/lib/socials';

/** The archive actions take FormData (the shape every other mutation uses). */
function formDataOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

export interface ListRow {
  id: string;
  name: string;
  /** The campaign's niche, shown next to the row. */
  niche: string;
  /** One human phrase, already composed on the server. */
  statusText: string;
  statusTone: DotTone;
  /** Raw enum, kept only as a tooltip so debugging is still possible. */
  rawStatus: string;
  score: number | null;
  verdictText: string;
  contacts: string[];
  deployUrl: string | null;
  build: BuildButtonState;
  socials: SocialsButtonState;
  /**
   * The business rests at `prequalified` because the campaign's stop-point is
   * `discover` — a reviewable lead waiting for Roman's «Зібрати дані». True only
   * then, so the button appears exactly where data collection is the next step.
   */
  canEnrich: boolean;
  /** On the archive shelf: the row offers restore/delete instead of work. */
  archived: boolean;
  /**
   * False when outreach already happened, which makes a hard delete impossible
   * (see `src/orchestrator/archiveService.ts`). The server refuses either way;
   * this only decides whether the button is offered at all, so Roman is never
   * shown an action that can only fail.
   */
  canDelete: boolean;
}

/**
 * The businesses list.
 *
 * A `<table>` with eleven columns was the old shape; on a phone it either
 * scrolled sideways or squeezed every cell to two characters. This is a list of
 * rows instead: name and status always, score and contacts when there is room.
 * Selection (and with it the bulk bar) appears only after the first checkbox —
 * on a normal read there is nothing to look at but names and states.
 */
export function BusinessList({ rows }: { rows: ListRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ id: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedRows = rows.filter((r) => selected.has(r.id));
  // `enabled` is already false for disqualified rows, so the bulk count agrees
  // with what each row shows — the count, the row and the card all read the
  // same `availability` and cannot drift apart (sweep P1-1).
  const buildable = selectedRows.filter((r) => r.build.enabled);
  const searchable = selectedRows.filter((r) => r.socials.enabled);
  const enrichable = selectedRows.filter((r) => r.canEnrich);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runOne = (row: ListRow) => {
    // Two different confirms, because they are two different decisions.
    // Overriding a disqualification is Roman disagreeing with the factory's
    // verdict; it must say so rather than reuse the "no gaps" wording.
    if (row.build.availability === 'disqualified') {
      if (!window.confirm(
        `Побудувати демо для «${row.name}» попри вердикт?\n\n`
        + `${row.build.disqualifiedText ?? 'Фабрика вирішила, що демо тут не потрібне'}.\n\n`
        + 'Ти можеш це перекрити — збірка почнеться попри вердикт.',
      )) return;
    } else if (row.build.needsConfirm && !window.confirm(
      `Почати збірку демо для «${row.name}»?\n\n`
      + 'Бізнес у стані «потрібна твоя увага», але всі пропуски закриті — '
      + 'він перейде в «готово до демо» від твого імені.',
    )) return;
    startTransition(() => {
      void runWithToast(() => startDemoBuild(row.id), {
        onResult: () => setSelected((prev) => {
          const n = new Set(prev); n.delete(row.id); return n;
        }),
      });
    });
  };

  const runBulkBuild = () => {
    const ids = buildable.map((r) => r.id);
    if (!ids.length) return;
    const ignored = selected.size - ids.length;
    if (!window.confirm(
      `Почати збірку демо для ${ids.length} бізнесів?`
      + (ignored > 0 ? `\n\n${ignored} з обраних пропустимо — для них збірка зараз неможлива.` : ''),
    )) return;
    // A bulk result enumerates every business it skipped and why, which is more
    // than a toast should hold — so the toast confirms the click and the banner
    // keeps the list to read through afterwards.
    startTransition(() => {
      void runWithToast(() => startDemoBuildBulk(ids), {
        onResult: (res) => { setMessage(res.message); setSelected(new Set()); },
      });
    });
  };

  const runOneEnrich = (row: ListRow) => {
    startTransition(() => {
      void runWithToast(() => startEnrichment(row.id), {
        onResult: () => setSelected((prev) => {
          const n = new Set(prev); n.delete(row.id); return n;
        }),
      });
    });
  };

  const runBulkEnrich = () => {
    const ids = enrichable.map((r) => r.id);
    if (!ids.length) return;
    const ignored = selected.size - ids.length;
    if (!window.confirm(
      `Зібрати дані для ${ids.length} бізнесів?`
      + '\n\nФабрика збере фото, факти й зробить аудит сайтів. Демо це ще не будує.'
      + (ignored > 0 ? `\n\n${ignored} з обраних пропустимо — для них збір даних зараз недоступний.` : ''),
    )) return;
    startTransition(() => {
      void runWithToast(() => startEnrichmentBulk(ids), {
        onResult: (res) => { setMessage(res.message); setSelected(new Set()); },
      });
    });
  };

  const runArchive = (row: ListRow) => {
    if (!window.confirm(
      `Заархівувати «${row.name}»?\n\n`
      + 'Він зникне зі списків і з інбоксу, активні задачі буде скасовано. '
      + 'Це оборотно — повернути можна з архіву.',
    )) return;
    startTransition(() => {
      void runWithToast(() => archiveBusinessAction(formDataOf({ businessId: row.id })));
    });
  };

  const runUnarchive = (row: ListRow) => {
    startTransition(() => {
      void runWithToast(() => unarchiveBusinessAction(formDataOf({ businessId: row.id })));
    });
  };

  const runDelete = (row: ListRow) => {
    // Deliberately types-the-name rather than a plain OK: this is the only
    // irreversible action in the list, and the confirm has to cost more than a
    // reflex click on a row you did not mean to be on.
    const answer = window.prompt(
      `Видалити «${row.name}» НАЗАВЖДИ?\n\n`
      + 'Зникнуть усі зібрані дані, фото, аудити й збірки. Це не можна скасувати.\n\n'
      + 'Щоб підтвердити, введи: видалити',
    );
    if (answer?.trim().toLowerCase() !== 'видалити') return;
    startTransition(() => {
      void runWithToast(() => deleteBusinessAction(formDataOf({ businessId: row.id })), {
        onResult: () => setSelected((prev) => {
          const n = new Set(prev); n.delete(row.id); return n;
        }),
      });
    });
  };

  const runBulkArchive = () => {
    const ids = selectedRows.filter((r) => !r.archived).map((r) => r.id);
    if (!ids.length) return;
    if (!window.confirm(
      `Заархівувати ${ids.length} бізнесів?\n\n`
      + 'Вони зникнуть зі списків, активні задачі буде скасовано. Це оборотно.',
    )) return;
    startTransition(() => {
      void (async () => {
        // No bulk endpoint: archiving is one transaction per business by
        // design (each cancels its own jobs), so the loop is the honest shape
        // rather than a fake batch that would hide a partial failure.
        let done = 0;
        for (const id of ids) {
          const res = await archiveBusinessAction(formDataOf({ businessId: id }));
          if (res.ok) done += 1;
        }
        setMessage(done === ids.length
          ? `Заархівовано: ${done}.`
          : `Заархівовано ${done} із ${ids.length}. Решту не вдалось — онови сторінку.`);
        setSelected(new Set());
      })();
    });
  };

  const runBulkSocials = () => {
    const ids = searchable.map((r) => r.id);
    if (!ids.length) return;
    const ignored = selected.size - ids.length;
    if (!window.confirm(
      `Дошукати соцмережі для ${ids.length} бізнесів?`
      + (ignored > 0 ? `\n\n${ignored} пропустимо: вже знайдені або пошук у черзі.` : ''),
    )) return;
    startTransition(() => {
      void runWithToast(() => startSocialsDiscoveryBulk(ids), {
        onResult: (res) => { setMessage(res.message); setSelected(new Set()); },
      });
    });
  };

  return (
    <section className="card overflow-hidden">
      {/* The bulk bar exists only when something is selected. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-line bg-accent-soft">
          <span className="text-sm font-medium">Обрано: {selected.size}</span>
          {enrichable.length > 0 && (
            <button
              type="button"
              className="btn-outline btn-sm"
              disabled={pending}
              onClick={runBulkEnrich}
            >
              Зібрати дані ({enrichable.length})
            </button>
          )}
          <button
            type="button"
            className="btn-outline btn-sm"
            disabled={buildable.length === 0 || pending}
            onClick={runBulkBuild}
          >
            Будувати демо ({buildable.length})
          </button>
          <button
            type="button"
            className="btn-outline btn-sm"
            disabled={searchable.length === 0 || pending}
            onClick={runBulkSocials}
          >
            Дошукати соцмережі ({searchable.length})
          </button>
          {selectedRows.some((r) => !r.archived) && (
            <button
              type="button"
              className="btn-outline btn-sm"
              disabled={pending}
              onClick={runBulkArchive}
            >
              В архів ({selectedRows.filter((r) => !r.archived).length})
            </button>
          )}
          <button type="button" className="btn-quiet btn-sm ml-auto" onClick={() => setSelected(new Set())}>
            Зняти вибір
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="px-4 py-3 text-sm text-ink-soft border-b border-line bg-paper-sunk">
          {message}
        </p>
      )}

      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            data-business-id={r.id}
            className="row grid-cols-[auto_1fr] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]"
          >
            <input
              type="checkbox"
              aria-label={`Обрати ${r.name}`}
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
            />

            <div className="min-w-0">
              {/* The name opens a quick-view modal instead of navigating away:
                  Roman judges a lead in place and drills into the full card from
                  inside the modal. Left-aligned and underlined so it still reads
                  as the row's actionable title on a phone, which has no hover. */}
              <button
                type="button"
                className="link font-medium text-left"
                onClick={() => setQuick({ id: r.id, name: r.name })}
              >
                {r.name}
              </button>
              {r.niche && (
                <span className="ml-2 text-sm text-ink-mute">{r.niche}</span>
              )}
              <div className="mt-0.5">
                <Status tone={r.statusTone} title={r.rawStatus}>{r.statusText}</Status>
              </div>
              {/* On a phone the columns below collapse into this line. */}
              <div className="text-sm text-ink-mute mt-0.5 sm:hidden">
                {[r.score !== null ? `бал ${r.score}` : null, r.verdictText, r.contacts.join(' ')]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>

            <span className="hidden sm:block text-sm text-ink-mute tabular-nums text-right w-12">
              {r.score ?? '—'}
            </span>

            <span className="hidden sm:block text-sm text-ink-mute whitespace-nowrap">
              {r.contacts.join(' ') || '—'}
            </span>

            {/* The action. NOT `hidden sm:flex` any more: that hid the product's
                main verb on the device SPEC §12 names as the target, so on a
                phone the only way to build anything was to tick a checkbox and
                use the bulk bar (sweep P0-4).

                On desktop it sits in its own trailing column. On a phone the
                grid has two columns, so this cell lands on a second line
                spanning under the name — full width, left-aligned, with a real
                44px tap target rather than a squeezed icon. */}
            <span
              className="col-start-2 sm:col-start-auto mt-2 sm:mt-0
                         flex items-center gap-3 flex-wrap
                         justify-start sm:justify-end sm:min-w-[140px]"
            >
              {r.archived ? (
                // An archived row offers only the two ways off the shelf. The
                // work actions are deliberately gone: archiving cancelled the
                // jobs behind them, so «Будувати демо» here would silently
                // un-do the archive's whole point.
                <>
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={pending}
                    onClick={() => runUnarchive(r)}
                  >
                    Повернути
                  </button>
                  {r.canDelete && (
                    <button
                      type="button"
                      className="btn-quiet btn-sm text-danger"
                      disabled={pending}
                      onClick={() => runDelete(r)}
                    >
                      Видалити
                    </button>
                  )}
                </>
              ) : (
                <>
                  <RowAction
                    row={r} pending={pending}
                    onBuild={() => runOne(r)}
                    onEnrich={() => runOneEnrich(r)}
                    onQuick={() => setQuick({ id: r.id, name: r.name })}
                  />
                  <button
                    type="button"
                    className="btn-quiet btn-sm"
                    disabled={pending}
                    onClick={() => runArchive(r)}
                    title="Прибрати зі списків; активні задачі буде скасовано"
                  >
                    В архів
                  </button>
                </>
              )}
            </span>
          </li>
        ))}

        {rows.length === 0 && (
          <li className="px-4 py-10 text-center text-ink-mute">
            Нічого не знайшлось. Спробуй прибрати фільтри.
          </li>
        )}
      </ul>

      {quick && (
        <QuickViewModal
          businessId={quick.id}
          fallbackName={quick.name}
          onClose={() => setQuick(null)}
        />
      )}
    </section>
  );
}

/**
 * The one action on a row, in the state the row is actually in.
 *
 * The old version had exactly two outcomes — a live «Будувати демо» or a greyed
 * one — and used the live variant for a business the factory had explicitly
 * REFUSED to build for, and for a business nobody had ever looked at (sweep
 * P1-1, P1-2). Three visibly different things happen here instead:
 *
 *  - a built demo → a link to it, because that is what you want next;
 *  - disqualified → NO button, the decision written out, and a quiet override
 *    link, because Roman overrules the factory rather than the reverse;
 *  - never checked → a disabled button that says «Ще не перевірено», which is
 *    a different sentence from «пропуски не закриті» and a different sentence
 *    again from an inviting green button.
 */
function RowAction({ row, pending, onBuild, onEnrich, onQuick }: {
  row: ListRow;
  pending: boolean;
  onBuild: () => void;
  onEnrich: () => void;
  onQuick: () => void;
}) {
  // A build is in flight. The most useful action here is not a disabled
  // «Будувати демо» but a way to WATCH it — the live panel opens in the modal,
  // which is where "чи не зависло" is actually answered.
  if (row.build.availability === 'busy') {
    return (
      <button
        type="button"
        className="btn-quiet btn-sm min-h-[36px]"
        title="Показати збірку наживо — таймлайн, дії агента і сигнал, чи вона ще жива"
        onClick={onQuick}
      >
        Дивитись збірку
      </button>
    );
  }

  // A lead waiting in the reviewable list: its next step is data collection, not
  // a build. Show that verb instead of a disabled «Будувати демо».
  if (row.canEnrich) {
    return (
      <button
        type="button"
        className="btn-quiet btn-sm min-h-[36px]"
        disabled={pending}
        title="Зібрати фото, факти й зробити аудит сайту. Демо це ще не будує."
        onClick={onEnrich}
      >
        Зібрати дані
      </button>
    );
  }

  if (row.deployUrl) {
    return (
      <a
        href={safeHttpUrl(row.deployUrl)}
        target="_blank"
        rel="noreferrer"
        className="link text-sm"
      >
        Демо ↗
      </a>
    );
  }

  if (row.build.availability === 'disqualified') {
    return (
      <>
        <span className="text-sm text-ink-mute">
          {row.build.disqualifiedText ?? 'Демо не потрібне'}
        </span>
        <button
          type="button"
          className="link-quiet text-sm"
          disabled={pending}
          title={row.build.hint}
          onClick={onBuild}
        >
          все одно побудувати
        </button>
      </>
    );
  }

  if (row.build.availability === 'unknown') {
    return (
      <button
        type="button"
        className="btn-quiet btn-sm min-h-[36px]"
        disabled
        title={row.build.hint}
      >
        Ще не перевірено
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-quiet btn-sm min-h-[36px]"
      disabled={!row.build.enabled || pending}
      title={row.build.hint}
      onClick={onBuild}
    >
      Побудувати демо
    </button>
  );
}
