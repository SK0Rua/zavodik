/**
 * "Підключені акаунти" — what is configured, as seen at page render time.
 *
 * This is deliberately the CHEAP half of the answer. It reports whether the
 * credentials exist and are well-formed, which is what makes the page render
 * instantly; whether they actually *work* is the "Перевірити" button on each
 * row, which runs the real check in the factory (a Claude ping, an SMTP
 * handshake, a live Telegram message).
 *
 * The distinction is honest rather than pedantic, and the UI states it: a row
 * says "налаштовано" from this file and only says "підключено" after a check
 * has come back green in the same session.
 */
import { effectiveValue } from './settings';

/** Row state before any live check has run. */
export type AccountReadiness = 'configured' | 'missing' | 'partial';

export interface AccountStatus {
  id: 'claude' | 'codex' | 'telegram' | 'whatsapp' | 'gmail' | 'flowkit';
  readiness: AccountReadiness;
  /** One line describing what IS set, or what is missing. */
  detail: string;
}

export interface AccountsSnapshot {
  claude: AccountStatus;
  codex: AccountStatus;
  telegram: AccountStatus;
  whatsapp: AccountStatus;
  gmail: AccountStatus;
  flowkit: AccountStatus;
  /** Secrets cannot be stored at all without it — the block says so up top. */
  masterKey: boolean;
}

const mask = (v: string): string => (v.length <= 4 ? '••••' : `••••${v.slice(-4)}`);

export async function loadAccounts(): Promise<AccountsSnapshot> {
  const [
    claudeToken, tgToken, tgChat,
    smtpUser, smtpPass, imapUser, imapPass,
    wahaUrl, wahaKey, wahaSession, flowkitUrl, flowkitMode,
  ] = await Promise.all([
    effectiveValue('CLAUDE_CODE_OAUTH_TOKEN'),
    effectiveValue('TELEGRAM_BOT_TOKEN'),
    effectiveValue('TELEGRAM_CHAT_ID'),
    effectiveValue('SMTP_USER'),
    effectiveValue('SMTP_PASS'),
    effectiveValue('IMAP_USER'),
    effectiveValue('IMAP_PASS'),
    effectiveValue('WAHA_URL'),
    effectiveValue('WAHA_API_KEY'),
    effectiveValue('WAHA_SESSION'),
    effectiveValue('FLOWKIT_URL'),
    effectiveValue('FLOWKIT_MODE'),
  ]);

  // Claude: a token here is one path; a CLI login inside the container is the
  // other, and it is invisible from the database. So "no token" is reported as
  // an unknown-but-probably-missing rather than a flat failure — the check
  // button is what settles it.
  const claude: AccountStatus = claudeToken
    ? {
      id: 'claude', readiness: 'configured',
      detail: claudeToken.startsWith('sk-ant-oat')
        ? `токен ${mask(claudeToken)}`
        : `токен ${mask(claudeToken)} — формат незвичний (очікується sk-ant-oat…)`,
    }
    : { id: 'claude', readiness: 'missing', detail: 'токен не заданий' };

  // Codex has no stored setting at all: its credential is a file in the
  // codexhome volume. Only `codex login status` in the factory knows, so this
  // row is always "перевір" until the button says otherwise.
  const codex: AccountStatus = {
    id: 'codex', readiness: 'partial',
    detail: 'логін у volume codexhome — статус лише за перевіркою',
  };

  const telegram: AccountStatus = tgToken && tgChat
    ? { id: 'telegram', readiness: 'configured', detail: `бот ${mask(tgToken)}, chat ${tgChat}` }
    : tgToken || tgChat
      ? { id: 'telegram', readiness: 'partial', detail: tgToken ? 'є токен, нема chat id' : 'є chat id, нема токена' }
      : { id: 'telegram', readiness: 'missing', detail: 'не налаштовано' };

  const gmailComplete = Boolean(smtpUser && smtpPass && imapUser && imapPass);
  const gmailAny = Boolean(smtpUser || smtpPass || imapUser || imapPass);
  const gmail: AccountStatus = gmailComplete
    ? { id: 'gmail', readiness: 'configured', detail: `${smtpUser} (SMTP + IMAP)` }
    : gmailAny
      ? {
        id: 'gmail', readiness: 'partial',
        detail: `неповно: ${[
          smtpUser ? null : 'SMTP user', smtpPass ? null : 'SMTP pass',
          imapUser ? null : 'IMAP user', imapPass ? null : 'IMAP pass',
        ].filter(Boolean).join(', ')} — нема`,
      }
      : { id: 'gmail', readiness: 'missing', detail: 'не налаштовано' };

  // WAHA needs a URL and a key to even be asked about pairing; the pairing
  // itself (SCAN_QR_CODE vs WORKING) only the check can tell.
  const whatsapp: AccountStatus = wahaUrl && wahaKey
    ? { id: 'whatsapp', readiness: 'partial', detail: `${wahaUrl}, сесія ${wahaSession || 'default'} — стан за перевіркою` }
    : { id: 'whatsapp', readiness: 'missing', detail: wahaUrl ? 'нема WAHA API key' : 'нема WAHA URL' };

  // FlowKit is optional by design: its absence degrades to Ken Burns, it never
  // fails a build. The row exists so that degradation is visible, not silent.
  const flowkit: AccountStatus = {
    id: 'flowkit',
    readiness: flowkitUrl ? 'partial' : 'missing',
    detail: flowkitUrl
      ? `${flowkitUrl}, режим ${flowkitMode || 'auto'} — доступність за перевіркою`
      : 'URL не заданий — відео завжди Ken Burns',
  };

  const { masterKeyConfigured } = await import('./settings');

  return { claude, codex, telegram, whatsapp, gmail, flowkit, masterKey: masterKeyConfigured() };
}
