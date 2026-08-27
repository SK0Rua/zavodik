/** Shared result shape returned by server actions to the client components. */
export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when a manual channel (instagram/viber) needs Roman to send by hand. */
  manual?: { channel: string; deepLink: string; text: string; approvalId: number };
}

/** Import tone type without pulling the (server-only) humanStatus module. */
export type QuickViewTone = 'go' | 'wait' | 'stop' | 'idle';

/**
 * The at-a-glance payload behind a business row's «Швидкий перегляд» modal.
 * A read-only projection assembled by the `businessQuickView` server action —
 * enough to judge a lead without opening the full card.
 */
export interface QuickView {
  id: string;
  name: string;
  niche: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  statusText: string;
  statusTone: QuickViewTone;
  verdictText: string;
  score: number | null;
  rating: number | null;
  reviewCount: number | null;
  description: string | null;
  services: string[];
  contacts: Array<{ channel: string; value: string; verified: boolean }>;
  /** Open HARD gaps, already translated to Ukrainian names. */
  gaps: string[];
  deployUrl: string | null;
  /** Object key of the latest website-audit desktop screenshot (bucket `raw`). */
  auditShotKey: string | null;
  /** Object key of a representative business photo/logo (bucket `assets`). */
  heroKey: string | null;
  /** A demo build for this business is in flight right now — show the live panel. */
  buildActive: boolean;
  /** Newest site_project state, or null when none exists (for the live panel). */
  projectState: string | null;
}
