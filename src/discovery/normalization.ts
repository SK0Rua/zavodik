export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * The owned domain of a URL, or null when it is a booking/directory/social
 * profile rather than a business's own site (SPEC §5 invariant). `extra` carries
 * the operator's skip-list from settings (`msg.me`, `choiceqr.com`, …) so a
 * short-lived booking/menu shortener can be classified as "not a real site"
 * without a code change — see config.discovery.extraDirectoryDomains.
 */
export function extractDomain(url: string | null, extra: string[] = []): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    // booking/directory profiles are NOT owned websites
    const directories = [
      'facebook.com', 'instagram.com', 'booksy.com', 'fresha.com',
      'treatwell.gr', 'linktr.ee', 'business.site', ...extra,
    ];
    return directories.some((d) => host === d || host.endsWith(`.${d}`)) ? null : host;
  } catch {
    return null;
  }
}

export function slugify(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'business';
}

export function normalizeName(name: string): string {
  return name.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9α-ω]+/g, ' ')
    .trim();
}

export function geoClose(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): boolean {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return false;
  const dLat = (aLat - bLat) * 111_000;
  const dLng = (aLng - bLng) * 111_000 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) < 150;
}
