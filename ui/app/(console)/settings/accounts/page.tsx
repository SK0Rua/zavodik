import { ConnectedAccounts } from '@/components/ConnectedAccounts';
import { masterKeyConfigured } from '@/lib/settings';
import { loadAccounts } from '@/lib/accounts';
import { loadChecks } from '@/lib/checks';

export const dynamic = 'force-dynamic';

/** «Акаунти» — every credential the factory needs, and nothing else. */
export default async function AccountsSettingsPage() {
  // In parallel: on a warm cache the checks cost milliseconds, and on a cold
  // one they must not queue behind a DB read that was going to be instant.
  const [accounts, checks] = await Promise.all([loadAccounts(), loadChecks()]);

  return (
    <>
      {!masterKeyConfigured() && (
        <section className="card p-5 border-dot-stop/40">
          <h2 className="h-section text-dot-stop mb-2">SETTINGS_MASTER_KEY не заданий</h2>
          <p className="text-sm text-ink-soft max-w-[68ch]">
            Без нього секрети (токени, паролі) неможливо зберегти — вони шифруються саме цим
            ключем. Несекретні поля зберігаються нормально.
          </p>
          <pre className="mt-3 text-sm bg-paper-sunk border border-line rounded-lg p-3 overflow-x-auto font-mono">
{`# на сервері, один раз:
echo "SETTINGS_MASTER_KEY=$(openssl rand -hex 32)" >> .env
docker compose up -d --force-recreate factory factory-build ui`}
          </pre>
          <p className="text-sm text-ink-mute mt-2">
            Ключ не змінюй без потреби: після зміни збережені секрети стануть нечитабельними.
          </p>
        </section>
      )}

      <ConnectedAccounts accounts={accounts} checks={checks.checks} checksError={checks.error} />
    </>
  );
}
