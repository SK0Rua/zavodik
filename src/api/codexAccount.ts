import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length === 0 || email.length > 254 || /\s/.test(email)) return null;
  const at = email.indexOf('@');
  return at > 0 && at < email.length - 1 ? email : null;
}

/**
 * Extract the display email from Codex's local ChatGPT id token.
 *
 * This does not verify the JWT signature and must never be used for
 * authentication or authorization. The CLI already owns and validates this
 * credential; the settings page only needs a human-readable label for the
 * local session it reports as logged in.
 */
export function codexEmailFromAuth(auth: unknown): string | null {
  const tokens = object(object(auth)?.tokens);
  const idToken = tokens?.id_token;
  if (typeof idToken !== 'string') return null;

  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const claims = object(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
    return validEmail(claims?.email);
  } catch {
    return null;
  }
}

/** Read only the email claim; raw Codex credentials never leave this module. */
export async function readCodexAccountEmail(): Promise<string | null> {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  try {
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')) as unknown;
    return codexEmailFromAuth(auth);
  } catch {
    return null;
  }
}
