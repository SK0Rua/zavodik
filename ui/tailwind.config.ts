import type { Config } from 'tailwindcss';

/**
 * The console is a light, quiet, paper-like surface — Roman's feedback was that
 * the previous dark operator console was cluttered ("натикано всього") and ugly.
 *
 * Rules the palette encodes, so a future screen cannot drift back:
 *  - ONE accent (`accent`), reserved for the single primary action on a screen.
 *    Everything else is ink on paper. There is no second brand colour to reach for.
 *  - Status is a WORD with a small dot, never a filled pill. `dot.*` are the only
 *    colours a status may use, and they are muted on purpose: six saturated
 *    badges on one row is what "badge salad" looks like.
 *  - Warm greys, not blue-greys: on a white page a blue-grey reads as "unfinished
 *    Bootstrap", a warm grey reads as paper.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#FBFBFA', // page
          card: '#FFFFFF',    // raised surface
          sunk: '#F4F3F0',    // inset areas, table header, disabled fields
        },
        line: {
          DEFAULT: '#E7E5E1', // hairline border, the ONLY divider style
          strong: '#D6D3CD',  // focus ring / hovered control
        },
        ink: {
          DEFAULT: '#1A1A17', // primary text
          soft: '#57544E',    // secondary text
          mute: '#8A867E',    // tertiary: timestamps, ids, hints
        },
        // Deep pine. Restrained enough to sit next to a photograph without
        // fighting it, saturated enough that one filled button is unmistakably
        // THE action on the screen.
        accent: {
          DEFAULT: '#2F5D50',
          hover: '#264A41',
          soft: '#EDF2F0',    // tint for the "you are here" nav state
        },
        dot: {
          go: '#3F7D5C',   // moving forward on its own
          wait: '#B07B2C', // waiting for Roman
          stop: '#A6402F', // dead / rejected
          idle: '#9A968E', // nothing happening
        },
      },
      fontFamily: {
        // Apple-first system stack: on Roman's phone and Mac this is SF, which is
        // what "minimal like Apple" actually looks like. No webfont to load.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI',
          'Roboto', 'Helvetica Neue', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Two reading sizes and one label size. Anything else is a drift.
        label: ['11px', { lineHeight: '1.4', letterSpacing: '0.07em' }],
        sm: ['13.5px', { lineHeight: '1.55' }],
        base: ['15px', { lineHeight: '1.6' }],
        lg: ['18px', { lineHeight: '1.45' }],
        xl: ['22px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        '2xl': ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
      },
      // 8% is the tint weight the status backgrounds want: present enough to
      // read as a surface, faint enough not to become a badge.
      opacity: { 8: '0.08' },
      borderRadius: { xl: '14px', '2xl': '18px' },
      maxWidth: { console: '1100px' },
      boxShadow: {
        // One shadow, barely there. Cards are defined by their hairline, not by depth.
        card: '0 1px 2px rgba(26, 26, 23, 0.04)',
        pop: '0 6px 24px rgba(26, 26, 23, 0.10)',
      },
    },
  },
  plugins: [],
} satisfies Config;
