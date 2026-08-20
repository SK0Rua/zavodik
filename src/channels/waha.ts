/**
 * Thin client for WAHA — the self-hosted WhatsApp HTTP API (SPEC §2.2, decision #2).
 * NOT the Meta Cloud API: Roman scans a QR once with the dedicated outreach
 * number, WAHA keeps the session, and inbound messages arrive on our webhook.
 *
 * Everything here is transport only. No status transitions, no DB writes —
 * the worker owns those.
 *
 * Error taxonomy matters for SPEC §7: an auth failure must stop the pipeline
 * and alert, while a transport failure on a SEND must still never be
 * auto-retried. Both surface as WahaError with a `kind`, and the send worker
 * decides what to do; the queue never retries send-outreach regardless.
 */
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export type WahaErrorKind = 'auth' | 'rate_limit' | 'server' | 'transport' | 'not_on_whatsapp' | 'bad_request';

export class WahaError extends Error {
  code = 'WAHA_ERROR';
  constructor(
    readonly kind: WahaErrorKind,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
  /** Credential problems stop the whole channel, not just this business (SPEC §7). */
  get isAuth(): boolean { return this.kind === 'auth'; }
}

/** Digits only. WAHA chat ids look like `30691234567@c.us`. */
export function toChatId(phone: string): string {
  return `${phone.replace(/[^\d]/g, '')}@c.us`;
}

/** `30691234567@c.us` / `@lid` / `@g.us` -> bare digits (empty for non-numeric lids). */
export function chatIdToDigits(chatId: string): string {
  return String(chatId).split('@')[0].replace(/[^\d]/g, '');
}

export function isGroupChat(chatId: string | undefined | null): boolean {
  return typeof chatId === 'string' && chatId.endsWith('@g.us');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (config.waha.apiKey) h['X-Api-Key'] = config.waha.apiKey;
  return h;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${config.waha.url}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.waha.requestTimeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new WahaError('transport', `WAHA unreachable at ${url}: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    // 401/403 = wrong or missing X-Api-Key -> stop + alert, never retry.
    const kind: WahaErrorKind =
      res.status === 401 || res.status === 403 ? 'auth'
      : res.status === 429 ? 'rate_limit'
      : res.status >= 500 ? 'server'
      : 'bad_request';
    throw new WahaError(kind, `WAHA ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, res.status, parsed);
  }
  return parsed as T;
}

// ─── Health / session ────────────────────────────────────────────────────────

/** `GET /ping` -> {"message":"pong"}. Cheapest liveness probe; excluded from api-key auth. */
export async function ping(): Promise<boolean> {
  try {
    const res = await request<{ message?: string }>('GET', '/ping');
    return res?.message === 'pong';
  } catch (err) {
    log.warn('WAHA ping failed', { err: String(err) });
    return false;
  }
}

export interface WahaSessionInfo {
  name: string;
  /** STOPPED | STARTING | SCAN_QR_CODE | PASSKEY_REQUIRED | PASSKEY_CONFIRMATION_REQUIRED | WORKING | FAILED */
  status: string;
  me?: { id?: string; pushName?: string } | null;
  config?: unknown;
}

export async function listSessions(all = true): Promise<WahaSessionInfo[]> {
  return request<WahaSessionInfo[]>('GET', `/api/sessions?all=${all}`);
}

export async function getSession(name = config.waha.session): Promise<WahaSessionInfo | null> {
  try {
    return await request<WahaSessionInfo>('GET', `/api/sessions/${encodeURIComponent(name)}`);
  } catch (err) {
    if (err instanceof WahaError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Is the session actually able to send? Only WORKING is. SCAN_QR_CODE means
 * Roman has not paired the phone yet — that is a setup gap, not a send failure.
 */
export async function sessionReady(name = config.waha.session): Promise<{ ready: boolean; status: string }> {
  const s = await getSession(name);
  return { ready: s?.status === 'WORKING', status: s?.status ?? 'MISSING' };
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export interface NumberExistResult {
  numberExists: boolean;
  /** May be a @lid id on newer WhatsApp; `pn` carries the @c.us form when known. */
  chatId?: string;
  pn?: string | null;
}

/**
 * `GET /api/contacts/check-exists?phone=<digits>&session=<s>`.
 * Returns null when the check itself is unavailable (older WAHA, engine that
 * does not implement it) so the caller can proceed rather than block a send.
 */
export async function checkNumberExists(
  phone: string,
  session = config.waha.session,
): Promise<NumberExistResult | null> {
  const digits = phone.replace(/[^\d]/g, '');
  try {
    return await request<NumberExistResult>(
      'GET',
      `/api/contacts/check-exists?phone=${encodeURIComponent(digits)}&session=${encodeURIComponent(session)}`,
    );
  } catch (err) {
    if (err instanceof WahaError && err.isAuth) throw err; // credentials always stop us
    log.warn('WAHA check-exists unavailable, proceeding without it', { err: String(err) });
    return null;
  }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

/** `WAMessage`: the id is a flat string like `false_3069...@c.us_AAAA…`. */
export interface WahaSentMessage {
  id: string;
  timestamp?: number;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  ack?: number;
  ackName?: string;
}

export async function sendText(input: {
  chatId: string;
  text: string;
  session?: string;
}): Promise<WahaSentMessage> {
  return request<WahaSentMessage>('POST', '/api/sendText', {
    session: input.session ?? config.waha.session,
    chatId: input.chatId,
    text: input.text,
  });
}

// ─── Webhook payloads ────────────────────────────────────────────────────────

/** The `WAMessage` WAHA posts inside the webhook envelope's `payload`. */
export interface WahaWebhookMessage {
  id?: string;
  /** SECONDS here — the envelope's own `timestamp` is milliseconds. */
  timestamp?: number;
  from?: string;
  fromMe?: boolean;
  /** `api` when WAHA itself sent it (our own outreach echo), `app` otherwise. */
  source?: string;
  to?: string;
  participant?: string;
  body?: string;
  hasMedia?: boolean;
  [k: string]: unknown;
}

export interface WahaWebhookEnvelope {
  id?: string;
  timestamp?: number;
  event?: string;
  session?: string;
  me?: { id?: string; pushName?: string };
  payload?: WahaWebhookMessage;
  engine?: string;
  [k: string]: unknown;
}
