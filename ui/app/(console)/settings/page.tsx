import { redirect } from 'next/navigation';

/**
 * `/settings` is a shell, not a page: the content lives in the sidebar
 * sections. Accounts open first because that is the order Roman sets the
 * factory up — nothing else works before the accounts do.
 */
export default function SettingsPage() {
  redirect('/settings/accounts');
}
