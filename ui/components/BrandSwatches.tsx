/**
 * The business's own measured brand identity, as swatches.
 *
 * Built from the `brand.*` rows in `business_facts`, which are written by
 * `src/enrichment/brandIdentity.ts` — every colour was decoded from this
 * business's logo, its profile picture, its stylesheet or its photographs, and
 * every one names the capture it came from.
 *
 * Why it is on the card at all: Roman's question was "Ти досліджуєш соцмережі
 * бізнесу? Береш їхні кольори, айдентику?" A number in a JSON blob does not
 * answer that. A row of swatches he can look at, next to the source link, does.
 */
type FactRow = {
  id: number;
  key: string;
  value: unknown;
  sourceId: number | null;
};

type SourceRow = { id: number; sourceType: string; url: string };

interface Swatch {
  hex: string;
  share: number | null;
}

/** Human labels for the evidence a palette rests on. */
const PALETTE_SOURCE_LABEL: Record<string, string> = {
  logo: 'логотип',
  avatar: 'аватар у соцмережі',
  site: 'їхній сайт',
  photos: 'їхні фото',
};

const PALETTE_KEY_LABEL: Record<string, string> = {
  'brand.logo_colors': 'З логотипа',
  'brand.avatar_colors': 'З аватара в соцмережі',
  'brand.site_colors': 'З їхнього сайту',
  'brand.photo_colors': 'З їхніх фото',
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function swatchesOf(value: unknown): Swatch[] {
  const obj = asObject(value);
  if (!obj || !Array.isArray(obj.colors)) return [];
  return (obj.colors as unknown[])
    .map((c) => {
      const o = asObject(c);
      const hex = typeof o?.hex === 'string' ? o.hex : null;
      if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
      return { hex, share: typeof o?.share === 'number' ? o.share : null };
    })
    .filter((c): c is Swatch => c !== null);
}

function Chip({ hex, share, title }: { hex: string; share?: number | null; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title ?? hex}>
      <span
        aria-hidden
        className="inline-block w-5 h-5 rounded border border-line shrink-0"
        style={{ backgroundColor: hex }}
      />
      <span className="text-sm font-mono text-ink-mute">
        {hex}
        {typeof share === 'number' && share > 0 ? ` ${Math.round(share * 100)}%` : ''}
      </span>
    </span>
  );
}

export function BrandSwatches({ facts, sources }: { facts: FactRow[]; sources: SourceRow[] }) {
  const brandFacts = facts.filter((f) => f.key.startsWith('brand.'));
  if (brandFacts.length === 0) return null;

  const byKey = new Map(brandFacts.map((f) => [f.key, f]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const srcOf = (f: FactRow | undefined) => (f?.sourceId ? sourceById.get(f.sourceId) : undefined);

  const primary = asObject(byKey.get('brand.palette_primary')?.value);
  const accent = asObject(byKey.get('brand.palette_accent')?.value);
  const voice = asObject(byKey.get('brand.voice')?.value);
  const fonts = asObject(byKey.get('brand.fonts_seen')?.value);

  const paletteSource = typeof primary?.paletteSource === 'string' ? primary.paletteSource : null;

  return (
    <section className="card p-5 sm:p-6">
      <h3 className="label">Їхня айдентика</h3>
      <p className="text-sm text-ink-mute mt-1">
        Виміряно з їхніх власних матеріалів — саме з цих кольорів будується демо.
        {paletteSource && ` Основне джерело: ${PALETTE_SOURCE_LABEL[paletteSource] ?? paletteSource}.`}
      </p>

      {(primary || accent) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4">
          {typeof primary?.hex === 'string' && (
            <div>
              <div className="text-sm text-ink-mute mb-1">Основний</div>
              <Chip hex={primary.hex} title={String(primary.from ?? primary.hex)} />
            </div>
          )}
          {typeof accent?.hex === 'string' && (
            <div>
              <div className="text-sm text-ink-mute mb-1">Акцент</div>
              <div className="flex items-center gap-3 flex-wrap">
                <Chip hex={accent.hex} title={String(accent.from ?? accent.hex)} />
                {/* The corrected variants are what actually goes on the page:
                    the raw brand colour is frequently below AA on both grounds. */}
                {/* Show a corrected variant only when correction actually
                    changed the colour: an accent that already passes contrast
                    on one ground returns unchanged, and repeating the same hex
                    reads as two different colours. */}
                {typeof accent.onLight === 'string' && accent.onLight !== accent.hex && (
                  <Chip hex={accent.onLight} title="Виправлений під світлий фон (контраст AA)" />
                )}
                {typeof accent.onDark === 'string'
                  && accent.onDark !== accent.hex && accent.onDark !== accent.onLight && (
                  <Chip hex={accent.onDark} title="Виправлений під темний фон (контраст AA)" />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {Object.entries(PALETTE_KEY_LABEL).map(([key, label]) => {
          const fact = byKey.get(key);
          const swatches = swatchesOf(fact?.value);
          if (swatches.length === 0) return null;
          const src = srcOf(fact);
          return (
            <div key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <span className="text-sm text-ink-mute w-44 shrink-0">{label}</span>
              <span className="flex flex-wrap items-center gap-3">
                {swatches.map((c) => <Chip key={c.hex} hex={c.hex} share={c.share} />)}
              </span>
              {src && (
                <a href={src.url} target="_blank" rel="noreferrer" className="text-sm shrink-0">
                  {src.sourceType} ↗
                </a>
              )}
            </div>
          );
        })}
      </div>

      {(voice || fonts) && (
        <div className="mt-4 pt-3 border-t border-line space-y-1.5">
          {voice && (
            <p className="text-sm">
              <span className="text-ink-mute">Тон: </span>
              {String(voice.tone ?? '—')}
              {voice.formality ? `, ${String(voice.formality)}` : ''}
              {Array.isArray(voice.selfDescribedAs) && voice.selfDescribedAs.length > 0 && (
                <span className="text-ink-mute"> · про себе: {voice.selfDescribedAs.map(String).join(' | ')}</span>
              )}
            </p>
          )}
          {fonts && Array.isArray(fonts.fonts) && fonts.fonts.length > 0 && (
            <p className="text-sm">
              <span className="text-ink-mute">Шрифти на їхньому сайті: </span>
              {fonts.fonts.map(String).join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
