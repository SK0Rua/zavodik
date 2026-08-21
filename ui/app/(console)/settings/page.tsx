import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { SettingsTabs } from '@/components/SettingsTabs';
import { SettingsBody } from '@/components/SettingsBody';
import { FactoryModeSwitch } from '@/components/FactoryModeSwitch';
import { ConnectedAccounts } from '@/components/ConnectedAccounts';
import { EffectiveConfigPanel } from '@/components/EffectiveConfigPanel';
import { SETTING_GROUPS, loadSettingViews, masterKeyConfigured } from '@/lib/settings';
import { loadAccounts } from '@/lib/accounts';
import { loadChecks } from '@/lib/checks';

export const dynamic = 'force-dynamic';

/**
 * `/settings`, in the order Roman actually works: connect the accounts, choose
 * the mode, then adjust the things that have no button.
 *
 * The per-group check buttons that used to sit in the parameter forms are gone
 * from here — «Підключені акаунти» runs the real checks and shows their result
 * on open, so a second «Перевірити SMTP» further down the page was the same
 * question asked twice with two different answers.
 */
export default async function SettingsPage() {
  // The checks run alongside the DB reads rather than after them: on a warm
  // cache they cost milliseconds, and on a cold one they must not be serialised
  // behind three queries that were going to be instant anyway.
  const [views, accounts, checks, problemRows] = await Promise.all([
    loadSettingViews(),
    loadAccounts(),
    loadChecks(),
    db.select({ n: sql<number>`count(*)` }).from(schema.workflowJobs)
      .where(inArray(schema.workflowJobs.status, ['failed', 'needs_human'])),
  ]);
  const hasMasterKey = masterKeyConfigured();
  const mode = views.find((v) => v.key === 'FACTORY_MODE');

  return (
    <div>
      <h1 className="h-page mb-6">Налаштування</h1>
      <SettingsTabs problemCount={Number(problemRows[0]?.n ?? 0)} />

      <div className="space-y-6">
        {!hasMasterKey && (
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

        <FactoryModeSwitch current={mode?.value === 'live' ? 'live' : 'dry_run'} />

        <SettingsBody
          groups={SETTING_GROUPS}
          fields={views}
          masterKeyConfigured={hasMasterKey}
        />

        <EffectiveConfigPanel />
      </div>
    </div>
  );
}
