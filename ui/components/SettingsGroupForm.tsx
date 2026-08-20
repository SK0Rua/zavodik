'use client';

import { useActionState, useState, useTransition } from 'react';
import { Badge } from '@/components/Badge';
import { saveSettingsGroup, runCheck, type CheckOutcome, type SettingsSaveResult } from '@/lib/settingsActions';
import type { SettingView } from '@/lib/settings';
import { WahaQr } from '@/components/WahaQr';

/**
 * Posted for an untouched secret field. The plaintext is never sent to the
 * browser, so "leave it alone" needs its own signal — an empty string means
 * "очистити", and silence would be indistinguishable from it.
 */
const UNCHANGED = '__unchanged__';

const SOURCE_LABEL: Record<SettingView['source'], { text: string; tone: 'info' | 'idle' }> = {
  db: { text: 'БД', tone: 'info' },
  env: { text: 'env', tone: 'idle' },
  default: { text: 'дефолт', tone: 'idle' },
};

function SecretField({ field }: { field: SettingView }) {
  // `editing=false` keeps the sentinel in the form, so a save that touches
  // other fields in the group cannot wipe a token nobody meant to change.
  const [editing, setEditing] = useState(false);
  const [cleared, setCleared] = useState(false);

  if (cleared) {
    return (
      <div className="flex items-center gap-2">
        <input type="hidden" name={field.key} value="" />
        <span className="text-sm text-dot-wait">буде очищено при збереженні</span>
        <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setCleared(false)}>
          скасувати
        </button>
      </div>
    );
  }

  if (!editing && field.hasValue) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input type="hidden" name={field.key} value={UNCHANGED} />
        <code className="text-sm bg-paper-sunk border border-line rounded px-2 py-1.5">{field.masked}</code>
        <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setEditing(true)}>
          змінити
        </button>
        <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setCleared(true)}>
          очистити
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {field.kind === 'textarea' ? (
        <textarea name={field.key} rows={3} placeholder={field.placeholder} className="w-full font-mono text-sm" />
      ) : (
        <input
          type="password" name={field.key} autoComplete="new-password"
          placeholder={field.placeholder ?? 'вставити нове значення'} className="w-full font-mono text-sm"
        />
      )}
      {field.hasValue && (
        <button
          type="button" className="btn-ghost text-xs px-2 py-1"
          onClick={() => setEditing(false)}
        >
          лишити поточне ({field.masked})
        </button>
      )}
    </div>
  );
}

function Field({ field, error }: { field: SettingView; error?: string }) {
  const src = SOURCE_LABEL[field.source];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <label className="label mb-0" htmlFor={field.key}>{field.label}</label>
        <Badge tone={src.tone}>{src.text}</Badge>
        <code className="text-[11px] text-ink-mute">{field.key}</code>
      </div>

      {field.secret ? (
        <SecretField field={field} />
      ) : field.kind === 'boolean' ? (
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          {/* Unchecked checkboxes post nothing; the hidden twin makes "off"
              an explicit 'false' instead of "field absent". */}
          <input type="hidden" name={field.key} value="false" />
          <input
            id={field.key} type="checkbox" name={field.key} defaultChecked={field.value === 'true'}
            className="h-4 w-4"
          />
          <span>{field.value === 'true' ? 'увімкнено' : 'вимкнено'}</span>
        </label>
      ) : field.kind === 'select' ? (
        <select id={field.key} name={field.key} defaultValue={field.value} className="w-full">
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>{o === '' ? '(авто)' : o}</option>
          ))}
        </select>
      ) : field.kind === 'textarea' ? (
        <textarea id={field.key} name={field.key} rows={3} defaultValue={field.value} className="w-full font-mono text-sm" />
      ) : (
        <input
          id={field.key} name={field.key} type={field.kind === 'number' ? 'number' : 'text'}
          defaultValue={field.value} placeholder={field.placeholder} className="w-full"
        />
      )}

      {field.hint && <p className="text-xs text-ink-mute">{field.hint}</p>}
      {error && <p className="text-xs text-dot-stop">{error}</p>}
      {field.updatedAt && (
        <p className="text-sm text-ink-mute">
          змінено {field.updatedAt}
          {field.updatedBy ? ` (${field.updatedBy})` : ''}
        </p>
      )}
    </div>
  );
}

function CheckButtons({ checks, onQr }: {
  checks: Array<{ kind: string; label: string }>;
  onQr: (needed: boolean) => void;
}) {
  const [results, setResults] = useState<Record<string, CheckOutcome>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function fire(kind: string) {
    setBusy(kind);
    setResults((r) => ({ ...r, [kind]: { ok: false, message: 'перевіряю…' } }));
    const out = await runCheck(kind);
    setResults((r) => ({ ...r, [kind]: out }));
    setBusy(null);
    if (kind === 'waha') onQr(Boolean(out.needsQr));
  }

  if (!checks.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {checks.map((c) => (
          <button
            key={c.kind} type="button" className="btn-ghost text-xs"
            disabled={busy !== null} onClick={() => void fire(c.kind)}
          >
            {busy === c.kind ? '…' : c.label}
          </button>
        ))}
      </div>
      {Object.entries(results).map(([kind, res]) => (
        <div
          key={kind}
          className={`rounded-md border px-3 py-2 text-sm ${
            res.message === 'перевіряю…'
              ? 'border-line bg-paper-sunk text-ink-mute'
              : res.ok
                ? 'border-dot-go/40 bg-dot-go/10 text-dot-go'
                : 'border-dot-stop/40 bg-dot-stop/10 text-dot-stop'
          }`}
        >
          <div className="font-medium">{kind}: {res.message}</div>
          {res.detail && (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-ink-mute">
              {Object.entries(res.detail).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-mute">{k}</dt>
                  <dd className="break-all">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

export function SettingsGroupForm({ group, title, blurb, fields, checks, masterKeyConfigured }: {
  group: string;
  title: string;
  blurb: string;
  fields: SettingView[];
  checks: Array<{ kind: string; label: string }>;
  masterKeyConfigured: boolean;
}) {
  const [state, formAction] = useActionState<SettingsSaveResult | null, FormData>(saveSettingsGroup, null);
  const [pending, startTransition] = useTransition();
  const [showQr, setShowQr] = useState(false);

  const lockedSecrets = !masterKeyConfigured && fields.some((f) => f.secret);

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <p className="text-xs text-ink-mute mt-0.5">{blurb}</p>
      </div>

      <form
        action={(fd) => startTransition(() => formAction(fd))}
        className="space-y-4"
      >
        <input type="hidden" name="__group" value={group} />
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Field key={f.key} field={f} error={state?.errors?.[f.key]} />
          ))}
        </div>

        {lockedSecrets && (
          <p className="text-xs text-dot-wait">
            Секрети в цій групі не зберігатимуться, доки в <code>.env</code> нема SETTINGS_MASTER_KEY.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary text-sm" disabled={pending}>
            {pending ? 'Зберігаю…' : 'Зберегти'}
          </button>
          {state && (
            <span className={`text-sm ${state.ok ? 'text-dot-go' : 'text-dot-stop'}`}>
              {state.message}
            </span>
          )}
        </div>
      </form>

      <CheckButtons checks={checks} onQr={setShowQr} />

      {group === 'whatsapp' && <WahaQr autoShow={showQr} />}
    </section>
  );
}
