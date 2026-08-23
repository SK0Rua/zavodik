/**
 * Claude Code runtime adapter — the default agent runtime.
 *
 * Authentication is SUBSCRIPTION-ONLY (SPEC §2.3, decision #10):
 *   - server: `claude setup-token` once -> paste the token into the UI's
 *     /settings page (encrypted in Postgres). `config.agents.oauthToken` is a
 *     GETTER, and both entry points below read it inside the call, so a token
 *     pasted while workers are running is picked up on the next agent call —
 *     no restart, no rebuild (Roman's decision 2026-08-17). `.env` still works
 *     as a fallback for a fresh box.
 *   - local dev: nothing to pass, the CLI's own login is used.
 * ANTHROPIC_API_KEY is actively STRIPPED from the child environment so a stray
 * key in the shell can never silently move billing onto the pay-per-token API.
 *
 * Two operations:
 *   structured() — headless, no tools, native `outputFormat: { type: 'json_schema' }`
 *                  (SDK >= 0.3.x) with a prompt+parse fallback. Small turn budget
 *                  (default 2) so a large answer can finish being written.
 *   codeAgent()  — workspace session with tools; the agent writes result.json.
 */
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ZodType } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { zodToJsonSchema, extractJson, jsonOnlyInstruction } from './schema.js';
import { appendBuildLog, summarizeSdkMessage } from '../build/buildLog.js';
import { withAgentSlot } from './semaphore.js';
import { codeAgentEnv, buildPreToolUseGuard } from './sandbox.js';
import {
  AgentSchemaError,
  RateLimitedError,
  type AgentRuntime,
  type AgentUsage,
  type CodeAgentOptions,
  type StructuredOptions,
} from './types.js';

const DEFAULT_STRUCTURED_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CODE_TIMEOUT_MS = 60 * 60_000;

/** Free-text signatures of a subscription cap, for paths that carry no structured rate-limit info. */
const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /usage limit/i,
  /you'?ve hit your limit/i,
  /limit reached/i,
  /quota exceeded/i,
  /\b429\b/,
  /too many requests/i,
];

function looksRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

/** Build a RateLimitedError from the SDK's structured rate-limit info. */
function rateLimitedFromInfo(
  info: { resetsAt?: number; rateLimitType?: string } | undefined,
  message: string,
): RateLimitedError {
  const nowMs = Date.now();
  // resetsAt is a unix timestamp in seconds.
  const resetMs = info?.resetsAt ? info.resetsAt * 1000 : undefined;
  const retryAfterMs = resetMs && resetMs > nowMs
    ? Math.min(resetMs - nowMs + 30_000, config.agents.rateLimitMaxWaitMs)
    : config.agents.rateLimitDefaultWaitMs;
  return new RateLimitedError(message, {
    retryAfterMs,
    rateLimitType: info?.rateLimitType,
    resetsAt: resetMs ? new Date(resetMs) : new Date(nowMs + retryAfterMs),
    runtime: 'claude-code',
  });
}

function rateLimitedFromText(text: string): RateLimitedError {
  return new RateLimitedError(`subscription limit reached: ${text.slice(0, 300)}`, {
    retryAfterMs: config.agents.rateLimitDefaultWaitMs,
    resetsAt: new Date(Date.now() + config.agents.rateLimitDefaultWaitMs),
    runtime: 'claude-code',
  });
}

/** Throw RateLimitedError if the thrown SDK/transport error is a 429-shaped one. */
function rethrowIfRateLimited(err: unknown): void {
  const status = (err as { status?: number })?.status;
  const text = String((err as { message?: string })?.message ?? err);
  if (status === 429 || looksRateLimited(text)) throw rateLimitedFromText(text);
}

interface CollectedRun {
  resultText: string;
  structuredOutput: unknown;
  success: boolean;
  errorSubtype?: string;
  errors: string[];
  numTurns: number;
  costUsd?: number;
  /** A `result` message arrived (even a failing one), so a payload may exist. */
  sawResult: boolean;
  /** Set when the SDK threw *after* a result was already emitted. */
  threwAfterResult?: string;
  /** Last rate-limit event seen; `rejected` means the window is exhausted. */
  rateLimit?: { status: string; resetsAt?: number; rateLimitType?: string };
  assistantErrors: string[];
}

/**
 * Drive a query() to completion, collecting everything we need for both
 * result extraction and rate-limit detection. Aborts on timeout.
 *
 * `trace` is the live-build log: when a path is given, every message that says
 * something a person would want to see is summarised into it as it arrives.
 * This is the ONLY place the SDK stream is observed, so it is the only place
 * such a trace can be produced — and it is strictly fire-and-forget: an
 * unwritable log must never disturb a running build (see `appendBuildLog`).
 */
async function collectRun(
  options: Options,
  prompt: string,
  timeoutMs: number,
  label: string,
  trace?: { logPath?: string; agent?: string },
): Promise<CollectedRun> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const out: CollectedRun = {
    resultText: '', structuredOutput: undefined, success: false,
    errors: [], numTurns: 0, assistantErrors: [], sawResult: false,
  };

  try {
    const q = query({ prompt, options: { ...options, abortController: abort } });
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      const m = msg as SDKMessage & Record<string, any>;

      if (trace?.logPath) {
        const event = summarizeSdkMessage(m, trace.agent);
        // Not awaited: the agent stream must not be paced by a disk write, and
        // ordering is preserved anyway because appendFile queues per handle.
        if (event) void appendBuildLog(trace.logPath, event);
      }

      if (m.type === 'rate_limit_event') {
        const info = m.rate_limit_info as CollectedRun['rateLimit'];
        out.rateLimit = info;
        if (info?.status === 'rejected') {
          log.warn('subscription rate limit hit', { label, type: info.rateLimitType, resetsAt: info.resetsAt });
        }
        continue;
      }

      // An assistant turn can carry a typed error (rate_limit / overloaded / auth).
      if (m.type === 'assistant' && typeof m.error === 'string') {
        out.assistantErrors.push(m.error);
        continue;
      }

      if (m.type === 'result') {
        out.sawResult = true;
        out.success = m.subtype === 'success';
        out.numTurns = Number(m.num_turns ?? 0);
        out.resultText = typeof m.result === 'string' ? m.result : '';
        out.structuredOutput = m.structured_output;
        out.costUsd = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : undefined;
        if (Array.isArray(m.errors)) out.errors = m.errors.map((e: unknown) => String(e));
        if (!out.success) out.errorSubtype = String(m.subtype);
        log.info('claude-code run finished', {
          label, success: out.success, subtype: m.subtype, turns: out.numTurns,
          costUsd: m.total_cost_usd,
        });
      }
    }
  } catch (err) {
    if (abort.signal.aborted) {
      throw new Error(`claude-code call "${label}" timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    rethrowIfRateLimited(err);
    // The SDK converts a non-zero exit that carried an error result into a thrown
    // "Claude Code returned an error result: ..." (see Query.readMessages). If a
    // `result` message already arrived — e.g. error_max_turns on the turn that
    // finished the answer — we have the payload in hand. Keep it and let the
    // caller decide whether it validates, instead of discarding good output.
    if (out.sawResult) {
      out.threwAfterResult = String((err as Error)?.message ?? err).slice(0, 300);
      log.warn('claude-code threw after emitting a result; salvaging payload', {
        label, subtype: out.errorSubtype, turns: out.numTurns,
      });
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  // Structured signal first, then typed assistant errors, then free text.
  if (out.rateLimit?.status === 'rejected') {
    throw rateLimitedFromInfo(out.rateLimit, `subscription window exhausted (${out.rateLimit.rateLimitType ?? 'unknown'})`);
  }
  if (out.assistantErrors.some((e) => e === 'rate_limit' || e === 'overloaded')) {
    throw rateLimitedFromInfo(out.rateLimit, `model reported ${out.assistantErrors.join(',')}`);
  }
  if (!out.success) {
    const blob = [out.resultText, ...out.errors].join(' ');
    if (looksRateLimited(blob)) throw rateLimitedFromText(blob);
  }
  return out;
}

function modelFor(heavy: boolean | undefined): string {
  return heavy ? config.agents.modelHeavy : config.agents.model;
}

/** Telemetry is best-effort: a throwing callback must never fail the agent call. */
function reportUsage(
  onUsage: ((u: AgentUsage) => void) | undefined,
  run: CollectedRun,
  model: string,
  startedAt: number,
): void {
  if (!onUsage) return;
  try {
    onUsage({
      runtime: 'claude-code', model,
      numTurns: run.numTurns, costUsd: run.costUsd,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    log.warn('onUsage callback threw', { err: String(err).slice(0, 200) });
  }
}

export const claudeCodeRuntime: AgentRuntime = {
  id: 'claude-code',

  async structured<T>(
    name: string,
    systemPrompt: string,
    userContent: string,
    schema: ZodType<T>,
    opts: StructuredOptions = {},
  ): Promise<T> {
    const retries = opts.retries ?? 2;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS;
    const jsonSchema = zodToJsonSchema(schema);

    // Images are handed over as file paths the agent reads itself (multimodal
    // Read); this keeps everything inside the subscription runtime.
    const needsRead = (opts.imagePaths?.length ?? 0) > 0;
    const imageBlock = needsRead
      ? `\n\nRead these image files before answering (use the Read tool):\n${opts.imagePaths!.map((p) => `- ${p}`).join('\n')}`
      : '';

    const cwd = opts.cwd ?? await mkdtemp(path.join(tmpdir(), 'factory-agent-'));

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await withAgentSlot(`structured:${name}`, async () => {
          const options: Options = {
            cwd,
            model: modelFor(opts.heavy),
            // Turn budget. Default 2 without tools: one turn is normally enough,
            // but a large structured output can need a second turn to finish
            // writing, and error_max_turns would discard an otherwise good run.
            // allowedTools: [] means the extra turn can only complete the answer.
            // With images, add a turn per Read.
            maxTurns: opts.maxTurns
              ?? (needsRead ? 2 + opts.imagePaths!.length + 2 : 2),
            allowedTools: needsRead ? ['Read'] : [],
            disallowedTools: needsRead ? ['Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch'] : undefined,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
            settingSources: [],
            outputFormat: { type: 'json_schema', schema: jsonSchema },
            // No tools here, but there is still no reason to expose factory
            // secrets to a model processing scraped third-party text.
            env: codeAgentEnv(config.agents.oauthToken),
          };

          const prompt = `${userContent}${imageBlock}${jsonOnlyInstruction(schema)}`;
          const startedAt = Date.now();
          const run = await collectRun(options, prompt, timeoutMs, `structured:${name}`, {
            logPath: opts.buildLogPath, agent: name,
          });
          reportUsage(opts.onUsage, run, modelFor(opts.heavy), startedAt);

          if (!run.success && run.structuredOutput === undefined && !run.resultText) {
            throw new Error(
              `claude-code structured call "${name}" failed: ${run.errorSubtype ?? 'unknown'} ` +
              `${[run.threwAfterResult, ...run.errors].filter(Boolean).join('; ').slice(0, 300)}`,
            );
          }

          // Native structured output first; fall back to parsing the final text.
          // A run that hit the turn cap but still emitted schema-valid JSON is
          // accepted: the deciding question is whether the payload validates,
          // not which subtype the session ended on.
          const candidate = run.structuredOutput !== undefined && run.structuredOutput !== null
            ? run.structuredOutput
            : extractJson(run.resultText);
          if (candidate === undefined) {
            throw new Error(
              `agent "${name}" returned no parseable JSON (${run.errorSubtype ?? 'success'}): ` +
              run.resultText.slice(0, 300),
            );
          }

          const parsed = schema.safeParse(candidate);
          if (!parsed.success) {
            throw new Error(`schema validation failed: ${parsed.error.message.slice(0, 500)}`);
          }
          if (!run.success) {
            log.warn('agent produced valid output despite a failed session subtype', {
              name, subtype: run.errorSubtype, turns: run.numTurns,
            });
          }
          log.info('agent done', { name, runtime: 'claude-code', model: modelFor(opts.heavy), attempt });
          return parsed.data;
        });
      } catch (err) {
        // Rate limit is not an attempt: the job waits, it does not burn retries.
        if (err instanceof RateLimitedError) throw err;
        lastErr = err;
        log.warn('agent attempt failed', {
          name, attempt, runtime: 'claude-code',
          err: String((err as Error)?.message ?? err).slice(0, 300),
        });
        if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw new AgentSchemaError(
      `agent "${name}" produced no schema-valid output after ${retries + 1} attempts: ` +
      String((lastErr as Error)?.message ?? lastErr).slice(0, 400),
    );
  },

  async codeAgent<T>(opts: CodeAgentOptions, resultSchema: ZodType<T>): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
    const resultPath = path.join(opts.cwd, 'result.json');

    return withAgentSlot(`code:${opts.name}`, async () => {
      const options: Options = {
        cwd: opts.cwd,
        model: modelFor(opts.heavy),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Default: the builder's tool set. A caller may substitute its own —
        // the social finder swaps Bash for WebSearch, since it searches rather
        // than builds. The PreToolUse guard below applies either way.
        allowedTools: opts.allowedTools ?? ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        maxTurns: opts.maxTurns ?? 80,
        // Workspace boundary enforcement. MUST be a PreToolUse hook: canUseTool
        // is not consulted under bypassPermissions (SDK emits
        // CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), verified empirically.
        hooks: { PreToolUse: [{ hooks: [buildPreToolUseGuard(opts.cwd, opts.name)] }] },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.appendSystemPrompt },
        // Deliberate asymmetry with structured(), which pins settingSources: [].
        // The workspace agent NEEDS its own `<cwd>/.claude/` (that is where the
        // GSAP skills live), so project settings are loaded — but only project
        // ones: the factory operator's personal ~/.claude config must not change
        // how a client's demo site gets built. Note the cwd is `sites/<biz>/`,
        // which has no CLAUDE.md of its own, so nothing from the factory root
        // is inherited here.
        settingSources: ['project'],
        // Skills shipped inside the workspace (`<cwd>/.claude/skills/`) are only
        // offered to the model when they are explicitly enabled. The site builder
        // relies on this to hand the agent the official GSAP skills.
        ...(opts.skills ? { skills: opts.skills } : {}),
        // Allowlist only: the builder never needs SMTP/IMAP/Telegram/S3/DB creds,
        // and must not be able to exfiltrate them via `echo $SMTP_PASS`.
        env: codeAgentEnv(config.agents.oauthToken),
      };

      const prompt =
        `${opts.prompt}\n\n` +
        `MANDATORY FINAL STEP: write a file named result.json in the workspace root (${opts.cwd}) ` +
        `matching this JSON Schema, then stop:\n${JSON.stringify(zodToJsonSchema(resultSchema), null, 2)}`;

      const startedAt = Date.now();
      const run = await collectRun(options, prompt, timeoutMs, `code:${opts.name}`, {
        logPath: opts.buildLogPath, agent: opts.name,
      });
      reportUsage(opts.onUsage, run, modelFor(opts.heavy), startedAt);

      // A session can end on error_max_turns having ALREADY written a valid
      // result.json. The artifact on disk is the contract, so check it before
      // declaring failure — but only trust it if it validates.
      if (!run.success) {
        const salvaged = await readAndValidateResult(resultPath, opts.name, resultSchema).catch(() => undefined);
        if (salvaged !== undefined) {
          log.warn('code agent wrote a valid result.json despite a failed session subtype', {
            name: opts.name, subtype: run.errorSubtype, turns: run.numTurns,
          });
          return salvaged;
        }
        throw new Error(
          `code agent "${opts.name}" did not finish successfully (${run.errorSubtype ?? 'unknown'}): ` +
          `${[run.threwAfterResult, run.resultText, ...run.errors].filter(Boolean).join(' ').slice(0, 300)}`,
        );
      }
      return readAndValidateResult(resultPath, opts.name, resultSchema);
    });
  },
};

/** Shared by both adapters: read result.json from the workspace and validate it. */
export async function readAndValidateResult<T>(
  resultPath: string,
  agentName: string,
  resultSchema: ZodType<T>,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(resultPath, 'utf8');
  } catch {
    throw new AgentSchemaError(`code agent "${agentName}" did not write result.json at ${resultPath}`);
  }
  const candidate = extractJson(raw);
  if (candidate === undefined) {
    throw new AgentSchemaError(`code agent "${agentName}" wrote unparseable result.json`);
  }
  const parsed = resultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AgentSchemaError(
      `code agent "${agentName}" result.json failed schema: ${parsed.error.message.slice(0, 400)}`,
    );
  }
  return parsed.data;
}
