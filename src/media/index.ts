/**
 * Media generation — public API (SPEC §2.5, decisions #12/#13).
 *
 * Everything here runs on subscriptions: images via the Codex CLI (gpt-image-2,
 * ChatGPT plan), video via FlowKit → Google Flow/Veo (Google AI plan). No
 * pay-per-token media API is reachable from this module.
 *
 * Usage contract for the builder/assets workers:
 *
 *   const img = await generateImage({ prompt, outDir, size: 'landscape' });
 *   await registerGeneratedAsset(businessId, img.filePath, 'background', {
 *     generator: 'gen-image:gpt-image-2', prompt: img.prompt,
 *   });
 *
 *   const clip = await generateHeroClip({ imagePath: realPhoto, prompt, outDir });
 *   if (clip) {
 *     await registerGeneratedAsset(businessId, clip.filePath, 'hero_clip', {
 *       generator: `flowkit:${clip.model ?? 'ken-burns'}`,
 *       prompt: clip.prompt, sourceImagePath: clip.sourceImagePath,
 *       durationSec: clip.durationSec,
 *     });
 *   } else {
 *     applyKenBurns(fallbackHeroMedia({ imagePath: realPhoto }));  // no video at all
 *   }
 *
 * Two rules the callers must keep:
 *  - generated imagery is DECORATIVE (backgrounds, patterns, textures, og-images);
 *    it never stands in for a real photo of the business, its interior or work;
 *  - hero clips are derived from a REAL evidence photo, never from an invented scene.
 * `registerGeneratedAsset` enforces `ai_generated` + `private_demo_only` on the row.
 */
export {
  generateImage,
  ImageGenerationError,
  type GenerateImageOptions,
  type GeneratedImage,
  type ImageSize,
} from './images.js';

export {
  generateHeroClip,
  flowkitAvailable,
  fallbackHeroMedia,
  kenBurnsClip,
  ffmpegAvailable,
  FlowkitError,
  type GenerateHeroClipOptions,
  type HeroClip,
  type HeroClipSource,
  type FlowkitHealth,
  type FlowkitMode,
  type KenBurnsFallback,
} from './video.js';

export {
  registerGeneratedAsset,
  type GeneratedAssetKind,
  type GeneratedAssetMeta,
  type RegisteredAsset,
} from './assets.js';
