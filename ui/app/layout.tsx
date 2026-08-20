import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Websites Factory',
  description: 'Control UI: approval queue, funnel, campaigns, jobs, conversations',
  // A private operator console must never be indexed (SPEC §8).
  robots: { index: false, follow: false },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
