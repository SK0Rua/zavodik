/**
 * Tiny key/value store for pieces of poller state that are neither evidence nor
 * business data — currently only the IMAP UID cursor.
 *
 * Why a cursor at all: the previous implementation used `\Seen` flags, which
 * silently loses replies whenever Roman opens the mailbox in Gmail before the
 * poller does. UIDVALIDITY + UID is the protocol's own durable pointer.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(schema.settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getJsonSetting<T>(key: string): Promise<T | null> {
  const raw = await getSetting(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function setJsonSetting(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}

/** IMAP cursor: which UID we have already processed, in which UIDVALIDITY epoch. */
export interface ImapCursor {
  uidValidity: string;
  lastUid: number;
}

const IMAP_CURSOR_KEY = 'imap.cursor';

export async function getImapCursor(): Promise<ImapCursor | null> {
  return getJsonSetting<ImapCursor>(IMAP_CURSOR_KEY);
}

/**
 * Store the cursor. A changed UIDVALIDITY means the server renumbered the
 * mailbox and old UIDs are meaningless — the caller must reset, not advance.
 */
export async function setImapCursor(cursor: ImapCursor): Promise<void> {
  await setJsonSetting(IMAP_CURSOR_KEY, cursor);
}
