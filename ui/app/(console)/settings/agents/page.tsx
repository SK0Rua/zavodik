import { SettingsSection } from '@/components/SettingsSection';
import { EffectiveConfigPanel } from '@/components/EffectiveConfigPanel';
import { SETTING_GROUPS, loadSettingViews, masterKeyConfigured } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function AgentsSettingsPage() {
  const views = await loadSettingViews();
  return (
    <div className="space-y-4">
      <SettingsSection
        groups={SETTING_GROUPS}
        fields={views}
        active="agents"
        masterKeyConfigured={masterKeyConfigured()}
      />
      <EffectiveConfigPanel agentsOnly />
    </div>
  );
}
