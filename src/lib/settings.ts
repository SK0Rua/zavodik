/**
 * Runtime settings store — operational configuration that lives in Postgres,
 * encrypted at rest, and is editable from the UI (`/settings`) WITHOUT a
 * restart or rebuild.
 *
 * Why this exists (Roman's decision, 2026-08-17): "Для чого мені
 * CLAUDE_CODE_OAUTH_TOKEN в env? Щоб потім перезавантажувати чи перебілдювати
 * все? Чому не зробити налаштування в UI і там усе робити?" — an operator
 * should be able to paste a token, scan a QR and flip dry_run/live from the
 * console, not by editing `.env` and recreating containers.
 *
 * Split of responsibilities:
 *   .env  → INFRA only: DATABASE_URL, S3_*, UI_PASSWORD / UI_SESSION_SECRET,
 *           SETTINGS_MASTER_KEY, ports. Things needed to boot and to decrypt.
 *   DB    → everything operational (tokens, SMTP/IMAP, WAHA, limits, mode).
 *
 * Resolution order at read time: DB value → env var → registry default.
 * Env therefore remains a working fallback for a fresh box or a rollback, but
 * once a key is saved in the UI the DB wins.
 *
 * Caching: a whole-table snapshot with a 15s TTL. Every consumer reads through
 * `config.*` getters (see src/config.ts), so a change in the UI is visible to
 * the worker processes within 15 seconds with no restart. The TTL is the whole
 * invalidation strategy on purpose — LISTEN/NOTIFY would add a connection and a
 * failure mode for a 15s win.
 *
 * Encryption: AES-256-GCM under a single master key (`SETTINGS_MASTER_KEY`,
 * 32 bytes hex or base64). Stored as `enc:v1:<iv>:<tag>:<ciphertext>` (base64
 * segments). Without the master key secrets cannot be saved and existing ones
 * read back as empty — never as garbage, and never as a crash.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ─── Registry ────────────────────────────────────────────────────────────────

export type SettingGroup =
  | 'agents' | 'telegram' | 'email' | 'whatsapp' | 'media' | 'outreach' | 'system';

export type SettingKind = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';

export interface SettingDef {
  /** Canonical key. Identical to the env var name, so env stays a valid fallback. */
  key: string;
  label: string;
  group: SettingGroup;
  kind: SettingKind;
  /** Secrets are encrypted at rest and never returned in full to the browser. */
  secret?: boolean;
  /** Value used when neither DB nor env has one. Always a string (the wire format). */
  default?: string;
  options?: string[];
  hint?: string;
  placeholder?: string;
  /** Return an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
}

const num = (min?: number, max?: number) => (v: string): string | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return 'має бути числом';
  if (min !== undefined && n < min) return `мінімум ${min}`;
  if (max !== undefined && n > max) return `максимум ${max}`;
  return null;
};

const url = (v: string): string | null => {
  if (v.trim() === '') return null;
  try { new URL(v); return null; } catch { return 'має бути URL (http://… або https://…)'; }
};

const csvNumbers = (v: string): string | null => {
  if (v.trim() === '') return null;
  return v.split(',').every((p) => Number.isFinite(Number(p.trim())) && p.trim() !== '')
    ? null : 'список чисел через кому, напр. 3,7';
};

export const SETTING_GROUPS: Array<{ id: SettingGroup; title: string; blurb: string }> = [
  { id: 'agents', title: 'Агенти', blurb: 'Claude Code / Codex по підписці. Жодного pay-per-token API.' },
  { id: 'telegram', title: 'Telegram', blurb: 'Тільки нотифікації з лінками в цей UI (рішення №9).' },
  { id: 'email', title: 'Email (SMTP / IMAP)', blurb: 'Резервний канал; месенджери мають пріоритет (рішення №8).' },
  { id: 'whatsapp', title: 'WhatsApp (WAHA)', blurb: 'Self-hosted WAHA, не Meta Cloud API (рішення №2).' },
  { id: 'media', title: 'Медіа', blurb: 'FlowKit-відео і генерація зображень — усе по підписках.' },
  { id: 'outreach', title: 'Outreach', blurb: 'Ліміти, follow-up і режим фабрики.' },
  { id: 'system', title: 'Система', blurb: 'Discovery, URL-и, таймзона, обслуговування.' },
];

export const SETTINGS: SettingDef[] = [
  // ── Агенти ────────────────────────────────────────────────────────────────
  {
    key: 'CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude Code OAuth token', group: 'agents',
    kind: 'password', secret: true,
    hint: 'На сервері: `claude setup-token` локально → вставити сюди. Локально порожньо = використовується логін CLI.',
    placeholder: 'sk-ant-oat01-…',
  },
  {
    key: 'AGENT_RUNTIME', label: 'Runtime за замовчуванням', group: 'agents',
    kind: 'select', options: ['claude-code', 'codex'], default: 'claude-code',
    hint: 'Обидва по підписці. API-білінг недоступний by construction.',
  },
  { key: 'AGENT_MODEL', label: 'Модель (звичайна)', group: 'agents', kind: 'text', default: 'claude-sonnet-5' },
  { key: 'AGENT_MODEL_HEAVY', label: 'Модель (важка)', group: 'agents', kind: 'text', default: 'claude-opus-5' },
  {
    key: 'AGENT_CONCURRENCY', label: 'Паралельних агентних викликів', group: 'agents',
    kind: 'number', default: '1', validate: num(1, 8),
    hint: 'Вікно підписки спільне — тримай низьким.',
  },
  {
    key: 'AGENT_CONCURRENCY_BUILD', label: 'Паралельність (build-процес)', group: 'agents',
    kind: 'number', default: '', validate: num(1, 8),
    hint: 'Порожньо = як AGENT_CONCURRENCY. Діє на factory-build.',
  },
  {
    key: 'AGENT_CONCURRENCY_ENRICH', label: 'Паралельність (enrich-процес)', group: 'agents',
    kind: 'number', default: '', validate: num(1, 8),
    hint: 'Порожньо = як AGENT_CONCURRENCY. Діє на factory.',
  },

  // ── Telegram ──────────────────────────────────────────────────────────────
  {
    key: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', group: 'telegram', kind: 'password', secret: true,
    hint: 'Від @BotFather. Порожньо = нотифікації просто не шлються.',
    placeholder: '123456789:AA…',
  },
  {
    key: 'TELEGRAM_CHAT_ID', label: 'Chat ID', group: 'telegram', kind: 'text',
    hint: 'Твій особистий chat id (напиши боту, потім getUpdates).',
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  { key: 'SMTP_HOST', label: 'SMTP host', group: 'email', kind: 'text', placeholder: 'smtp.gmail.com' },
  { key: 'SMTP_PORT', label: 'SMTP port', group: 'email', kind: 'number', default: '587', validate: num(1, 65535) },
  { key: 'SMTP_USER', label: 'SMTP user', group: 'email', kind: 'text' },
  { key: 'SMTP_PASS', label: 'SMTP password', group: 'email', kind: 'password', secret: true, hint: 'Gmail: app password, не основний пароль.' },
  { key: 'SMTP_FROM', label: 'From', group: 'email', kind: 'text', placeholder: 'Roman <roman@example.com>' },
  {
    key: 'SMTP_SECURE', label: 'Явний TLS (порт 465)', group: 'email', kind: 'select',
    options: ['', 'true', 'false'], hint: 'Порожньо = вивести з порту (465 → так, 587 → STARTTLS).',
  },
  { key: 'SMTP_MESSAGE_ID_DOMAIN', label: 'Message-ID домен', group: 'email', kind: 'text', default: 'factory.local', hint: 'Має бути стабільним — по ньому матчаться відповіді.' },
  { key: 'SMTP_UNSUBSCRIBE_TO', label: 'List-Unsubscribe адреса', group: 'email', kind: 'text', hint: 'Порожньо = адреса From.' },
  { key: 'SMTP_TLS_REJECT_UNAUTHORIZED', label: 'Перевіряти TLS-сертифікат (SMTP)', group: 'email', kind: 'boolean', default: 'true' },
  { key: 'IMAP_HOST', label: 'IMAP host', group: 'email', kind: 'text', placeholder: 'imap.gmail.com' },
  { key: 'IMAP_PORT', label: 'IMAP port', group: 'email', kind: 'number', default: '993', validate: num(1, 65535) },
  { key: 'IMAP_USER', label: 'IMAP user', group: 'email', kind: 'text' },
  { key: 'IMAP_PASS', label: 'IMAP password', group: 'email', kind: 'password', secret: true },
  { key: 'IMAP_MAILBOX', label: 'Поштова скринька', group: 'email', kind: 'text', default: 'INBOX' },
  { key: 'IMAP_SECURE', label: 'TLS (IMAP)', group: 'email', kind: 'select', options: ['', 'true', 'false'], hint: 'Порожньо = вивести з порту (993 → так).' },
  { key: 'IMAP_TLS_REJECT_UNAUTHORIZED', label: 'Перевіряти TLS-сертифікат (IMAP)', group: 'email', kind: 'boolean', default: 'true' },
  { key: 'IMAP_MAX_PER_POLL', label: 'Максимум листів за один polling', group: 'email', kind: 'number', default: '50', validate: num(1, 500) },

  // ── WhatsApp (WAHA) ───────────────────────────────────────────────────────
  {
    key: 'WAHA_URL', label: 'WAHA URL', group: 'whatsapp', kind: 'text', default: 'http://127.0.0.1:3001',
    validate: url, hint: 'У compose: http://waha:3000. З хоста: http://127.0.0.1:3001.',
  },
  { key: 'WAHA_API_KEY', label: 'WAHA API key', group: 'whatsapp', kind: 'password', secret: true, hint: 'Той самий, що в X-Api-Key і в docker-compose.' },
  { key: 'WAHA_SESSION', label: 'Сесія', group: 'whatsapp', kind: 'text', default: 'default' },
  { key: 'WAHA_HOOK_HMAC_KEY', label: 'Webhook HMAC key', group: 'whatsapp', kind: 'password', secret: true, hint: 'Підписує вхідні вебхуки. Має збігатися з WHATSAPP_HOOK_HMAC_KEY у WAHA.' },
  { key: 'WAHA_CHECK_EXISTS', label: 'Перевіряти номер перед відправкою', group: 'whatsapp', kind: 'boolean', default: 'true' },

  // ── Медіа ─────────────────────────────────────────────────────────────────
  { key: 'FLOWKIT_URL', label: 'FlowKit URL', group: 'media', kind: 'text', default: 'http://localhost:8100', validate: url, hint: 'Python-агент на маку Романа (через Tailscale із сервера).' },
  {
    key: 'FLOWKIT_MODE', label: 'Режим FlowKit', group: 'media', kind: 'select',
    options: ['auto', 'live', 'mock'], default: 'auto',
    hint: 'auto = live коли Chrome-міст живий, інакше локальний Ken Burns.',
  },
  { key: 'MEDIA_GEN_IMAGES', label: 'Генерувати фонові зображення', group: 'media', kind: 'boolean', default: 'true', hint: 'Помічаються як ai_generated; вимкнення робить білди швидшими й офлайновими.' },
  {
    key: 'LANDING_GALLERY', label: 'Референси з landing.gallery', group: 'media', kind: 'boolean', default: 'true',
    hint: 'Публічні скриншоти лендінгів як ДОДАТКОВІ референси для арт-директора (етап 9). Механіка руху далі тільки з motion-паку, палітра — тільки з айдентики бізнесу. Вимкнено = поведінка як раніше.',
  },
  {
    key: 'LANDING_GALLERY_MAX_REFS', label: 'Скільки референсів завантажувати', group: 'media', kind: 'number',
    default: '6', validate: num(1, 12), hint: 'Їхній API віддає максимум 4 за виклик, тож 6 = два запити.',
  },
  {
    key: 'LANDING_GALLERY_TIMEOUT_MS', label: 'Таймаут landing.gallery (мс)', group: 'media', kind: 'number',
    default: '5000', validate: num(1000, 30000), hint: 'Навмисно короткий: джерело натхнення ніколи не має гальмувати білд.',
  },

  // ── Outreach ──────────────────────────────────────────────────────────────
  {
    key: 'FACTORY_MODE', label: 'Режим фабрики', group: 'outreach', kind: 'select',
    options: ['dry_run', 'live'], default: 'dry_run',
    hint: 'live = реальні відправки бізнесам. Перемикати свідомо.',
  },
  { key: 'OUTREACH_DAILY_LIMIT', label: 'Ліміт відправок на день', group: 'outreach', kind: 'number', default: '20', validate: num(0, 1000) },
  { key: 'FOLLOWUP_SCHEDULE_DAYS', label: 'Follow-up через (днів)', group: 'outreach', kind: 'text', default: '3,7', validate: csvNumbers },
  { key: 'DEMO_BASE_URL', label: 'Базовий URL демо', group: 'outreach', kind: 'text', default: 'http://localhost:8788', validate: url, hint: 'Те, що бізнес побачить у повідомленні.' },

  // ── Система ───────────────────────────────────────────────────────────────
  { key: 'UI_BASE_URL', label: 'Базовий URL цього UI', group: 'system', kind: 'text', default: 'http://localhost:3000', validate: url, hint: 'Усі Telegram-лінки ведуть сюди.' },
  { key: 'TZ', label: 'Таймзона', group: 'system', kind: 'text', default: 'Europe/Athens', hint: 'Змінa застосується для процесів після перезапуску контейнера (Node читає TZ на старті).' },
  { key: 'SOCIAL_DISCOVERY', label: 'Шукати соцмережі', group: 'system', kind: 'boolean', default: 'true' },
  { key: 'SOCIAL_DISCOVERY_MAX_CANDIDATES', label: 'Профілів на бізнес', group: 'system', kind: 'number', default: '6', validate: num(1, 30) },
  { key: 'SOCIAL_DISCOVERY_DELAY_MS', label: 'Пауза між запитами (мс)', group: 'system', kind: 'number', default: '2500', validate: num(0, 60000) },
  {
    key: 'SOCIAL_FINDER', label: 'Хто шукає профілі', group: 'system', kind: 'select',
    options: ['both', 'engines', 'agent'], default: 'both',
    hint: 'engines = пошуковики з нашого IP (безкоштовно, але на сервері їх блокують). '
      + 'agent = Claude WebSearch з інфраструктури Anthropic (обходить блок, витрачає підписку). '
      + 'both = спершу пошуковики, агент лише коли вони дали <2 кандидатів.',
  },
  { key: 'SOCIAL_FINDER_MAX_CANDIDATES', label: 'Кандидатів від агента', group: 'system', kind: 'number', default: '8', validate: num(1, 12) },
  { key: 'GOSOM_DEPTH', label: 'gosom: глибина скролу', group: 'system', kind: 'number', default: '10', validate: num(1, 100) },
  { key: 'GOSOM_ZOOM', label: 'gosom: zoom', group: 'system', kind: 'number', default: '15', validate: num(1, 21) },
  { key: 'GOSOM_RADIUS', label: 'gosom: радіус (м)', group: 'system', kind: 'number', default: '10000', validate: num(100, 200000) },
  { key: 'GOSOM_MAX_TIME_SECONDS', label: 'gosom: бюджет скрейпу (с)', group: 'system', kind: 'number', default: '900', validate: num(240, 7200), hint: 'gosom відхиляє значення ≤ 180.' },
  { key: 'GOSOM_JOB_TIMEOUT_SECONDS', label: 'gosom: таймаут очікування (с)', group: 'system', kind: 'number', default: '1800', validate: num(60, 14400) },
  { key: 'GOSOM_EMAIL_EXTRACTION', label: 'gosom: витягувати email', group: 'system', kind: 'boolean', default: 'true' },
  { key: 'GOSOM_PROXIES', label: 'gosom: проксі', group: 'system', kind: 'textarea', secret: true, hint: 'По одному в рядку або через кому. Порожньо = без проксі.' },
  { key: 'WORKSPACE_GC', label: 'Чистити workspace після білду', group: 'system', kind: 'boolean', default: 'true', hint: 'Видаляє node_modules/.next/out (~735MB → кілька MB). Джерела лишаються.' },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export function isKnownSetting(key: string): boolean {
  return BY_KEY.has(key);
}

// ─── Encryption ──────────────────────────────────────────────────────────────

const ENC_PREFIX = 'enc:v1:';

/** Parse SETTINGS_MASTER_KEY (32 bytes as hex or base64). null = not configured. */
export function masterKey(): Buffer | null {
  const raw = (process.env.SETTINGS_MASTER_KEY ?? '').trim();
  if (!raw) return null;
  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) buf = b;
    } catch { buf = null; }
  }
  return buf && buf.length === 32 ? buf : null;
}

export function masterKeyConfigured(): boolean {
  return masterKey() !== null;
}

export function encryptSecret(plain: string): string {
  const key = masterKey();
  if (!key) throw new Error('SETTINGS_MASTER_KEY is missing or not 32 bytes — cannot store secrets');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a stored value. Anything that is not our envelope is returned as-is
 * (a value written before encryption existed, or a non-secret row).
 * A failure returns '' rather than throwing: a wrong/rotated master key must
 * degrade to "not configured", never crash a worker mid-pipeline.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = masterKey();
  if (!key) return '';
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !ctB64) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}

/** What the browser is allowed to see about a secret: existence + last 4 chars. */
export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 4) return '•'.repeat(plain.length);
  return `••••${plain.slice(-4)}`;
}

// ─── Cache + resolution ──────────────────────────────────────────────────────

export const SETTINGS_TTL_MS = 15_000;

/** Loader injected by the host process; keeps this module free of a DB import. */
export type SettingsLoader = () => Map<string, string>;

let snapshot = new Map<string, string>();
let loadedAt = 0;
let loader: SettingsLoader | null = null;

/**
 * Install the synchronous snapshot source. The DB read itself is async, so the
 * host refreshes a cached map in the background (see `startSettingsRefresh`)
 * and this returns the latest known values without ever blocking a getter.
 */
export function installSettingsLoader(fn: SettingsLoader): void {
  loader = fn;
}

export function primeSettings(values: Map<string, string>): void {
  snapshot = values;
  loadedAt = Date.now();
}

export function settingsAgeMs(): number {
  return loadedAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - loadedAt;
}

export function settingsStale(): boolean {
  return settingsAgeMs() > SETTINGS_TTL_MS;
}

function current(): Map<string, string> {
  if (loader && settingsStale()) {
    try { primeSettings(loader()); } catch { /* keep the last good snapshot */ }
  }
  return snapshot;
}

/**
 * Effective value for a key: DB → env → registry default.
 * Secrets are decrypted here, so callers only ever see plaintext.
 */
export function getSetting(key: string): string {
  const raw = current().get(key);
  if (raw !== undefined && raw !== '') {
    const def = BY_KEY.get(key);
    return def?.secret ? decryptSecret(raw) : raw;
  }
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  return BY_KEY.get(key)?.default ?? '';
}

/** Where the effective value came from — shown in the UI so nothing is magic. */
export function settingSource(key: string): 'db' | 'env' | 'default' {
  const raw = current().get(key);
  if (raw !== undefined && raw !== '') return 'db';
  const env = process.env[key];
  if (env !== undefined && env !== '') return 'env';
  return 'default';
}

export function getSettingNumber(key: string, fallback: number): number {
  const v = getSetting(key);
  if (v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Booleans are "not false": an unset value keeps the registry default. */
export function getSettingBool(key: string, fallback: boolean): boolean {
  const v = getSetting(key).trim().toLowerCase();
  if (v === '') return fallback;
  return v !== 'false' && v !== '0' && v !== 'no';
}

export function getSettingEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = getSetting(key).trim() as T;
  return allowed.includes(v) ? v : fallback;
}
