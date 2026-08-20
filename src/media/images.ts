/**
 * Image generation adapter — the `gen-image` skill executed programmatically.
 *
 * SPEC §2.5 / decision #13: images come from the Codex CLI (gpt-image-2) on
 * Roman's ChatGPT subscription. No OPENAI_API_KEY, no pay-per-token image API.
 *
 * The skill (`skills/gen-image/SKILL.md`) is a prompt for an interactive agent;
 * this module performs the same steps deterministically:
 *   1. wrap the prompt in the HARD CONSTRAINT prefix (without it Codex "draws"
 *      with Python/PIL/matplotlib/SVG instead of calling image_gen);
 *   2. `codex exec --full-auto --sandbox workspace-write [--image <ref>]`;
 *   3. collect the newest file under ~/.codex/generated_images/ that appeared
 *      after the run started, and copy it into `outDir`;
 *   4. refuse the result when the transcript shows code-based drawing.
 *
 * Evidence rule (CLAUDE.md invariant): everything produced here is decorative.
 * It is `ai_generated` and must never be presented as a real photo of the
 * business — `registerGeneratedAsset()` in ./assets.ts enforces the flags.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

/** Verbatim from skills/gen-image/SKILL.md — do not soften, Codex regresses to PIL/SVG without it. */
const HARD_CONSTRAINT_PREFIX =
  'HARD CONSTRAINT: Use ONLY image_gen/gpt-image-2.\n' +
  'NO Python, PIL, matplotlib, SVG, ASCII art, or any code-based drawing.\n' +
  'If image_gen tool is unavailable — FAIL explicitly with an error message.\n\n' +
  'TASK: ';

/** Markers that Codex fell back to code-based drawing instead of image_gen (skill step 5). */
const DRAWING_FALLBACK_PATTERNS = [
  /\bfrom PIL\b/i,
  /\bimport PIL\b/i,
  /\bmatplotlib\b/i,
  /\bImageDraw\b/i,
  /<svg[\s>]/i,
  /\bcairo(svg)?\b/i,
];

/** Codex CLI messages that mean "no image tool in this session" rather than a bad prompt. */
const IMAGE_TOOL_UNAVAILABLE_PATTERNS = [
  /image_gen[^\n]{0,60}(unavailable|not available|not enabled|disabled|no access)/i,
  /(unavailable|not available|not enabled|no access)[^\n]{0,60}image_gen/i,
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export type ImageSize = 'square' | 'portrait' | 'landscape';

export interface GenerateImageOptions {
  /** What to depict. Decorative only: backgrounds, textures, patterns, og-images. */
  prompt: string;
  /** Optional reference image passed to Codex as `--image` (skill's `--ref`). */
  refPath?: string;
  /** Orientation hint appended to the prompt; gpt-image-2 has no size flag in the CLI. */
  size?: ImageSize;
  /** Directory the produced file is copied into. Created if missing. */
  outDir: string;
  /** Basename (without extension) for the copy. Default: `ai-<timestamp>`. */
  fileName?: string;
  timeoutMs?: number;
}

export interface GeneratedImage {
  /** Absolute path of the copy inside `outDir`. */
  filePath: string;
  /** Absolute path of the original under ~/.codex/generated_images/. */
  sourcePath: string;
  bytes: number;
  contentType: string;
  /** The full prompt actually sent, including the hard-constraint prefix. */
  prompt: string;
  refPath: string | null;
  size: ImageSize;
  model: 'gpt-image-2';
  provider: 'codex-cli';
  durationMs: number;
  /** Always true — everything from this module is AI-generated. */
  aiGenerated: true;
}

/** Raised when Codex could not produce an image; carries a machine-usable reason. */
export class ImageGenerationError extends Error {
  readonly reason:
    | 'codex_missing'
    | 'image_tool_unavailable'
    | 'drawing_fallback'
    | 'no_output'
    | 'timeout'
    | 'exec_failed';

  constructor(reason: ImageGenerationError['reason'], message: string) {
    super(message);
    this.name = 'ImageGenerationError';
    this.reason = reason;
  }
}

const SIZE_HINTS: Record<ImageSize, string> = {
  square: 'Square 1:1 composition.',
  portrait: 'Portrait 2:3 vertical composition.',
  landscape: 'Wide 16:9 horizontal composition.',
};

function generatedImagesRoot(): string {
  const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), '.codex');
  return path.join(codexHome, 'generated_images');
}

interface ExecResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function runCodex(args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      // Subscription only (CLAUDE.md invariant): never leak a pay-per-token key.
      if (k === 'OPENAI_API_KEY' || k === 'ANTHROPIC_API_KEY') continue;
      env[k] = v;
    }
    const child = spawn(config.media.codexBin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

interface FoundImage { filePath: string; mtimeMs: number; bytes: number }

/** Newest image file under ~/.codex/generated_images (recursive: Codex nests per-session dirs). */
async function findNewestImage(root: string, notBeforeMs: number): Promise<FoundImage | null> {
  let best: FoundImage | null = null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      // 2s slack: the file is written slightly before we sample the clock.
      if (st.mtimeMs < notBeforeMs - 2000) continue;
      if (!best || st.mtimeMs > best.mtimeMs) {
        best = { filePath: full, mtimeMs: st.mtimeMs, bytes: st.size };
      }
    }
  }

  await walk(root, 0);
  return best;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Generate one decorative image through the Codex CLI (gpt-image-2, ChatGPT subscription).
 *
 * Throws {@link ImageGenerationError} — callers decide whether a missing decorative
 * image degrades the build or blocks it (it should degrade: SPEC §2.5 treats
 * generated imagery as ornament, never as evidence).
 */
export async function generateImage(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const size = opts.size ?? 'landscape';
  const timeoutMs = opts.timeoutMs ?? config.media.imageTimeoutMs;
  const startedAt = Date.now();

  if (!opts.prompt.trim()) throw new ImageGenerationError('exec_failed', 'generateImage: empty prompt');

  const fullPrompt = `${HARD_CONSTRAINT_PREFIX}${opts.prompt.trim()} ${SIZE_HINTS[size]}`;
  const root = generatedImagesRoot();
  await mkdir(opts.outDir, { recursive: true });

  // Baseline: only files created after this point count as ours.
  const before = await findNewestImage(root, 0);
  const notBeforeMs = Math.max(startedAt, (before?.mtimeMs ?? 0) + 1);

  // NOTE: SKILL.md documents `--full-auto`; that flag was removed in the Codex
  // CLI (verified on 0.147.0: "unexpected argument '--full-auto'"). The sandbox
  // policy it used to imply is set explicitly instead.
  const args = [
    'exec',
    '--sandbox', 'workspace-write',
    '--skip-git-repo-check',
    ...(opts.refPath ? ['--image', path.resolve(opts.refPath)] : []),
    fullPrompt,
  ];

  let res: ExecResult;
  try {
    res = await runCodex(args, opts.outDir, timeoutMs);
  } catch (err) {
    const msg = String((err as NodeJS.ErrnoException)?.code === 'ENOENT'
      ? `codex CLI not found (CODEX_BIN=${config.media.codexBin}); run \`codex login\` on this machine`
      : String(err));
    throw new ImageGenerationError(
      (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'codex_missing' : 'exec_failed',
      `gen-image: ${msg}`,
    );
  }

  const transcript = `${res.stdout}\n${res.stderr}`;
  if (res.timedOut) {
    throw new ImageGenerationError('timeout', `gen-image timed out after ${Math.round(timeoutMs / 1000)}s`);
  }

  // The produced FILE is the ground truth, checked before any transcript
  // heuristic. Codex echoes its own imagegen skill doc into the transcript, and
  // that doc discusses both PIL/SVG and "image_gen unavailable" — matching those
  // words against a successful run would reject a perfectly good image.
  const produced = await findNewestImage(root, notBeforeMs);

  if (!produced) {
    if (IMAGE_TOOL_UNAVAILABLE_PATTERNS.some((re) => re.test(transcript))) {
      throw new ImageGenerationError(
        'image_tool_unavailable',
        `gen-image: Codex reports image_gen is unavailable in this session — check the ChatGPT subscription/tool access. ${transcript.slice(-300)}`,
      );
    }
    // Skill step 5: a "drawn" result is a fake, not a fallback. Refuse it.
    if (DRAWING_FALLBACK_PATTERNS.some((re) => re.test(transcript))) {
      throw new ImageGenerationError(
        'drawing_fallback',
        'gen-image: Codex fell back to code-based drawing (PIL/matplotlib/SVG) instead of image_gen — ' +
        'image_gen is not reachable in this Codex session; not accepting a fake image.',
      );
    }
  }

  if (res.code !== 0 && !produced) {
    throw new ImageGenerationError(
      'exec_failed',
      `gen-image: codex exec exited ${res.code}: ${(res.stderr || res.stdout).slice(-400)}`,
    );
  }
  if (!produced) {
    throw new ImageGenerationError(
      'no_output',
      `gen-image: no new image under ${root} after the run. Codex output: ${transcript.slice(-400)}`,
    );
  }

  const ext = path.extname(produced.filePath).toLowerCase() || '.png';
  const base = opts.fileName ?? `ai-${Date.now()}`;
  const filePath = path.join(opts.outDir, `${base}${ext}`);
  await copyFile(produced.filePath, filePath);

  const durationMs = Date.now() - startedAt;
  log.info('gen-image done', {
    filePath, bytes: produced.bytes, durationMs, size, ref: opts.refPath ?? null,
  });

  return {
    filePath,
    sourcePath: produced.filePath,
    bytes: produced.bytes,
    contentType: contentTypeFor(produced.filePath),
    prompt: fullPrompt,
    refPath: opts.refPath ? path.resolve(opts.refPath) : null,
    size,
    model: 'gpt-image-2',
    provider: 'codex-cli',
    durationMs,
    aiGenerated: true,
  };
}
