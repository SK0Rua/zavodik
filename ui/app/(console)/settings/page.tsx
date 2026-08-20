import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { SettingsTabs } from '@/components/SettingsTabs';
import { SettingsGroupForm } from '@/components/SettingsGroupForm';
import { FactoryModeSwitch } from '@/components/FactoryModeSwitch';
import { ConnectedAccounts } from '@/components/ConnectedAccounts';
import { SETTING_GROUPS, loadSettingViews, masterKeyConfigured } from '@/lib/settings';
import { loadAccounts } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

/** Which check button belongs to which group. Groups without one show none. */
const GROUP_CHECKS: Record<string, Array<{ kind: string; label: string }>> = {
  agents: [
    { kind: 'claude', label: 'Перевірити Claude' },
    { kind: 'codex', label: 'Перевірити Codex' },
  ],
  telegram: [{ kind: 'telegram', label: 'Надіслати тест' }],
  email: [
    { kind: 'smtp', label: 'Перевірити SMTP' },
    { kind: 'imap', label: 'Перевірити IMAP' },
  ],
  whatsapp: [{ kind: 'waha', label: 'Перевірити WAHA' }],
  media: [{ kind: 'flowkit', label: 'Перевірити FlowKit' }],
};

export default async function SettingsPage() {
  const [views, accounts, problemRows] = await Promise.all([
    loadSettingViews(),
    loadAccounts(),
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

        {/* Roman's own order: connect the accounts first, then choose the mode,
            then everything that only matters when something is unusual. */}
        <ConnectedAccounts accounts={accounts} />

        <FactoryModeSwitch current={mode?.value === 'live' ? 'live' : 'dry_run'} />

        <details className="card p-5">
          <summary className="text-sm font-medium text-ink">
            Розширені
            <span className="text-ink-mute font-normal ml-2">
              ліміти, gosom, ключі вебхуків, вибір моделей
            </span>
          </summary>

          <p className="text-sm text-ink-mute mt-3 max-w-[68ch]">
            Те саме, що вище, але полями. Потрібне для того, що не має кнопки.
            Значення діють наживо — фабрика перечитує їх протягом ~15 секунд, без перезапуску.
          </p>

          <div className="space-y-6 mt-5">
            {SETTING_GROUPS.map((g) => (
              <SettingsGroupForm
                key={g.id}
                group={g.id}
                title={g.title}
                blurb={g.blurb}
                fields={views.filter((v) => v.group === g.id)}
                checks={GROUP_CHECKS[g.id] ?? []}
                masterKeyConfigured={hasMasterKey}
              />
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
