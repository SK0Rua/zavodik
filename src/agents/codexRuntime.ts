/**
 * Codex CLI runtime adapter — alternative subscription runtime (SPEC §2.3).
 *
 * Auth is the ChatGPT subscription via `codex login` (token in $CODEX_HOME);
 * nothing pay-per-token, no OPENAI_API_KEY is ever passed.
 *
 * structured(): `codex exec --output-schema <schema.json> -o <last-message>`
 *               in a read-only sandbox — the last agent message is the JSON.
 * codeAgent():  `codex exec --cd <workspace> --sandbox workspace-write`; the
 *               agent writes result.json, same contract as the Claude adapter.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ZodType } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { zodToJsonSchema, extractJson, jsonOnlyInstruction } from './schema.js';
import { withAgentSlot } from './semaphore.js';
import { readAndValidateResult } from './claudeCodeRuntime.js';
import { codeAgentEnv } from './sandbox.js';
import {
  AgentSchemaError,
  RateLimitedError,
  type AgentRuntime,
  type CodeAgentOptions,
  type StructuredOptions,
} from './types.js';

const DEFAULT_STRUCTURED_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CODE_TIMEOUT_MS = 60 * 60_000;

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /usage limit/i,
  /you'?ve hit your limit/i,
  /quota exceeded/i,
  /\b429\b/,
  /too many requests/i,
  /try again (later|in)/i,
];

/** Exported for unit tests: does this CLI output signal an exhausted subscription? */
export function codexLooksRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

interface ExecResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function runCodex(args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // Same allowlist as the Claude adapter: factory credentials (SMTP/IMAP/
    // Telegram/S3/DATABASE_URL) never reach an agent process, and no
    // pay-per-token API key is passed either.
    const env = codeAgentEnv('');

    const child = spawn(config.agents.codexBin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

function assertNotRateLimited(res: ExecResult): void {
  const blob = `${res.stdout}\n${res.stderr}`;
  if (codexLooksRateLimited(blob)) {
    throw new RateLimitedError(`codex subscription limit reached: ${blob.slice(-300)}`, {
      retryAfterMs: config.agents.rateLimitDefaultWaitMs,
      resetsAt: new Date(Date.now() + config.agents.rateLimitDefaultWaitMs),
      runtime: 'codex',
    });
  }
}

function modelArgs(heavy: boolean | undefined): string[] {
  const model = heavy ? config.agents.codexModelHeavy : config.agents.codexModel;
  return model ? ['--model', model] : [];
}

export const codexRuntime: AgentRuntime = {
  id: 'codex',

  async structured<T>(
    name: string,
    systemPrompt: string,
    userContent: string,
    schema: ZodType<T>,
    opts: StructuredOptions = {},
  ): Promise<T> {
    const retries = opts.retries ?? 2;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS;
    const scratch = await mkdtemp(path.join(tmpdir(), 'factory-codex-'));
    const schemaPath = path.join(scratch, 'schema.json');
    const lastMessagePath = path.join(scratch, 'last-message.txt');
    await writeFile(schemaPath, JSON.stringify(zodToJsonSchema(schema), null, 2), 'utf8');

    const imageArgs = (opts.imagePaths ?? []).flatMap((p) => ['--image', p]);
    const prompt = `${systemPrompt}\n\n---\n\n${userContent}${jsonOnlyInstruction(schema)}`;

    let lastErr: unknown;
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await withAgentSlot(`structured:${name}`, async () => {
            const args = [
              'exec',
              '--sandbox', 'read-only',
              '--skip-git-repo-check',
              '--ephemeral',
              '--cd', opts.cwd ?? scratch,
              '--output-schema', schemaPath,
              '--output-last-message', lastMessagePath,
              ...modelArgs(opts.heavy),
              ...imageArgs,
              prompt,
            ];
            const res = await runCodex(args, opts.cwd ?? scratch, timeoutMs);
            if (res.timedOut) throw new Error(`codex call "${name}" timed out after ${Math.round(timeoutMs / 1000)}s`);
            assertNotRateLimited(res);
            if (res.code !== 0) {
              throw new Error(`codex exec exited ${res.code}: ${res.stderr.slice(-400) || res.stdout.slice(-400)}`);
            }

            const lastMessage = await readFile(lastMessagePath, 'utf8').catch(() => res.stdout);
            const candidate = extractJson(lastMessage);
            if (candidate === undefined) {
              throw new Error(`agent "${name}" returned no parseable JSON: ${lastMessage.slice(0, 300)}`);
            }
            const parsed = schema.safeParse(candidate);
            if (!parsed.success) {
              throw new Error(`schema validation failed: ${parsed.error.message.slice(0, 500)}`);
            }
            log.info('agent done', { name, runtime: 'codex', attempt });
            return parsed.data;
          });
        } catch (err) {
          if (err instanceof RateLimitedError) throw err;
          lastErr = err;
          log.warn('agent attempt failed', {
            name, attempt, runtime: 'codex',
            err: String((err as Error)?.message ?? err).slice(0, 300),
          });
          if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
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
      const prompt =
        `${opts.appendSystemPrompt ? `${opts.appendSystemPrompt}\n\n---\n\n` : ''}${opts.prompt}\n\n` +
        `MANDATORY FINAL STEP: write a file named result.json in the workspace root (${opts.cwd}) ` +
        `matching this JSON Schema, then stop:\n${JSON.stringify(zodToJsonSchema(resultSchema), null, 2)}`;

      const args = [
        'exec',
        '--sandbox', 'workspace-write',
        '--skip-git-repo-check',
        '--cd', opts.cwd,
        ...modelArgs(opts.heavy),
        prompt,
      ];
      const res = await runCodex(args, opts.cwd, timeoutMs);
      if (res.timedOut) throw new Error(`codex code agent "${opts.name}" timed out after ${Math.round(timeoutMs / 1000)}s`);
      assertNotRateLimited(res);
      if (res.code !== 0) {
        throw new Error(`codex code agent "${opts.name}" exited ${res.code}: ${res.stderr.slice(-400)}`);
      }
      return readAndValidateResult(resultPath, opts.name, resultSchema);
    });
  },
};
