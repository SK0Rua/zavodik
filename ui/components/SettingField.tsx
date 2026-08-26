'use client';

/**
 * ONE parameter: its human name, its current value, where that value came from,
 * and a way to change it.
 *
 * The row is the unit of work here (Roman, 2026-08-22: «всюди насрано в купу,
 * особливо у розширених»). What made the old screen a heap was that a group of
 * eleven fields shared a single «Зберегти»: every field was permanently in edit
 * mode, so eleven inputs sat open at once, none of them told you whether the
 * value in the box was a real setting or just a default, and saving one meant
 * submitting the other ten.
 *
 * So a row is READ-ONLY until it is touched. It shows the value as text, and
 * «Зберегти» only exists once something has actually changed — which means the
 * absence of a save button is itself information: nothing here is unsaved.
 */

import { useState, useTransition } from 'react';
import { resetSettingValue, saveSettingValue, type SettingsSaveResult } from '@/lib/settingsActions';
import { runWithToast } from '@/lib/toast';
import type { SettingView } from '@/lib/settings';

/**
 * How a value reads when it is not being edited.
 *
 * Booleans get words rather than `true` / `false`, and an empty value says it is
 * empty instead of rendering as a blank gap that looks like a render bug.
 */
function display(field: SettingView): { text: string; muted: boolean } {
  if (field.secret) {
    return field.hasValue
      ? { text: field.masked, muted: false }
      : { text: 'не задано', muted: true };
  }
  if (field.kind === 'boolean') {
    return { text: field.value === 'true' ? 'увімкнено' : 'вимкнено', muted: false };
  }
  if (field.value === '') return { text: 'не задано', muted: true };
  if (field.kind === 'select' && field.value.trim() === '') return { text: 'автоматично', muted: true };
  if (field.kind === 'select' && field.optionLabels?.[field.value]) {
    return { text: field.optionLabels[field.value], muted: false };
  }
  return { text: field.value, muted: false };
}

/**
 * The provenance mark, to the right of the value.
 *
 * `db` is the only one that gets a dot: it is the only state that means "Roman
 * decided this", and therefore the only one worth spotting while scanning a
 * column of thirty rows. `env` gets quiet words because it is a real override
 * that «Скинути» cannot undo from here — the box is a file on the server.
 * `default` gets nothing at all: "this setting is at its default" is the
 * background condition of the whole page, and a badge on every untouched row is
 * exactly the noise this rebuild is removing.
 */
function Provenance({ field }: { field: SettingView }) {
  if (field.source === 'db') {
    return (
      <span className="inline-flex items-baseline gap-1.5 text-sm text-ink-soft whitespace-nowrap">
        <span aria-hidden className="inline-block w-[6px] h-[6px] rounded-full bg-accent shrink-0 translate-y-[-2px]" />
        <span title={field.updatedAt ? `${field.updatedAt}${field.updatedBy ? ` · ${field.updatedBy}` : ''}` : undefined}>
          змінено
        </span>
      </span>
    );
  }
  if (field.source === 'env') {
    return <span className="text-sm text-ink-mute whitespace-nowrap">з .env</span>;
  }
  return null;
}

/**
 * The hint, folded into an ⓘ beside the label (Roman's pick, 2026-08-22).
 *
 * Rendered inline under every row, the hints WERE the «навала тексту»: thirty
 * rows carried thirty paragraphs that Roman reads once per field per lifetime.
 * Hover or keyboard focus opens the bubble; click toggles it, which is the
 * whole story on a phone where hover does not exist.
 */
function HintTip({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  // No `relative` here on purpose: the bubble anchors to the label span in the
  // row (the nearest positioned ancestor), so its left edge lines up with the
  // label and never starts mid-viewport where 44ch would overflow the screen.
  return (
    <span className="inline-flex">
      <button
        type="button"
        aria-label={`Пояснення: ${hint}`}
        aria-expanded={open}
        className="text-ink-mute hover:text-ink transition-colors px-1 -my-1 py-1 leading-none"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((s) => !s)}
      >
        <span aria-hidden>ⓘ</span>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-max max-w-[min(44ch,calc(100vw-6rem))]
                     rounded-lg border border-line bg-paper-card shadow-card px-3 py-2
                     text-sm font-normal text-ink-soft whitespace-normal"
        >
          {hint}
        </span>
      )}
    </span>
  );
}

/** The editor for one field, by kind. Secrets always open empty. */
function Editor({ field, value, onChange }: {
  field: SettingView;
  value: string;
  onChange: (v: string) => void;
}) {
  const common = { id: field.key, name: field.key, className: 'w-full' };

  if (field.kind === 'boolean') {
    return (
      <label className="inline-flex items-center gap-2 text-sm text-ink">
        <input
          id={field.key} type="checkbox" checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span>{value === 'true' ? 'увімкнено' : 'вимкнено'}</span>
      </label>
    );
  }
  if (field.kind === 'select') {
    return (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o === '' ? 'автоматично' : (field.optionLabels?.[o] ?? o)}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'textarea') {
    return (
      <textarea
        {...common} rows={3} value={value} placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full font-mono text-sm"
      />
    );
  }
  return (
    <input
      {...common}
      type={field.secret ? 'password' : field.kind === 'number' ? 'number' : 'text'}
      value={value}
      placeholder={field.secret ? 'вставити нове значення' : field.placeholder}
      autoComplete={field.secret ? 'new-password' : 'off'}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      className={field.secret ? 'w-full font-mono text-sm' : 'w-full'}
    />
  );
}

export function SettingField({ field, locked }: {
  field: SettingView;
  /** No master key: secrets in this group cannot be written at all. */
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<SettingsSaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  // A boolean has no meaningful "read mode": the checkbox IS the value and the
  // control, so it opens live and saves on the button like everything else.
  const inline = field.kind === 'boolean';
  const open = editing || inline;

  // Secrets open empty (the plaintext never reaches the browser); everything
  // else opens at its current value so an edit is a correction, not a retype.
  function begin() {
    setDraft(field.secret ? '' : field.value);
    setResult(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft('');
    setResult(null);
  }

  // The value the editor is showing. A boolean row is always open but starts
  // untouched, so until the checkbox is clicked it reflects the saved value;
  // everything else only reaches this branch after `begin()` seeded the draft.
  const live = inline && !editing ? field.value : draft;
  // Secrets compare against '' because their plaintext never reaches the
  // browser: any typing at all is a change, and an empty box is not.
  const dirty = open && live !== (field.secret ? '' : field.value);

  /**
   * Save or reset, reporting both ways.
   *
   * The toast names the FIELD; the action's own message does not, because the
   * action answers a key and the row it came from is right there. Detached in
   * the corner it is not: «Збережено» with thirty rows on screen says nothing
   * about which of them.
   */
  function commit(run: () => Promise<SettingsSaveResult>) {
    startTransition(() => {
      void runWithToast(
        async () => {
          const res = await run();
          return { ...res, message: res.ok ? `${field.label}: ${res.message}` : res.message };
        },
        {
          onResult: (res) => {
            setResult(res);
            // The page revalidates on success, so the row re-renders with the
            // new effective value and a fresh «змінено» mark; staying in edit
            // mode would show a stale draft on top of it.
            if (res.ok) { setEditing(false); setDraft(''); }
          },
        },
      );
    });
  }

  const shown = display(field);
  const secretsBlocked = locked && field.secret;

  return (
    <div className="py-3.5 border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="relative inline-flex items-baseline gap-0.5 min-w-0">
          <label
            className="text-sm font-medium text-ink" title={field.key}
            htmlFor={open ? field.key : undefined}
          >
            {field.label}
          </label>
          {field.hint && <HintTip hint={field.hint} />}
        </span>
        <Provenance field={field} />
      </div>

      <div className="mt-1.5">
        {open ? (
          <div className="space-y-2">
            <Editor
              field={field}
              value={live}
              onChange={(v) => { setDraft(v); setEditing(true); }}
            />
            {/* «Зберегти» appears only once the value actually differs — an
                always-present save button on thirty rows is thirty invitations
                to change something Roman did not come here to change. */}
            {dirty && (
              <div className="flex flex-wrap gap-2">
                {/* Emptying the box deletes the row, exactly like «Скинути» —
                    so the button says so. A control that quietly does something
                    other than its label is how a settings page loses trust. */}
                <button
                  type="button" className="btn-primary btn-sm w-full sm:w-auto"
                  disabled={pending || secretsBlocked}
                  onClick={() => commit(() => saveSettingValue(field.key, live))}
                >
                  {pending ? 'Зберігаю…' : live.trim() === '' ? 'Очистити' : 'Зберегти'}
                </button>
                <button
                  type="button" className="btn-outline btn-sm w-full sm:w-auto"
                  disabled={pending} onClick={cancel}
                >
                  Скасувати
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={`text-sm break-all ${shown.muted ? 'text-ink-mute' : 'text-ink font-mono'}`}>
              {shown.text}
            </span>
            <button type="button" className="btn-quiet btn-sm" onClick={begin}>
              {field.secret && field.hasValue ? 'змінити' : 'редагувати'}
            </button>
            {/* Reset says what it will leave behind, so it is never a leap. */}
            {field.source === 'db' && (
              <button
                type="button" className="btn-quiet btn-sm" disabled={pending}
                title={field.fallback?.source === 'env'
                  ? 'Повернутися до значення з .env'
                  : 'Повернутися до типового значення'}
                onClick={() => commit(() => resetSettingValue(field.key))}
              >
                {pending ? '…' : 'Скинути'}
              </button>
            )}
          </div>
        )}
      </div>

      {secretsBlocked && (
        <p className="text-sm text-dot-wait mt-1.5">
          Без SETTINGS_MASTER_KEY це значення нікуди зберігати.
        </p>
      )}

      {/* What «Скинути» would restore. Under the hint, because it only matters
          to the one row in ten that has an override at all. */}
      {!open && field.source === 'db' && field.fallback && !field.secret && (
        <p className="text-sm text-ink-mute mt-1">
          {field.fallback.source === 'env' ? 'Без цієї зміни діяло б з .env: ' : 'Типове значення: '}
          <span className="font-mono">{field.fallback.value === '' ? 'порожньо' : field.fallback.value}</span>
        </p>
      )}

      {result && (
        <p className={`text-sm mt-1.5 ${result.ok ? 'text-dot-go' : 'text-dot-stop'}`}>
          {result.message}
        </p>
      )}

      {/* The raw key, only while the row is open.
          It has to be recoverable — it is the name in `.env`, in the docs and in
          «Ефективна конфігурація» — but printing all 56 of them permanently is
          a second column of monospace noise beside a column of plain labels,
          which is the heap this rebuild is undoing. On a closed row it lives in
          the label's tooltip; on an open one it is right there, because a row
          being edited is exactly when someone is cross-referencing it. */}
      {open && <p className="text-[11px] text-ink-mute mt-1.5 font-mono">{field.key}</p>}
    </div>
  );
}
