import { Nav } from '@/components/Nav';
import { inboxCount } from '@/lib/inbox';

// Everything here is live operator data; never serve it from a cache.
export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pending = await inboxCount();
  return (
    <>
      <Nav pendingCount={pending} />
      <main className="mx-auto max-w-console px-4 sm:px-6 py-8 sm:py-10">{children}</main>
    </>
  );
}
