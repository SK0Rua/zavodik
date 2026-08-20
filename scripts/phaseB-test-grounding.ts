/** Grounding checks against the REAL Thomas Hairdressing case (the 2 invented services). */
import { checkGrounding, checkQuoteGrounding, stripGloss, stripFraming } from '../src/enrichment/grounding.js';

// Verbatim from the captured site HTML meta description.
const SITE = `Υπηρεσίες κομμωτικής, κομμωτική, κομμωτήριο, νύχια, βαφείο, βαφές μαλλιών,
γυναικείο κούρεμα, ανδρικό κούρεμα, παιδικό κούρεμα. Η μόδα αγοράζεται. Το στυλ πρέπει να το έχεις!
Χτένισμα, Μανικιούρ-Πεντικιούρ, Γάμος, Παροχές αισθητικής. Παντανάσσης 44, Πάτρα.`;

let pass = 0, fail = 0;
const t = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`, extra ?? ''); }
};

console.log('# services that ARE on the site must pass');
for (const s of ['Βαφείο', 'Γυναικείο κούρεμα', 'Ανδρικό κούρεμα', 'Παιδικό κούρεμα', 'Χτένισμα', 'Μανικιούρ-Πεντικιούρ', 'Παροχές αισθητικής', 'Γάμος (χτένισμα/styling γάμου)']) {
  const v = checkGrounding(s, SITE);
  t(`grounded: ${s} (coverage ${v.coverage.toFixed(2)})`, v.grounded, v);
}

console.log('\n# the two INVENTED services must be rejected');
for (const s of ['Περιποίηση γενειάδας', 'Περιποίηση μουστακιού']) {
  const v = checkGrounding(s, SITE);
  t(`rejected: ${s} (coverage ${v.coverage.toFixed(2)}, missing ${v.missingWords.join('/')})`, !v.grounded, v);
}

console.log('\n# other plausible-but-absent inventions must be rejected');
for (const s of ['Θεραπεία κερατίνης', 'Επέκταση βλεφαρίδων', 'Μασάζ προσώπου', 'Botox']) {
  const v = checkGrounding(s, SITE);
  t(`rejected: ${s}`, !v.grounded, v);
}

console.log('\n# inflected paraphrase must still pass');
t('κουρέματα (plural of κούρεμα)', checkGrounding('κουρέματα', SITE).grounded);
t('βαφές μαλλιών', checkGrounding('βαφές μαλλιών', SITE).grounded);

console.log('\n# review quotes: verbatim vs fabricated');
const REVIEWS = `Είχα ακριβώς την ίδια εμπειρία με αυτό που περιγράφεται σε άλλο review.
Το κούρεμα είναι απαράδεκτο, ότι χειρότερο μου έχουν κάνει ποτέ.
Εξαιρετικό κομμωτήριο, ο Θωμάς είναι πολύ επαγγελματίας και το αποτέλεσμα ήταν τέλειο.`;
t('verbatim quote passes', checkQuoteGrounding('Εξαιρετικό κομμωτήριο, ο Θωμάς είναι πολύ επαγγελματίας', REVIEWS).grounded);
t('fabricated praise rejected', !checkQuoteGrounding('Ο καλύτερος κομμωτής στην Ελλάδα, πάντα με εξυπηρετούν άψογα και οι τιμές είναι φθηνές', REVIEWS).grounded);

console.log('\n# short-claim anchor must NOT re-admit the inventions');
{
  const CSV = `Google attributes: [children] Καλό για παιδιά: yes; [payments] Πιστωτικές κάρτες: yes; [amenities] Τουαλέτα: yes`;
  t('faithful short paraphrase accepted (anchor)', checkGrounding('Θεωρείται κατάλληλο για παιδιά', CSV).grounded);
  // the anchor must not rescue an invented service in the same short form
  t('short invention still rejected: Περιποίηση γενειάδας', !checkGrounding('Περιποίηση γενειάδας', SITE).grounded);
  t('short invention still rejected: Θεραπεία κερατίνης', !checkGrounding('Θεραπεία κερατίνης', SITE).grounded);
  t('short invention still rejected: Μασάζ προσώπου', !checkGrounding('Μασάζ προσώπου', SITE).grounded);
  t('short invention still rejected: Επέκταση βλεφαρίδων', !checkGrounding('Επέκταση βλεφαρίδων', SITE).grounded);
  // a claim whose ONLY match is a generic word must fail
  t('generic-word-only claim rejected', !checkGrounding('Δωρεάν πάρκινγκ για πελάτες', SITE).grounded);
}

console.log('\n# acronym gloss (real case: Velvet Cosmetic Lounge Instagram bio)');
{
  // verbatim from the captured IG page
  const IG = `Velvet Cosmetic Lounge. Nails • Lashes • PMU • SMP. Glow up with us. 2610434464. PMU BROWS. PMU Lips.`;
  t('gloss split: PMU (Permanent Make-Up)', stripGloss('PMU (Permanent Make-Up)').head === 'PMU'
    && stripGloss('PMU (Permanent Make-Up)').gloss === 'Permanent Make-Up');
  t('no-gloss name untouched', stripGloss('Γυναικείο κούρεμα').head === 'Γυναικείο κούρεμα'
    && stripGloss('Γυναικείο κούρεμα').gloss === null);
  t('head term PMU IS grounded in the bio', checkGrounding('PMU', IG).grounded);
  t('head term SMP IS grounded in the bio', checkGrounding('SMP', IG).grounded);
  // the expansions the model invented must NOT be treated as evidence
  t('gloss "Scalp Micropigmentation" rejected', !checkGrounding('Scalp Micropigmentation', IG).grounded);
  t('real service Nails grounded', checkGrounding('Nails', IG).grounded);
  t('invented service rejected against bio', !checkGrounding('Botox injections', IG).grounded);
}

console.log('\n# framing prefixes (real dropped claims from the run)');
{
  // verbatim-ish rendering of the gosom "about" block for Phos Skin Science
  const ATTRS = `Google attributes ("about"):
  [Παροχές] Τουαλέτα: yes
  [Πληρωμές] Πιστωτικές κάρτες: yes (MasterCard)
  [Πληρωμές] Χρεωστικές κάρτες: yes
  [Πληρωμές] Πληρωμές από κινητά μέσω NFC: yes`;
  t('framing prefix stripped', stripFraming('Google listing attributes: accepts credit cards') === 'accepts credit cards');
  t('non-prefixed claim untouched', stripFraming('Καλό για παιδιά') === 'Καλό για παιδιά');
  // an English restatement of Greek attributes still has no shared stems, so it
  // must remain rejected — the deterministic `amenity` facts already carry this
  t('English restatement of Greek attrs still rejected', !checkGrounding('Google listing attributes: accepts credit cards, debit cards, and NFC mobile pay', ATTRS).grounded);
  // but the same claim against ENGLISH evidence must pass once framing is gone
  const EN = `Payments: credit cards accepted, debit cards accepted, NFC mobile payments accepted.`;
  t('claim grounded in English evidence after stripping framing', checkGrounding('Google listing attributes: accepts credit cards, debit cards, and NFC mobile pay', EN).grounded);
}

console.log('\n# bilingual gloss (real: BOEL / Phos)');
{
  const EVID = `Υπηρεσίες: Σώμα, Πρόσωπο, Περιποίηση Άκρων, Αποτρίχωση με λέιζερ`;
  for (const [full, head] of [['Σώμα (Body treatments)', 'Σώμα'], ['Περιποίηση Άκρων (Nail/foot care)', 'Περιποίηση Άκρων'], ['Αποτρίχωση με λέιζερ (Laser hair removal)', 'Αποτρίχωση με λέιζερ']]) {
    t(`gloss head extracted: ${full}`, stripGloss(full).head === head);
    t(`head grounded: ${head}`, checkGrounding(head, EVID).grounded);
  }
  t('invented Greek service still rejected', !checkGrounding('Μεσοθεραπεία', EVID).grounded);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
