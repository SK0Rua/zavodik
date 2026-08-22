/**
 * The hero video BRIEF — the prompt Roman pastes into whatever generation tool
 * he likes (SPEC §2.5 as amended 2026-08-22).
 *
 * Every live bridge to Google Flow needs an authenticated Chrome outside a
 * datacenter, and Roman keeps nothing on the mac — so the wow-video path is
 * human-in-the-loop by design: the factory writes the prompt and names the
 * start frame, Roman generates and uploads, the next build picks the clip up.
 *
 * In ENGLISH on purpose: it is input for video-generation models, and they are
 * trained on English direction. The constraints mirror the evidence rule the
 * generated Ken Burns clip lives under: animate the REAL photo, invent nothing.
 */
export function buildHeroVideoPrompt(input: {
  name: string;
  category: string | null;
  city: string | null;
  /** Measured brand mood words, when brand.mood evidence exists. */
  moodWords: string[];
  /** Workspace file name of the start-frame photo, for the human reading this. */
  heroFile: string | null;
}): string {
  const subject = [input.category, input.city ? `in ${input.city}` : null]
    .filter(Boolean).join(' ') || 'local business';
  const mood = input.moodWords.length ? input.moodWords.join(', ') : 'calm, warm, premium';

  return [
    `Image-to-video, 8 seconds, landscape 16:9, loopable.`,
    `Start frame: the attached real photograph of ${input.name} (${subject}).`,
    `Motion: one very slow cinematic camera push-in with gentle, natural light drift. Nothing else moves.`,
    `Keep every object, person, sign and text EXACTLY as in the photo — do not add, remove, replace or morph anything.`,
    `Natural photographic colour and grain. No filters, no effects, no captions, no logos, no people entering the frame.`,
    `Mood: ${mood}.`,
  ].join('\n');
}
