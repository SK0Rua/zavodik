/**
 * Start-up hook that makes UI-edited settings visible to this process.
 *
 * Imported for its side effect by `src/db/client.ts` — every factory process
 * (workers, API, CLI, scripts) already imports the DB client, so none of them
 * can accidentally run with a cold settings snapshot and silently fall back to
 * `.env` for a value Roman changed in the UI.
 *
 * Deliberately fire-and-forget: `initSettings()` is async, but `getSetting()`
 * degrades to env → default until the first snapshot lands (milliseconds), so
 * nothing has to await it. A DB that is down at start-up therefore does not
 * block boot; the refresher retries every 15s.
 *
 * Split from settingsStore.ts to keep the import edge one-directional:
 * client.ts -> bootstrapSettings.ts -> settingsStore.ts -> client.ts is a cycle
 * ESM resolves fine only because the call is deferred to a microtask.
 */
import { initSettings } from './settingsStore.js';

let started = false;

export function bootstrapSettings(): void {
  if (started) return;
  started = true;
  // Deferred a tick so the DB client module has finished evaluating before the
  // store imports it back.
  queueMicrotask(() => {
    void initSettings().catch(() => { /* refresher retries; env remains the fallback */ });
  });
}
