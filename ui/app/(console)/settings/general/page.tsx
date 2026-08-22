import { SettingsSection } from '@/components/SettingsSection';
import { SETTING_GROUPS, loadSettingViews, masterKeyConfigured } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * «Система» — the parameters group (discovery, socials, timezone, GC).
 * `/settings/system` was already taken by diagnostics and is deep-linked from
 * Telegram notifications, hence the route name differs from the label.
 */
export default async function GeneralSettingsPage() {
  const views = await loadSettingViews();
  return (
    <SettingsSection
      groups={SETTING_GROUPS}
      fields={views}
      active="system"
      masterKeyConfigured={masterKeyConfigured()}
    />
  );
}
