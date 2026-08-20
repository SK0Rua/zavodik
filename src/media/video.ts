/**
 * Hero-clip adapter — FlowKit (Google Flow / Veo via the Chrome bridge).
 *
 * SPEC §2.5 / decision #12: video is generated on Roman's Google AI
 * subscription through the FlowKit fork (Bl0ck154/flowkit, branch
 * `feature/omni-flash` — the `omni-flash` name in the spec resolves to
 * `feature/omni-flash`, which is identical to `main` at be2bc96). No
 * pay-per-use video API.
 *
 * Live path — the FlowKit python agent's FastAPI on :8100 (agent/config.py:
 * API_PORT=8100, routers mounted under `/api`, agent/main.py:125-135):
 *   GET  /health                  → { status, extension_connected }        (agent/main.py:169)
 *   GET  /api/flow/status         → { connected, flow_key_present }        (agent/api/flow.py:98)
 *   POST /api/projects            → Flow-backed project, id = Flow projectId (agent/api/projects.py:132)
 *   POST /api/flow/upload-image   → { media_id, raw }                      (agent/api/flow.py:344)
 *   POST /api/flow/generate-video → Veo operations | Omni flowkitPolling   (agent/api/flow.py:132)
 *   POST /api/flow/check-status   → Veo operation array | Omni workflow env (agent/api/flow.py:245)
 *
 * Because the bridge needs a live Chrome with a logged-in Flow tab (not
 * present on the factory host), `FLOWKIT_MODE=mock` produces a deterministic
 * Ken Burns mp4 from the SAME real business photo via ffmpeg, and
 * `fallbackHeroMedia()` returns a CSS/GSAP Ken Burns config the builder can
 * apply with no video file at all.
 *
 * Evidence rule: `imagePath` must be a REAL business photo (an asset collected
 * as evidence). The clip animates that photo; it never invents a scene. The
 * result is still `ai_generated` + `private_demo_only`.
 */
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export type FlowkitMode = 'auto' | 'live' | 'mock';
export type HeroClipSource = 'flowkit' | 'ken_burns_mock';

export interface GenerateHeroClipOptions {
  /** Absolute path to a REAL business photo (evidence asset). Required. */
  imagePath: string;
  /** Motion description, e.g. "slow push-in, warm light, calm salon interior". */
  prompt: string;
  /** Clip length. Veo is fixed at 8s; Omni accepts 4/6/8/10. Mock honours it exactly. */
  durationSec?: number;
  /** Directory for the produced mp4. Created if missing. */
  outDir: string;
  fileName?: string;
  /** Overrides config.media.flowkit.mode for this call. */
  mode?: FlowkitMode;
  /** Reuse an existing Flow project instead of creating one. */
  projectId?: string;
}

export interface HeroClip {
  filePath: string;
  bytes: number;
  contentType: 'video/mp4';
  durationSec: number;
  source: HeroClipSource;
  /** Model behind the clip; null for the ffmpeg mock. */
  model: 'veo' | 'omni_flash' | null;
  prompt: string;
  /** The real business photo the clip was derived from. */
  sourceImagePath: string;
  /** Flow media id of the produced video (live only). */
  mediaId: string | null;
  projectId: string | null;
  durationMs: number;
  /** Always true — the motion is synthesised. */
  aiGenerated: true;
}

export class FlowkitError extends Error {
  readonly reason:
    | 'unavailable'
    | 'extension_disconnected'
    | 'http_error'
    | 'job_failed'
    | 'timeout'
    | 'no_output'
    | 'ffmpeg_missing'
    | 'bad_input';

  constructor(reason: FlowkitError['reason'], message: string) {
    super(message);
    this.name = 'FlowkitError';
    this.reason = reason;
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function apiUrl(pathname: string): string {
  return `${config.media.flowkit.url}${pathname}`;
}

async function flowkitFetch<T>(
  pathname: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? config.media.flowkit.requestTimeoutMs;
  let res: Response;
  try {
    res = await fetch(apiUrl(pathname), {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new FlowkitError('unavailable', `FlowKit ${pathname} unreachable at ${config.media.flowkit.url}: ${String(err).slice(0, 200)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // FastAPI raises 503 "Extension not connected" when Chrome/Flow is down.
    const reason = res.status === 503 ? 'extension_disconnected' : 'http_error';
    throw new FlowkitError(reason, `FlowKit ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface FlowkitHealth {
  reachable: boolean;
  extensionConnected: boolean;
  flowKeyPresent: boolean;
  url: string;
  detail: string | null;
}

/**
 * Health probe. Never throws — the pipeline decides whether to degrade.
 * Live generation needs BOTH the REST agent and a connected Chrome extension.
 */
export async function flowkitAvailable(): Promise<FlowkitHealth> {
  const base: FlowkitHealth = {
    reachable: false,
    extensionConnected: false,
    flowKeyPresent: false,
    url: config.media.flowkit.url,
    detail: null,
  };
  try {
    const health = await flowkitFetch<{ status?: string; extension_connected?: boolean }>('/health', {
      method: 'GET',
      timeoutMs: config.media.flowkit.healthTimeoutMs,
    });
    base.reachable = true;
    base.extensionConnected = health.extension_connected === true;
  } catch (err) {
    base.detail = err instanceof Error ? err.message : String(err);
    return base;
  }
  try {
    const flow = await flowkitFetch<{ connected?: boolean; flow_key_present?: boolean }>('/api/flow/status', {
      method: 'GET',
      timeoutMs: config.media.flowkit.healthTimeoutMs,
    });
    base.extensionConnected = flow.connected === true;
    base.flowKeyPresent = flow.flow_key_present === true;
  } catch (err) {
    base.detail = err instanceof Error ? err.message : String(err);
  }
  if (!base.extensionConnected) {
    base.detail ??= 'REST agent is up but the Chrome extension is not connected (no logged-in Flow tab)';
  }
  return base;
}

// ─── Live path ────────────────────────────────────────────────────────────────

interface OmniWorkflow { name?: string; primary_media_id?: string; project_id?: string; [k: string]: unknown }

interface SubmitResult {
  operations: unknown[] | null;
  workflows: OmniWorkflow[] | null;
  projectId: string;
}

/** Flow media urls are signed; download promptly after the job completes. */
async function downloadTo(url: string, filePath: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(config.media.flowkit.requestTimeoutMs) });
  if (!res.ok) throw new FlowkitError('http_error', `download ${res.status} for produced clip`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new FlowkitError('no_output', 'produced clip is empty');
  await writeFile(filePath, buf);
  return buf.length;
}

async function ensureProject(explicit: string | undefined): Promise<string> {
  const configured = explicit || config.media.flowkit.projectId;
  if (configured) return configured;
  // POST /api/projects creates the project on Google Flow and returns the Flow projectId as `id`.
  const project = await flowkitFetch<{ id?: string }>('/api/projects', {
    method: 'POST',
    body: {
      name: `websites-factory-${new Date().toISOString().slice(0, 10)}`,
      description: 'Hero clips for private demo sites (websites-factory)',
      material: 'realistic',
      tool_name: 'PINHOLE',
    },
  });
  if (!project.id) throw new FlowkitError('http_error', 'FlowKit /api/projects returned no project id');
  return project.id;
}

function extractOperations(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  const ops = rec.operations;
  return Array.isArray(ops) && ops.length > 0 ? ops : null;
}

function extractWorkflows(payload: unknown): OmniWorkflow[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const polling = (payload as Record<string, unknown>).flowkitPolling;
  if (!polling || typeof polling !== 'object') return null;
  const wf = (polling as Record<string, unknown>).workflows;
  return Array.isArray(wf) && wf.length > 0 ? (wf as OmniWorkflow[]) : null;
}

/** Pull a playable video url out of either polling shape. */
function extractVideoUrl(payload: unknown): { url: string | null; mediaId: string | null; done: boolean; failed: boolean } {
  const out = { url: null as string | null, mediaId: null as string | null, done: false, failed: false };
  if (!payload || typeof payload !== 'object') return out;
  const rec = payload as Record<string, unknown>;

  // Omni envelope: { done, status, workflows: [{ done, status, media: { url, media_id } }] }
  const workflows = rec.workflows;
  if (Array.isArray(workflows)) {
    const statuses = workflows.map((w) => (w ?? {}) as Record<string, unknown>);
    out.failed = statuses.some((w) => w.status === 'FAILED');
    out.done = rec.done === true || statuses.every((w) => w.done === true);
    for (const w of statuses) {
      const media = w.media as Record<string, unknown> | undefined;
      if (media && typeof media.url === 'string' && media.url) {
        out.url = media.url;
        out.mediaId = typeof media.media_id === 'string' ? media.media_id : null;
        break;
      }
    }
    return out;
  }

  // Veo: array of operation entries, each { status, operation: { metadata: { video: { fifeUrl } } } }.
  const list = Array.isArray(rec.operations) ? rec.operations : Array.isArray(payload) ? payload : null;
  if (list) {
    const entries = list.map((o) => (o ?? {}) as Record<string, unknown>);
    out.failed = entries.some((o) => String(o.status ?? '').endsWith('FAILED'));
    out.done = entries.length > 0 && entries.every(
      (o) => String(o.status ?? '').endsWith('SUCCESSFUL') || String(o.status ?? '').endsWith('FAILED'),
    );
    for (const entry of entries) {
      const operation = entry.operation as Record<string, unknown> | undefined;
      const metadata = operation?.metadata as Record<string, unknown> | undefined;
      const video = metadata?.video as Record<string, unknown> | undefined;
      const url = video?.fifeUrl ?? video?.servingBaseUri ?? video?.url;
      if (typeof url === 'string' && url) {
        out.url = url;
        const mediaId = video?.mediaId ?? metadata?.primaryMediaId;
        out.mediaId = typeof mediaId === 'string' ? mediaId : null;
        break;
      }
    }
  }
  return out;
}

async function generateLive(opts: GenerateHeroClipOptions, durationSec: number, outFile: string): Promise<HeroClip> {
  const startedAt = Date.now();
  const fk = config.media.flowkit;
  const projectId = await ensureProject(opts.projectId);

  // 1. Upload the REAL business photo; Flow returns a media id to condition on.
  const upload = await flowkitFetch<{ media_id?: string }>('/api/flow/upload-image', {
    method: 'POST',
    body: {
      file_path: path.resolve(opts.imagePath),
      project_id: projectId,
      file_name: path.basename(opts.imagePath),
    },
  });
  if (!upload.media_id) throw new FlowkitError('no_output', 'FlowKit upload-image returned no media_id');

  // 2. Submit image-to-video (start-frame conditioned on the real photo).
  const submitted = await flowkitFetch<Record<string, unknown>>('/api/flow/generate-video', {
    method: 'POST',
    body: {
      start_image_media_id: upload.media_id,
      prompt: opts.prompt,
      project_id: projectId,
      scene_id: '',
      aspect_ratio: fk.aspectRatio,
      model_family: fk.modelFamily,
      duration_s: durationSec,
    },
  });

  const submit: SubmitResult = {
    operations: extractOperations(submitted),
    workflows: extractWorkflows(submitted),
    projectId,
  };
  if (!submit.operations && !submit.workflows) {
    // Some submits complete inline; check before declaring failure.
    const inline = extractVideoUrl(submitted);
    if (inline.url) {
      const bytes = await downloadTo(inline.url, outFile);
      return {
        filePath: outFile, bytes, contentType: 'video/mp4', durationSec,
        source: 'flowkit', model: fk.modelFamily, prompt: opts.prompt,
        sourceImagePath: path.resolve(opts.imagePath), mediaId: inline.mediaId,
        projectId, durationMs: Date.now() - startedAt, aiGenerated: true,
      };
    }
    throw new FlowkitError('no_output', `FlowKit generate-video returned neither operations nor flowkitPolling.workflows: ${JSON.stringify(submitted).slice(0, 300)}`);
  }

  // 3. Poll until done. Omni polls workflows, Veo polls operations.
  const deadline = Date.now() + fk.jobTimeoutMs;
  let last: ReturnType<typeof extractVideoUrl> | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, fk.pollIntervalMs));
    const status = await flowkitFetch<Record<string, unknown>>('/api/flow/check-status', {
      method: 'POST',
      body: submit.workflows
        ? { workflows: submit.workflows, project_id: projectId }
        : { operations: submit.operations, project_id: projectId },
    });
    last = extractVideoUrl(status);
    if (last.failed && !last.url) throw new FlowkitError('job_failed', 'FlowKit reported the video generation FAILED');
    if (last.url) break;
    if (last.done && !last.url) {
      throw new FlowkitError('no_output', 'FlowKit job finished without a downloadable video url');
    }
  }
  if (!last?.url) {
    throw new FlowkitError('timeout', `FlowKit job did not finish within ${Math.round(fk.jobTimeoutMs / 1000)}s`);
  }

  const bytes = await downloadTo(last.url, outFile);
  const durationMs = Date.now() - startedAt;
  log.info('flowkit hero clip', { filePath: outFile, bytes, durationMs, model: fk.modelFamily });

  return {
    filePath: outFile, bytes, contentType: 'video/mp4', durationSec,
    source: 'flowkit', model: fk.modelFamily, prompt: opts.prompt,
    sourceImagePath: path.resolve(opts.imagePath), mediaId: last.mediaId,
    projectId, durationMs, aiGenerated: true,
  };
}

/**
 * Response-shape parsers, exposed for scripts/verify-media-parsers.ts. The
 * Chrome bridge cannot run on the factory host, so these are covered by
 * replaying the shapes documented in the FlowKit source rather than live calls.
 */
export const __testing = { extractVideoUrl, extractOperations, extractWorkflows };

// ─── Mock path: deterministic Ken Burns via ffmpeg ────────────────────────────

function runFfmpeg(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.media.ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr, timedOut }); });
  });
}

/** True when the configured ffmpeg binary can be executed. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    const res = await runFfmpeg(['-version'], 10_000);
    return res.code === 0;
  } catch {
    return false;
  }
}

/**
 * Deterministic offline stand-in for a FlowKit clip: a slow Ken Burns push-in
 * over the real photo. Same inputs => same output, so the pipeline is testable
 * without Chrome. Returns null (never throws) when ffmpeg is missing.
 */
export async function kenBurnsClip(opts: {
  imagePath: string;
  outFile: string;
  durationSec: number;
  fps?: number;
  width?: number;
  height?: number;
}): Promise<{ filePath: string; bytes: number } | null> {
  const fps = opts.fps ?? 25;
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const frames = Math.max(1, Math.round(opts.durationSec * fps));

  // zoompan works on a supersampled frame to avoid the well-known pixel jitter,
  // then scales back down to the target size.
  const zoomTo = 1.18;
  const filter = [
    `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
    `crop=${width * 2}:${height * 2}`,
    `zoompan=z='min(1+(${(zoomTo - 1).toFixed(4)}*on/${frames}),${zoomTo})'`
      + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
      + `:d=1:s=${width}x${height}:fps=${fps}`,
    'format=yuv420p',
  ].join(',');

  const args = [
    '-y', '-loop', '1', '-i', path.resolve(opts.imagePath),
    '-vf', filter,
    '-t', String(opts.durationSec),
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-movflags', '+faststart',
    '-an',
    opts.outFile,
  ];

  let res: Awaited<ReturnType<typeof runFfmpeg>>;
  try {
    res = await runFfmpeg(args, 5 * 60_000);
  } catch (err) {
    log.warn('ken burns mock: ffmpeg not runnable', { err: String(err).slice(0, 200) });
    return null;
  }
  if (res.timedOut || res.code !== 0) {
    log.warn('ken burns mock: ffmpeg failed', { code: res.code, stderr: res.stderr.slice(-300) });
    return null;
  }
  const st = await stat(opts.outFile).catch(() => null);
  if (!st || st.size === 0) return null;
  return { filePath: opts.outFile, bytes: st.size };
}

export interface KenBurnsFallback {
  kind: 'ken_burns';
  /** The real business photo to animate — no video file, no network. */
  imagePath: string | null;
  durationSec: number;
  /** CSS/GSAP-friendly transform hints; the builder applies these to a real photo. */
  transform: { fromScale: number; toScale: number; fromX: string; toX: string; easing: string };
  /** Honour prefers-reduced-motion (SPEC §2.4): render the still frame instead. */
  respectReducedMotion: true;
  reason: string;
}

/**
 * Fallback hero treatment when FlowKit is unavailable (SPEC §2.5: "сток +
 * Ken Burns/паралакс реальних фото"). Pure config — the builder animates a
 * REAL photo in CSS/GSAP, so no external network and no AI media at all.
 * Because nothing is synthesised, the result is not `ai_generated`.
 */
export function fallbackHeroMedia(opts: { imagePath?: string; durationSec?: number; reason?: string } = {}): KenBurnsFallback {
  return {
    kind: 'ken_burns',
    imagePath: opts.imagePath ? path.resolve(opts.imagePath) : null,
    durationSec: opts.durationSec ?? config.media.flowkit.durationSeconds,
    transform: { fromScale: 1.0, toScale: 1.12, fromX: '0%', toX: '-2%', easing: 'power1.inOut' },
    respectReducedMotion: true,
    reason: opts.reason ?? 'FlowKit unavailable; animating a real photo instead of generating video',
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Produce a hero clip from a REAL business photo.
 *
 * mode=live  → FlowKit only; throws {@link FlowkitError} if the bridge is down.
 * mode=mock  → ffmpeg Ken Burns only; never touches the network.
 * mode=auto  → FlowKit when healthy, else the Ken Burns mock; null if ffmpeg is
 *              also missing, in which case callers use {@link fallbackHeroMedia}.
 */
export async function generateHeroClip(opts: GenerateHeroClipOptions): Promise<HeroClip | null> {
  const mode = opts.mode ?? config.media.flowkit.mode;
  const durationSec = opts.durationSec ?? config.media.flowkit.durationSeconds;

  const imageStat = await stat(opts.imagePath).catch(() => null);
  if (!imageStat?.isFile()) {
    throw new FlowkitError('bad_input', `generateHeroClip: image not found: ${opts.imagePath}`);
  }

  await mkdir(opts.outDir, { recursive: true });
  const base = opts.fileName ?? `hero-${Date.now()}`;
  const outFile = path.join(opts.outDir, `${base}.mp4`);

  if (mode === 'live') return generateLive(opts, durationSec, outFile);

  if (mode === 'auto') {
    const health = await flowkitAvailable();
    if (health.reachable && health.extensionConnected) {
      try {
        return await generateLive(opts, durationSec, outFile);
      } catch (err) {
        log.warn('flowkit live failed, falling back to ken burns mock', {
          err: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        });
      }
    } else {
      log.info('flowkit unavailable, using ken burns mock', { detail: health.detail });
    }
  }

  const startedAt = Date.now();
  const mock = await kenBurnsClip({ imagePath: opts.imagePath, outFile, durationSec });
  if (!mock) {
    log.warn('ken burns mock unavailable (no ffmpeg); caller should use fallbackHeroMedia()', {
      ffmpegBin: config.media.ffmpegBin,
    });
    return null;
  }

  return {
    filePath: mock.filePath,
    bytes: mock.bytes,
    contentType: 'video/mp4',
    durationSec,
    source: 'ken_burns_mock',
    model: null,
    prompt: opts.prompt,
    sourceImagePath: path.resolve(opts.imagePath),
    mediaId: null,
    projectId: null,
    durationMs: Date.now() - startedAt,
    aiGenerated: true,
  };
}
