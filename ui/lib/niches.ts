/**
 * Suggested niches for the new-campaign form.
 *
 * This is a SUGGESTION list, not a closed enum: the field stays free text (a
 * `<datalist>`), so Roman can pick a common one or type anything. The `value` is
 * the English term that goes into the campaign id and the generated queries
 * (gosom is fed both languages anyway); `label` is the Ukrainian gloss shown in
 * the dropdown so the list reads at a glance.
 *
 * Ordered roughly by how often a small local business in this line has no real
 * website — beauty/food/trades first, because those are the factory's bread and
 * butter. Not exhaustive by design; the point is to save typing, not to fence
 * Roman in.
 */
export interface NicheOption {
  value: string;
  label: string;
}

export const NICHES: NicheOption[] = [
  { value: 'beauty', label: 'б’юті (загально)' },
  { value: 'nail salon', label: 'манікюр / нігтьовий салон' },
  { value: 'hair salon', label: 'перукарня / салон краси' },
  { value: 'barber', label: 'барбершоп' },
  { value: 'brows and lashes', label: 'брови та вії' },
  { value: 'spa', label: 'спа' },
  { value: 'massage', label: 'масаж' },
  { value: 'cosmetology', label: 'косметологія' },
  { value: 'tattoo', label: 'тату-салон' },
  { value: 'aesthetic clinic', label: 'естетична клініка' },
  { value: 'dental clinic', label: 'стоматологія' },
  { value: 'fitness', label: 'фітнес / тренажерний зал' },
  { value: 'yoga studio', label: 'йога-студія' },
  { value: 'restaurant', label: 'ресторан' },
  { value: 'cafe', label: 'кав’ярня' },
  { value: 'bakery', label: 'пекарня / кондитерська' },
  { value: 'bar', label: 'бар' },
  { value: 'florist', label: 'квітковий магазин' },
  { value: 'photographer', label: 'фотограф / фотостудія' },
  { value: 'auto repair', label: 'автосервіс' },
  { value: 'car wash', label: 'автомийка' },
  { value: 'veterinary clinic', label: 'ветклініка' },
  { value: 'pet grooming', label: 'грумінг' },
  { value: 'law firm', label: 'юридична фірма' },
  { value: 'real estate agency', label: 'агенція нерухомості' },
  { value: 'travel agency', label: 'турагенція' },
];
