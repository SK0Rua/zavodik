import type { Metadata } from 'next';
import { Fraunces, Outfit } from 'next/font/google';
import { SmoothScroll } from '@/components/smooth-scroll';
import './globals.css';

/**
 * TYPOGRAPHY — builder agent: change these two fonts to suit the art direction.
 *
 * The default pair is deliberately NOT Inter/Poppins (see DESIGN.md ban-list).
 *   Fraunces — a high-contrast "soft serif" with an optical-size axis; reads
 *              editorial and expensive at display sizes. Used for headings.
 *   Outfit   — a geometric sans with a tall x-height that stays neutral under
 *              a loud display face. Used for body copy.
 *
 * Rules when swapping:
 *  - Load via next/font/google only. It self-hosts the files at build time,
 *    which is what keeps `output: 'export'` working offline with no CDN call.
 *  - Keep the CSS variable names --font-display / --font-body: globals.css and
 *    every component reference them.
 *  - Always keep a `display: 'swap'` and a real fallback stack.
 *
 * GREEK SITES — READ THIS. Neither Fraunces nor Outfit supports the `greek`
 * subset, and requesting a subset a font lacks is a HARD BUILD FAILURE
 * ("Unknown subset `greek` for font `Fraunces`"), not a silent fallback. If
 * snapshot.language is Greek, swap BOTH fonts. Verified Greek pairs:
 * GFS_Didot + Manrope (weight '400' for GFS_Didot), EB_Garamond + Manrope,
 * Literata + Source_Sans_3. See DESIGN.md §5.
 */
const display = Fraunces({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-display',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
});

const body = Outfit({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-body',
  display: 'swap',
});

/**
 * Builder agent: replace title/description with the real business identity from
 * input/snapshot.json.
 *
 * `robots: noindex/nofollow` is MANDATORY and must never be removed — these are
 * private demo sites (SPEC §8). The deploy is also served from an unguessable
 * URL, but the meta tag is the second lock.
 */
export const metadata: Metadata = {
  title: 'Demo Site',
  description: 'Private demo website',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el" className={`${display.variable} ${body.variable}`}>
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
