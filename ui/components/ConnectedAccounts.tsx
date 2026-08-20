'use client';

/**
 * "Підключені акаунти" — the primary path for every credential the factory needs.
 *
 * Roman's framing (2026-08-17): the Claude token field was "одноразова дія, а не
 * налаштування". A one-time action belongs behind a button, not in a form of
 * persistent settings. So each provider is a row with a state and a
 * **Підключити** button that runs the whole flow here — no terminal, no copying
 * a secret between two machines.
 *
 * The raw fields still exist under «Розширені» further down the page: this block
 * is the path, not a cage. Anything that can be done here can still be done by
 * hand, which is what makes the block safe to trust.
 *
 * Two shapes of flow, because the two CLIs genuinely differ:
 *   Claude — we show a URL, he pastes a code back (the CLI blocks on a prompt);
 *   Codex  — we show a URL + a one-time code, and the CLI polls by itself, so
 *            there is nothing to type back and no submit step to render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/Badge';
import { WahaQr } from '@/components/WahaQr';
import { runCheck, type CheckOutcome } from '@/lib/settingsActions';
import {
  cancelAccount, disconnectAccount, findTelegramChats, pollAccount,
  saveGmail, saveTelegramToken, startAccount, submitAccountCode, useTelegramChat,
  type AccountSession, type TelegramChat,
} from '@/lib/accountsActions';
import type { AccountsSnapshot, AccountStatus } from '@/lib/accounts';

/** http(s) only — the URL comes from CLI output, so it is never blindly trusted. */
function safeHttpUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : undefined;
  } catch { return undefined; }
}

// ─── Shared row chrome ───────────────────────────────────────────────────────

type Tone = 'ok' | 'bad' | 'warn' | 'idle';

/**
 * The state a row shows. A live check outranks the stored-config guess: once
 * something has really been asked, its answer is the truth on screen.
 */
function rowTone(status: AccountStatus, check: CheckOutcome | undefined): { tone: Tone; label: string } {
  if (check) {
    if (check.message === 'перевіряю…') return { tone: 'idle', label: '… перевіряю' };
    return check.ok ? { tone: 'ok', label: '✓ підключено' } : { tone: 'bad', label: '✗ помилка' };
  }
  if (status.readiness === 'configured') return { tone: 'warn', label: '• налаштовано' };
  if (status.readiness === 'partial') return { tone: 'warn', label: '• частково' };
  return { tone: 'idle', label: '✗ не підключено' };
}

function AccountRow({ title, blurb, status, check, children }: {
  title: string;
  blurb: string;
  status: AccountStatus;
  check?: CheckOutcome;
  children: React.ReactNode;
}) {
  const { tone, label } = rowTone(status, check);
  return (
    <div className="rounded-lg border border-line bg-paper-sunk p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-ink">{title}</h3>
            <Badge tone={tone === 'warn' ? 'info' : tone}>{label}</Badge>
          </div>
          <p className="text-xs text-ink-mute mt-0.5">{blurb}</p>
          <p className="text-xs text-ink-mute mt-1 break-all">{status.detail}</p>
        </div>
      </div>
      {children}
      {check && check.message !== 'перевіряю…' && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          check.ok
            ? 'border-dot-go/40 bg-dot-go/10 text-dot-go'
            : 'border-dot-stop/40 bg-dot-stop/10 text-dot-stop'
        }`}
        >
          {check.message}
        </div>
      )}
    </div>
  );
}

/** "Перевірити" — the real check in the factory, shared by every row. */
function CheckButton({ kind, label, onResult, disabled }: {
  kind: string; label?: string; onResult: (o: CheckOutcome) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" className="btn-ghost text-xs" disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        onResult({ ok: false, message: 'перевіряю…' });
        onResult(await runCheck(kind));
        setBusy(false);
      }}
    >
      {busy ? '…' : (label ?? 'Перевірити')}
    </button>
  );
}

// ─── Interactive CLI flow (Claude / Codex) ───────────────────────────────────

/**
 * Drives one `/internal/accounts/:provider/*` session.
 *
 * Polling rather than streaming: the human step in the middle is unbounded (he
 * has to open a browser and sign in), and a 1.5s poll over a server action is
 * both simpler and more robust than holding a stream open across a container
 * boundary for five minutes.
 */
function CliFlow({ provider, needsCode, onDone }: {
  provider: 'claude' | 'codex';
  /** Claude blocks on a "Paste code here" prompt; Codex does not. */
  needsCode: boolean;
  onDone: (check: CheckOutcome) => void;
}) {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const live = session
    && session.phase !== 'done' && session.phase !== 'error' && session.phase !== 'cancelled';

  const stopPolling = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }, []);

  // Poll while a flow is in flight; stop the moment it reaches a terminal phase.
  useEffect(() => {
    if (!live) { stopPolling(); return; }
    if (timer.current) return;
    timer.current = setInterval(() => {
      void pollAccount(provider).then((s) => {
        if (!s) return;
        setSession(s);
        if (s.phase === 'done' || s.phase === 'error') {
          stopPolling();
          if (s.check) onDone(s.check);
        }
      });
    }, 1500);
    return stopPolling;
  }, [live, provider, stopPolling, onDone]);

  // A component unmounting (page nav) must not leave an interval running.
  useEffect(() => stopPolling, [stopPolling]);

  async function start() {
    setBusy(true);
    setCode('');
    setSession(await startAccount(provider));
    setBusy(false);
  }

  async function cancel() {
    stopPolling();
    setSession(await cancelAccount(provider));
  }

  async function submit() {
    if (!code.trim()) return;
    setBusy(true);
    setSession(await submitAccountCode(provider, code));
    setCode('');
    setBusy(false);
  }

  const url = safeHttpUrl(session?.url);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!live && (
          <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => void start()}>
            {busy ? '…' : (session?.phase === 'done' ? 'Підключити заново' : 'Підключити')}
          </button>
        )}
        {live && (
          <button type="button" className="btn-ghost text-xs" onClick={() => void cancel()}>
            Скасувати
          </button>
        )}
        {live && session?.expiresInMs ? (
          <span className="text-xs text-ink-mute">
            лишилось ~{Math.ceil(session.expiresInMs / 60_000)} хв
          </span>
        ) : null}
      </div>

      {session && session.phase !== 'cancelled' && (
        <div className={`rounded-md border px-3 py-2 text-sm space-y-2 ${
          session.phase === 'error'
            ? 'border-dot-stop/40 bg-dot-stop/10 text-dot-stop'
            : session.phase === 'done'
              ? 'border-dot-go/40 bg-dot-go/10 text-dot-go'
              : 'border-line bg-paper-card text-ink-soft'
        }`}
        >
          <div>{session.message}</div>
          {session.cliTail && (session.phase === 'submitting' || session.phase === 'error') && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs opacity-70">Що пише CLI</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-2 text-[11px]">{session.cliTail}</pre>
            </details>
          )}

          {url && (session.phase === 'awaiting' || session.phase === 'submitting') && (
            <div className="space-y-2">
              <a
                href={url} target="_blank" rel="noreferrer"
                className="inline-block btn-ghost text-xs"
              >
                Відкрити сторінку входу ↗
              </a>
              {/* The full URL in copyable form: the button opens a new tab, but
                  if Roman is doing this on a headless server over SSH he needs
                  the text to paste into a browser on another machine. */}
              <input
                readOnly value={url} onFocus={(e) => e.currentTarget.select()}
                className="w-full font-mono text-[11px] bg-paper-sunk border border-line rounded px-2 py-1"
              />

              {session.userCode && (
                <div className="text-sm">
                  Одноразовий код на сторінці:{' '}
                  <code className="bg-paper-sunk border border-line rounded px-2 py-1 text-base tracking-widest">
                    {session.userCode}
                  </code>
                </div>
              )}
            </div>
          )}

          {needsCode && session.phase === 'awaiting' && (
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text" value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="Вставте код зі сторінки"
                autoComplete="off" spellCheck={false}
                className="flex-1 min-w-[16rem] font-mono text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
              />
              <button type="button" className="btn-primary text-xs" disabled={busy || !code.trim()} onClick={() => void submit()}>
                {busy ? '…' : 'Надіслати код'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Telegram ────────────────────────────────────────────────────────────────

/**
 * Bot token → chat id → test message, in that order, all in one row.
 *
 * The chat-id step is the one that used to send Roman to a terminal
 * (`pnpm telegram:setup`). `getUpdates` needs the bot to have been messaged
 * first, so the instruction is inline rather than in a doc he would have to
 * find after the button confused him.
 */
function TelegramFlow({ status, onCheck }: { status: AccountStatus; onCheck: (o: CheckOutcome) => void }) {
  const [token, setToken] = useState('');
  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function saveToken() {
    setBusy('token');
    const r = await saveTelegramToken(token);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setToken('');
    setBusy(null);
  }

  async function find() {
    setBusy('find');
    setChats(null);
    // An unsaved token in the box wins, so "paste → знайти" works before saving.
    const r = await findTelegramChats(token.trim() || undefined);
    setMsg({ ok: r.ok, text: r.message });
    setChats(r.chats);
    setBusy(null);
  }

  async function pick(id: string) {
    setBusy(id);
    const r = await useTelegramChat(id);
    setMsg({ ok: r.ok, text: r.message });
    setBusy(null);
    if (r.ok) {
      // Saved id + saved token = the only thing left worth knowing is whether a
      // message actually arrives, so run that immediately.
      onCheck({ ok: false, message: 'перевіряю…' });
      onCheck(await runCheck('telegram'));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder={status.readiness === 'missing' ? 'Bot token від @BotFather' : 'новий bot token (порожньо = лишити)'}
          autoComplete="new-password" className="flex-1 min-w-[16rem] font-mono text-sm"
        />
        <button type="button" className="btn-ghost text-xs" disabled={busy !== null || !token.trim()} onClick={() => void saveToken()}>
          {busy === 'token' ? '…' : 'Зберегти токен'}
        </button>
        <button type="button" className="btn-primary text-xs" disabled={busy !== null} onClick={() => void find()}>
          {busy === 'find' ? '…' : 'Знайти chat id'}
        </button>
        <CheckButton kind="telegram" label="Надіслати тест" onResult={onCheck} disabled={busy !== null} />
      </div>

      <p className="text-xs text-ink-mute">
        Перед пошуком <strong>надішли боту будь-яке повідомлення</strong> в Telegram — інакше
        <code className="mx-1">getUpdates</code> не має що показати.
      </p>

      {msg && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          msg.ok ? 'border-dot-go/40 bg-dot-go/10 text-dot-go' : 'border-dot-wait/40 bg-dot-wait/10 text-dot-wait'
        }`}
        >
          {msg.text}
        </div>
      )}

      {chats && chats.length > 0 && (
        <div className="space-y-1">
          {chats.map((c) => (
            <button
              key={c.id} type="button" disabled={busy !== null}
              onClick={() => void pick(c.id)}
              className="w-full text-left rounded-md border border-line bg-paper-card hover:border-ink-500 px-3 py-2 text-sm flex items-center justify-between gap-2"
            >
              <span className="truncate">{c.title}</span>
              <span className="text-xs text-ink-mute shrink-0">{c.type} · {c.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Gmail ───────────────────────────────────────────────────────────────────

function GmailFlow({ onSmtp, onImap }: {
  onSmtp: (o: CheckOutcome) => void; onImap: (o: CheckOutcome) => void;
}) {
  const [addr, setAddr] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await saveGmail(addr, pass);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setPass('');
    setBusy(false);
    if (r.ok) {
      // Both halves use the same app password, so both are worth proving at once.
      onSmtp({ ok: false, message: 'перевіряю…' });
      onImap({ ok: false, message: 'перевіряю…' });
      onSmtp(await runCheck('smtp'));
      onImap(await runCheck('imap'));
    }
  }

  return (
    <div className="space-y-2">
      <ol className="text-xs text-ink-mute list-decimal pl-5 space-y-0.5">
        <li>Увімкни двофакторну автентифікацію (без неї app password недоступний).</li>
        <li>
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
            myaccount.google.com/apppasswords ↗
          </a>{' '}— створи пароль «websites-factory» (16 символів).
        </li>
        <li>Gmail → Settings → Forwarding and POP/IMAP → <strong>Enable IMAP</strong>.</li>
      </ol>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="email" value={addr} onChange={(e) => setAddr(e.target.value)}
          placeholder="you@gmail.com" autoComplete="off" className="flex-1 min-w-[14rem] text-sm"
        />
        <input
          type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          placeholder="app password (16 символів)" autoComplete="new-password"
          className="flex-1 min-w-[14rem] font-mono text-sm"
        />
        <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => void save()}>
          {busy ? '…' : 'Підключити'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <CheckButton kind="smtp" label="Перевірити SMTP" onResult={onSmtp} />
        <CheckButton kind="imap" label="Перевірити IMAP" onResult={onImap} />
      </div>

      {msg && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          msg.ok ? 'border-dot-go/40 bg-dot-go/10 text-dot-go' : 'border-dot-wait/40 bg-dot-wait/10 text-dot-wait'
        }`}
        >
          {msg.text}
        </div>
      )}
      <p className="text-xs text-ink-mute">
        Пробіли в паролі можна лишати — вони прибираються автоматично. Заповнюються обидва
        блоки (SMTP і IMAP) одним паролем, бо в Gmail це один і той самий app password.
      </p>
    </div>
  );
}

// ─── Block ───────────────────────────────────────────────────────────────────

export function ConnectedAccounts({ accounts }: { accounts: AccountsSnapshot }) {
  const [checks, setChecks] = useState<Record<string, CheckOutcome>>({});
  const set = useCallback(
    (kind: string) => (o: CheckOutcome) => setChecks((c) => ({ ...c, [kind]: o })),
    [],
  );

  const [disc, setDisc] = useState<string | null>(null);
  async function doDisconnect(provider: string) {
    const r = await disconnectAccount(provider);
    setDisc(r.message);
    if (r.ok) setChecks((c) => ({ ...c, [provider]: { ok: false, message: 'Відключено.' } }));
  }

  // WAHA drives the QR: the check reports `needsQr` when the session is
  // unpaired, and the QR appears right there instead of on another port.
  const wahaNeedsQr = Boolean(checks.waha?.needsQr);

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-ink">Підключені акаунти</h2>
        <p className="text-xs text-ink-mute mt-0.5">
          Усе підключається звідси, з браузера — термінал не потрібен. Стан{' '}
          <Badge tone="info">налаштовано</Badge> означає «дані збережені»;{' '}
          <Badge tone="ok">✓ підключено</Badge> зʼявляється лише після справжньої перевірки.
        </p>
      </div>

      {!accounts.masterKey && (
        <div className="rounded-md border border-dot-stop/40 bg-dot-stop/10 px-3 py-2 text-sm text-dot-stop">
          <code>SETTINGS_MASTER_KEY</code> не заданий — секрети неможливо зберегти.
          Підключення нижче не спрацюють, доки ключ не зʼявиться в <code>.env</code>.
        </div>
      )}

      <div className="grid gap-3">
        <AccountRow
          title="Claude Code"
          blurb="Агентні етапи: brief, контент, збірка сайту, visual QA. По підписці Pro/Max."
          status={accounts.claude}
          check={checks.claude}
        >
          <CliFlow provider="claude" needsCode onDone={set('claude')} />
          <div className="flex flex-wrap gap-2">
            <CheckButton kind="claude" onResult={set('claude')} />
            {accounts.claude.readiness === 'configured' && (
              <button type="button" className="btn-ghost text-xs" onClick={() => void doDisconnect('claude')}>
                Відключити
              </button>
            )}
          </div>
          <p className="text-xs text-ink-mute">
            «Підключити» запускає <code>claude setup-token</code> у контейнері фабрики, показує
            посилання і чекає на код звідти. Токен зберігається зашифрованим і діє наживо.
          </p>
        </AccountRow>

        <AccountRow
          title="Codex CLI"
          blurb="Генерація зображень (gen-image) по підписці ChatGPT."
          status={accounts.codex}
          check={checks.codex}
        >
          <CliFlow provider="codex" needsCode={false} onDone={set('codex')} />
          <div className="flex flex-wrap gap-2">
            <CheckButton kind="codex" onResult={set('codex')} />
          </div>
          <p className="text-xs text-ink-mute">
            Код вводиться на сторінці OpenAI — сюди його повертати не треба, статус оновиться сам.
            Логін лягає у volume <code>codexhome</code> і переживає ребілди образу.
          </p>
        </AccountRow>

        <AccountRow
          title="Telegram"
          blurb="Тільки сповіщення з лінками в цей UI (рішення №9). Approve тут не робиться."
          status={accounts.telegram}
          check={checks.telegram}
        >
          <TelegramFlow status={accounts.telegram} onCheck={set('telegram')} />
        </AccountRow>

        <AccountRow
          title="WhatsApp (WAHA)"
          blurb="Self-hosted WAHA, не Meta Cloud API (рішення №2). Головний канал outreach."
          status={accounts.whatsapp}
          check={checks.waha}
        >
          <div className="flex flex-wrap gap-2">
            <CheckButton kind="waha" label="Перевірити / показати стан" onResult={set('waha')} />
          </div>
          <WahaQr autoShow={wahaNeedsQr} />
          <p className="text-xs text-ink-mute">
            Скануй <strong>виділеним</strong> номером, не особистим: протокол неофіційний і номер
            можуть заблокувати. <code>WAHA_API_KEY</code> і HMAC key — у «Розширених» нижче
            (той самий, що в <code>.env</code> контейнера WAHA).
          </p>
        </AccountRow>

        <AccountRow
          title="Gmail"
          blurb="Резервний канал; месенджери мають пріоритет (рішення №8). IMAP ловить відповіді."
          status={accounts.gmail}
          check={checks.smtp ?? checks.imap}
        >
          <GmailFlow onSmtp={set('smtp')} onImap={set('imap')} />
          {checks.imap && checks.imap.message !== 'перевіряю…' && (
            <div className={`rounded-md border px-3 py-2 text-sm ${
              checks.imap.ok
                ? 'border-dot-go/40 bg-dot-go/10 text-dot-go'
                : 'border-dot-stop/40 bg-dot-stop/10 text-dot-stop'
            }`}
            >
              IMAP: {checks.imap.message}
            </div>
          )}
        </AccountRow>

        <AccountRow
          title="FlowKit"
          blurb="AI-відео для hero. Опційно: без нього — Ken Burns по реальних фото."
          status={accounts.flowkit}
          check={checks.flowkit}
        >
          <div className="flex flex-wrap gap-2">
            <CheckButton kind="flowkit" onResult={set('flowkit')} />
          </div>
          <p className="text-xs text-ink-mute">
            Підключення не автоматизується: FlowKit — це Python-агент на маку з Chrome-розширенням
            (<code>docs/MEDIA.md</code>). Тут лише видно, доступний він чи ні.
          </p>
        </AccountRow>
      </div>

      {disc && <p className="text-sm text-ink-mute">{disc}</p>}
    </section>
  );
}
