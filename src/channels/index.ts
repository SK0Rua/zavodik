/**
 * Channel registry. One place that maps a channel name to its adapter, so the
 * outreach worker never branches on strings.
 */
import type { ChannelAdapter, OutreachChannel, OutreachDraft } from './types.js';
import { whatsappAdapter } from './whatsapp.js';
import { emailAdapter } from './email.js';
import { instagramAdapter } from './instagram.js';
import { viberAdapter } from './viber.js';

const ADAPTERS: Record<OutreachChannel, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  viber: viberAdapter,
  email: emailAdapter,
};

export function adapterFor(channel: OutreachChannel): ChannelAdapter {
  const adapter = ADAPTERS[channel];
  if (!adapter) throw new Error(`unknown outreach channel: ${channel}`);
  return adapter;
}

/** Deep link for manual channels (and the wa.me fallback); null when not applicable. */
export function deepLinkFor(draft: OutreachDraft): string | null {
  const adapter = ADAPTERS[draft.channel];
  return adapter?.deepLink?.(draft) ?? null;
}

export * from './types.js';
export * from './select.js';
