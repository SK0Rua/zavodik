import { SettingsSection } from '@/components/SettingsSection';
import { FactoryModeSwitch } from '@/components/FactoryModeSwitch';
import { SETTING_GROUPS, loadSettingViews, masterKeyConfigured } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * «Outreach» opens with the mode switch: dry_run/live is THE outreach decision
 * — whether real businesses get messaged at all — so it leads the section
 * rather than sitting in the parameter list.
 */
export default async function OutreachSettingsPage() {
  const views = await loadSettingViews();
  const mode = views.find((v) => v.key === 'FACTORY_MODE');
  return (
    <>
      <FactoryModeSwitch current={mode?.value === 'live' ? 'live' : 'dry_run'} />
      <SettingsSection
        groups={SETTING_GROUPS}
        fields={views}
        active="outreach"
        masterKeyConfigured={masterKeyConfigured()}
      />
    </>
  );
}
