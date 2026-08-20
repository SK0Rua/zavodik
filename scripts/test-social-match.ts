/**
 * Unit checks for the social profile matcher (no network, no DB).
 *
 * The cases are drawn from the real Patras data, including the exact false
 * positive the SERPs offer: an Instagram POST by an unrelated salon in another
 * city (`beauty.volos`) surfaced by a search for "exte hair design".
 *
 * Run: pnpm tsx scripts/test-social-match.ts
 */
import {
  scoreProfileMatch, nameSimilarity, distinctiveTokens, translit,
  phoneMentioned, addressStreetTokens, type MatchInput,
} from '../src/enrichment/socialMatch.js';
import { parseProfileUrl, buildQueries } from '../src/enrichment/socialDiscovery.js';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`, extra ?? ''); }
}

const EXTE = {
  name: 'exte hair design',
  city: 'Patras',
  phone: '2610270502',
  address: 'Γούναρη 21-23, Πάτρα 262 21',
  domain: null,
  category: 'Κομμωτήριο',
};

function verdict(business: MatchInput['business'], profile: MatchInput['profile']) {
  return scoreProfileMatch({ business, profile });
}

console.log('# transliteration (Greek -> Latin)');
{
  check('digraph ου -> ou', translit('Γούναρη').startsWith('gou'), translit('Γούναρη'));
  check('μπ -> b', translit('Μπάρμπερ').startsWith('b'), translit('Μπάρμπερ'));
  check('ντ -> d', translit('Ντίνα') === 'dina', translit('Ντίνα'));
  check('diacritics folded', translit('Πάτρα') === translit('ΠΑΤΡΑ'), [translit('Πάτρα'), translit('ΠΑΤΡΑ')]);
  check('final sigma == sigma', translit('Δημησιάνος').endsWith('os'), translit('Δημησιάνος'));
}

console.log('# distinctive tokens (trade words are not identity)');
{
  check('"exte" is the identity of "exte hair design"',
    distinctiveTokens('exte hair design').join(',') === 'exte', distinctiveTokens('exte hair design'));
  check('a name of only trade words has no distinctive token',
    distinctiveTokens('Hair Salon').length === 0, distinctiveTokens('Hair Salon'));
  check('city name is not distinctive',
    !distinctiveTokens('Laser Beauty Patras').includes('patras'), distinctiveTokens('Laser Beauty Patras'));
  check('Greek trade words dropped after transliteration',
    !distinctiveTokens('Κομμωτήριο Δημησιάνος').includes('kommotirio'), distinctiveTokens('Κομμωτήριο Δημησιάνος'));
}

console.log('# name similarity');
{
  check('handle concatenation matches (extehairdesign)',
    nameSimilarity('exte hair design', 'Exte Hair Design', 'extehairdesign') === 1);
  check('Greek listing name vs Latin handle',
    nameSimilarity('Κομμωτήριο Δημησιάνος', 'Dimisianos Coiffures', 'dimisianoscoiffures') >= 0.5,
    nameSimilarity('Κομμωτήριο Δημησιάνος', 'Dimisianos Coiffures', 'dimisianoscoiffures'));
  check('unrelated salon scores 0',
    nameSimilarity('exte hair design', 'Beauty Volos', 'beauty.volos') === 0);
  check('generic-only name cannot match anything',
    nameSimilarity('Hair Salon', 'Hair Salon Athens', 'hairsalonathens') === 0);
  check('short token does not match inside a longer word',
    nameSimilarity('AE Studio', 'Michael Beauty', 'michaelbeauty') === 0,
    nameSimilarity('AE Studio', 'Michael Beauty', 'michaelbeauty'));
}

console.log('# phone / address helpers');
{
  check('phone found despite spacing and prefix',
    phoneMentioned('2610270502', 'bio: 21-23 gounari str / tel 2610 270 502'));
  check('phone found with +30 country code',
    phoneMentioned('2610270502', 'Call +30 261 027 0502'));
  check('different phone rejected', !phoneMentioned('2610270502', 'tel 2610999999'));
  check('too-short phone never matches', !phoneMentioned('2610', 'anything 2610'));
  check('street token extracted from Greek address',
    addressStreetTokens('Γούναρη 21-23, Πάτρα 262 21').includes('gounari'),
    addressStreetTokens('Γούναρη 21-23, Πάτρα 262 21'));
  check('house number is not a street token',
    !addressStreetTokens('Γούναρη 21-23, Πάτρα').includes('21'));
}

console.log('# STRONG: the real exte hair design Instagram profile');
{
  const v = verdict(EXTE, {
    platform: 'instagram',
    handle: 'extehairdesign',
    title: 'Exte Hair Design (@extehairdesign) • Φωτογραφίες και βίντεο στο Instagram',
    bio: '297 ακόλουθοι - Exte Hair Design (@extehairdesign) στο Instagram: "21-23 gounari str / tel 2610270502"',
    text: 'extehairdesign Exte Hair Design 21-23 gounari str / tel 2610270502',
  });
  check('strength = strong', v.strength === 'strong', v);
  check('phone signal recorded', v.signals.some((s) => s.includes('phone')), v.signals);
  check('corroborated flag set', v.corroborated);
}

console.log('# STRONG: the real exte hair design Facebook page');
{
  const v = verdict(EXTE, {
    platform: 'facebook',
    handle: 'exte hair design',
    title: 'Exte Hair Design | Patras | Facebook',
    bio: 'Exte Hair Design, Πάτρα. Αρέσει σε 1.856 · Αφεθείτε στο μαγικό κόσμο του κομμωτηρίου μας',
    text: 'Exte Hair Design Σελίδα · Κομμωτήριο Γούναρη 21-23, Patras, Greece 261 027 0502 andymr76@gmail.com',
  });
  check('strength = strong', v.strength === 'strong', v);
  check('address+city signal recorded',
    v.signals.some((s) => s.includes('address street')), v.signals);
}

console.log('# REJECT: an Instagram post by an unrelated salon in another city');
{
  // This is the exact page a real SERP returned for "exte hair design patras instagram".
  const v = verdict(EXTE, {
    platform: 'instagram',
    handle: 'beauty.volos',
    title: 'Vicky Makri στο Instagram',
    bio: '104 likes, 0 comments - beauty.volos: "Μυρτώ είναι ένα πολύ χαρούμενο κορίτσι..."',
    text: 'beauty.volos hairtransformation tape hairextension hair hairinspo',
  });
  check('unrelated account is weak', v.strength === 'weak', v);
  check('no contact would be written', v.strength === 'weak');
}

console.log('# REJECT: same name, different city (the classic false positive)');
{
  const v = verdict(EXTE, {
    platform: 'instagram',
    handle: 'extehairdesign_athens',
    title: 'Exte Hair Design Athens (@extehairdesign_athens)',
    bio: 'Exte Hair Design — Αθήνα, Κολωνάκι. tel 2103334444',
    text: 'Exte Hair Design Athens Κολωνάκι Αθήνα 2103334444 κομμωτήριο',
  });
  check('name matches but city/phone do not => not strong', v.strength !== 'strong', v);
  check('blocker names the missing corroborator',
    v.blockers.some((b) => b.includes('corroborator') || b.includes('city')), v.blockers);
}

console.log('# MEDIUM: right name, no corroborating detail on the page');
{
  const v = verdict(EXTE, {
    platform: 'instagram',
    handle: 'andreasextehd',
    title: 'Andreas Exte H D (@andreasextehd) • Instagram',
    bio: '1,118 ακόλουθοι - Αυτό το προφίλ είναι ιδιωτικό',
    text: 'andreasextehd Andreas Exte H D Αυτό το προφίλ είναι ιδιωτικό',
  });
  check('private profile with a name hit is never strong', v.strength !== 'strong', v);
  check('blockers explain why', v.blockers.length > 0, v.blockers);
}

console.log('# name alone can never reach strong (weighting invariant)');
{
  const v = verdict(EXTE, {
    platform: 'instagram',
    handle: 'extehairdesign',
    title: 'Exte Hair Design (@extehairdesign)',
    bio: '',
    text: 'Exte Hair Design',
  });
  check('perfect name, zero corroboration => not strong', v.strength !== 'strong', v);
  check('name similarity is 1.0 nonetheless', v.nameSimilarity === 1, v.nameSimilarity);
}

console.log('# business whose own domain appears in the bio');
{
  const v = verdict(
    { name: 'Specialised Touch', city: 'Patras', phone: null, address: null, domain: 'specialisedtouch.gr', category: null },
    {
      platform: 'instagram',
      handle: 'specialisedtouch',
      title: 'Specialised Touch (@specialisedtouch)',
      bio: 'Patras • specialisedtouch.gr',
      text: 'Specialised Touch Patras specialisedtouch.gr',
    },
  );
  check('domain link is a hard corroborator', v.corroborated, v);
  check('strength = strong', v.strength === 'strong', v);
}

console.log('# generic business name: ONE hard signal is not enough');
{
  const v = verdict(
    { name: 'Hair Salon', city: 'Patras', phone: '2610111222', address: null, domain: null, category: null },
    {
      platform: 'instagram',
      handle: 'somehairsalon',
      title: 'Hair Salon (@somehairsalon)',
      bio: 'Patras hair salon',
      text: 'Hair Salon Patras',
    },
  );
  check('no distinctive tokens and no corroboration => never strong', v.strength !== 'strong', v);
  check('blocker states the reason',
    v.blockers.some((b) => b.includes('distinctive')), v.blockers);
}
{
  // Only the phone corroborates. A single signal stays `medium`: it goes in
  // front of Roman rather than straight into outreach.
  const v = verdict(
    { name: 'Hair Salon', city: 'Patras', phone: '2610111222', address: null, domain: null, category: null },
    {
      platform: 'facebook',
      handle: 'a.hair.salon',
      title: 'Hair Salon | Patras | Facebook',
      bio: 'Hair Salon, Πάτρα. tel 2610 111 222',
      text: 'Hair Salon Πάτρα 2610111222',
    },
  );
  check('one hard signal alone does not verify a generic name', v.strength === 'medium', v);
}

console.log('# generic name + TWO independent hard signals => strong');
{
  // The real "GK Beauty Room" case: name tokens are all generic, but the page
  // carries the listing phone, the street+city AND a link to the own domain.
  const v = verdict(
    {
      name: 'GK Beauty Room', city: 'Patras', phone: '2610623000',
      address: 'Κολοκοτρώνη 12, Πάτρα', domain: 'gkbeautyroom.gr', category: 'Ινστιτούτο αισθητικής',
    },
    {
      platform: 'facebook',
      handle: 'gk beauty room',
      title: 'GK Beauty Room | Patras | Facebook',
      bio: 'GK Beauty Room, Πάτρα. Κολοκοτρώνη 12. tel 2610 623 000 · gkbeautyroom.gr',
      text: 'GK Beauty Room Πάτρα Κολοκοτρώνη 12 2610623000 gkbeautyroom.gr',
    },
  );
  check('identity proven by evidence overrides the name check', v.strength === 'strong', v);
  check('name-similarity blocker is not raised when identity is proven',
    !v.blockers.some((b) => b.includes('name similarity')), v.blockers);
}
{
  // "ᗅ ᗄ Hair Salon": unicode glyphs + trade words, phone + street + city.
  const v = verdict(
    {
      name: 'ᗅ ᗄ Hair Salon', city: 'Patras', phone: '2610279999',
      address: 'Παλαιών Πατρών Γερμανού 20, Πάτρα', domain: null, category: 'Κομμωτήριο',
    },
    {
      platform: 'facebook',
      handle: 'hair salon',
      title: 'ᗅ ᗄ Hair Salon | Patras | Facebook',
      bio: 'ᗅ ᗄ Hair Salon, Πάτρα. Παλαιών Πατρών Γερμανού 20 · 2610 279 999',
      text: 'ᗅ ᗄ Hair Salon Πάτρα Παλαιών Πατρών Γερμανού 20 2610279999 κομμωτήριο',
    },
  );
  check('unnameable business verified by phone + address + city', v.strength === 'strong', v);
}
{
  // The guard must still hold: same city, same trade, WRONG phone and street.
  const v = verdict(
    {
      name: 'GK Beauty Room', city: 'Patras', phone: '2610623000',
      address: 'Κολοκοτρώνη 12, Πάτρα', domain: 'gkbeautyroom.gr', category: 'Ινστιτούτο αισθητικής',
    },
    {
      platform: 'facebook',
      handle: 'another.beauty.room',
      title: 'Another Beauty Room | Patras | Facebook',
      bio: 'Another Beauty Room, Πάτρα. Μαιζώνος 88. tel 2610 700 111',
      text: 'Another Beauty Room Πάτρα Μαιζώνος 88 2610700111',
    },
  );
  check('a different business in the same city is still rejected', v.strength !== 'strong', v);
}

console.log('# URL parsing: profiles vs posts vs platform chrome');
{
  check('IG profile parsed',
    parseProfileUrl('https://www.instagram.com/extehairdesign/')?.handle === 'extehairdesign');
  check('IG post is NOT a profile',
    parseProfileUrl('https://www.instagram.com/p/DbvxZI-MCaK/') === null);
  check('IG reel is NOT a profile',
    parseProfileUrl('https://www.instagram.com/reel/ABC123/') === null);
  check('IG explore/locations is NOT a profile',
    parseProfileUrl('https://www.instagram.com/explore/locations/141120817/exte-hair-design/') === null);
  check('FB /p/ page parsed',
    parseProfileUrl('https://www.facebook.com/p/Exte-Hair-Design-100063552791835/')?.platform === 'facebook',
    parseProfileUrl('https://www.facebook.com/p/Exte-Hair-Design-100063552791835/'));
  check('FB sharer rejected',
    parseProfileUrl('https://www.facebook.com/sharer/sharer.php?u=x') === null);
  check('FB SDK version path rejected',
    parseProfileUrl('https://www.facebook.com/v2.5/plugins/like.php') === null);
  check("search engine's own FB page rejected",
    parseProfileUrl('https://www.facebook.com/startpagesearch/') === null);
  check("Instagram's own account rejected",
    parseProfileUrl('https://www.instagram.com/instagram/') === null);
  check('TikTok profile parsed',
    parseProfileUrl('https://www.tiktok.com/@somesalon')?.handle === 'somesalon');
  check('query string and www stripped',
    parseProfileUrl('https://instagram.com/beautify_patra?igsh=abc')?.url === 'https://www.instagram.com/beautify_patra');
  check('non-social URL ignored',
    parseProfileUrl('https://example.gr/contact') === null);
}

console.log('# queries are built in both alphabets');
{
  const qs = buildQueries({ id: 'x', name: 'exte hair design', city: 'Patras' });
  check('includes a Greek query', qs.some((q) => /Πάτρα/.test(q)), qs);
  check('includes a Latin query', qs.some((q) => /patras/i.test(q)), qs);
  check('includes site: variants', qs.some((q) => q.startsWith('site:instagram.com')), qs);
  check('business name is quoted', qs.every((q) => q.includes('"exte hair design"')), qs);
}

console.log('# long listing names are reduced to a searchable core');
{
  // All three returned zero candidates on the real run when the FULL name was
  // quoted: no profile writes its name as a complete trade description.
  const fs = buildQueries({ id: 'x', name: 'Female Secrets | Κέντρο Υγείας Δέρματος', city: 'Patras' });
  check('splits on the pipe separator', fs.some((q) => q.includes('"Female Secrets"')), fs);
  check('no stray pipe survives into a query', fs.every((q) => !q.includes('|')), fs);

  const eu = buildQueries({ id: 'x', name: 'Eὖ SKIN PETSINI-VOUTSINA COSMETIC AESTHETICIAN - LASER CENTER PATRAS', city: 'Patras' });
  check('splits on the dash', eu.some((q) => q.includes('"Eὖ SKIN PETSINI"')), eu);
  check('no query ends with a dangling separator',
    eu.every((q) => !/[-–—/,]\s*"/.test(q)), eu);

  const io = buildQueries({ id: 'x', name: 'Ινστιτούτο Αισθητικής Ιώ Νικολάου-Γεωργίου Ρένα', city: 'Patras' });
  check('caps a long name at four words', io.some((q) => q.includes('"Ινστιτούτο Αισθητικής Ιώ Νικολάου"')), io);
  check('adds an unquoted fallback query when the name was shortened',
    io.some((q) => !q.includes('"')), io);

  const shortName = buildQueries({ id: 'x', name: 'BOEL', city: 'Patras' });
  check('a short name gets no redundant fallback query',
    shortName.every((q) => q.includes('"')), shortName);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
