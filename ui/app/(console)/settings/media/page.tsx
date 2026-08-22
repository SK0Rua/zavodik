import { SettingsSection } from '@/components/SettingsSection';
import { SETTING_GROUPS, loadSettingViews, masterKeyConfigured } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function MediaSettingsPage() {
  const views = await loadSettingViews();
  return (
    <SettingsSection
      groups={SETTING_GROUPS}
      fields={views}
      active="media"
      masterKeyConfigured={masterKeyConfigured()}
    />
  );
}
