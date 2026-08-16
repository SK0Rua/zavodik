import type { Metadata } from 'next';
import './globals.css';

// NOTE for builder agent: replace title/description with real business identity
// from input/snapshot.json. Keep robots noindex ALWAYS (private demo).
export const metadata: Metadata = {
  title: 'Demo Site',
  description: 'Private demo website',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}
