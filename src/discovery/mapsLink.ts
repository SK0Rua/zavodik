/**
 * Reading a Google Maps link Roman pasted.
 *
 * He finds a business on the map himself and wants it in the funnel. gosom
 * takes SEARCH QUERIES, not URLs, so the link has to be turned back into
 * something searchable: a name, and ideally the coordinates to search around.
 *
 * Nothing here scrapes Google. The link's own path already carries the place
 * name and the map centre — that is public information Roman handed us — and
 * everything else comes from gosom, the one component allowed to touch Maps.
 * A short `maps.app.goo.gl` link carries none of it, so that one redirect is
 * followed to reveal the real URL, and nothing more.
 */
import { log } from '../lib/logger.js';

export interface ParsedMapsLink {
  /** Place name from the URL path, when it has one. */
  name: string | null;
  /** Map centre from `@lat,lng,zoom`, the best search anchor available. */
  lat: number | null;
  lng: number | null;
  /** The canonical (redirect-resolved) URL, kept as the evidence source. */
  url: string;
}

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
const MAPS_HOSTS = /(^|\.)google\.[a-z.]+$/i;

export class MapsLinkError extends Error {}

/** Is this a Google Maps URL we can even try to read? */
export function looksLikeMapsLink(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (SHORT_HOSTS.has(url.hostname)) return true;
    return MAPS_HOSTS.test(url.hostname) && url.pathname.includes('/maps');
  } catch {
    return false;
  }
}

/**
 * Follow a short link to the URL it stands for.
 *
 * Only the hosts above, and only to a Google destination: this takes a string
 * from a text box and makes the server fetch it, so it must never become a way
 * to point the factory at an arbitrary address.
 */
async function resolveShortLink(url: URL): Promise<URL> {
  if (!SHORT_HOSTS.has(url.hostname)) return url;
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; websites-factory/1.0)' },
    });
  } catch (err) {
    throw new MapsLinkError(`Не вдалось розгорнути коротке посилання: ${String(err).slice(0, 120)}`);
  }
  const resolved = new URL(response.url);
  if (!MAPS_HOSTS.test(resolved.hostname)) {
    throw new MapsLinkError('Коротке посилання веде не на Google Maps.');
  }
  return resolved;
}

function decodePlaceName(segment: string): string | null {
  try {
    // Decode FIRST and test the plus-code before collapsing `+` into spaces:
    // Google writes a space as `+` and a literal plus as `%2B`, so both look
    // identical after the replace, and a plus-code ("9G4C+X8 Sumy") would then
    // be indistinguishable from a name.
    const decoded = decodeURIComponent(segment).trim();
    if (/^[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}/i.test(decoded)) {
      return null;
    }
    const name = decoded.replace(/\+/g, ' ').trim();
    // A bare coordinate pair is not a name either.
    if (!name || /^[\d.,\s-]+$/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

/** Pull the name and map centre out of a Maps URL, resolving a short link first. */
export async function parseMapsLink(raw: string): Promise<ParsedMapsLink> {
  const trimmed = raw.trim();
  if (!looksLikeMapsLink(trimmed)) {
    throw new MapsLinkError('Це не схоже на посилання Google Maps.');
  }

  const resolved = await resolveShortLink(new URL(trimmed));
  const segments = resolved.pathname.split('/').filter(Boolean);

  const placeIndex = segments.indexOf('place');
  const name = placeIndex >= 0 && segments[placeIndex + 1]
    ? decodePlaceName(segments[placeIndex + 1]!)
    : null;

  // `@lat,lng,zoom` is the map centre. On a place URL it sits on the place
  // itself, which makes it a tight anchor for the search that follows.
  let lat: number | null = null;
  let lng: number | null = null;
  const at = segments.find((s) => s.startsWith('@'));
  if (at) {
    const [rawLat, rawLng] = at.slice(1).split(',');
    const parsedLat = Number(rawLat);
    const parsedLng = Number(rawLng);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
      lat = parsedLat;
      lng = parsedLng;
    }
  }
  // A `?q=lat,lng` link (the "share coordinates" form) has no `@` segment.
  if (lat === null) {
    const q = resolved.searchParams.get('q') ?? resolved.searchParams.get('query');
    const match = q?.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
    if (match) {
      lat = Number(match[1]);
      lng = Number(match[2]);
    }
  }

  if (!name && lat === null) {
    throw new MapsLinkError(
      'З цього посилання не вдалось прочитати ні назву, ні координати. '
      + 'Відкрий місце на карті й скопіюй посилання з адресного рядка.',
    );
  }

  log.info('maps link parsed', { name, lat, lng, url: resolved.toString() });
  return { name, lat, lng, url: resolved.toString() };
}
