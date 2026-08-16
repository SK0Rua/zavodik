/**
 * Code agent runner: programmatic Claude Code via @anthropic-ai/claude-agent-sdk.
 * Used for stages that need a real agent with tools and a workspace
 * (site builder, QA fix loop). The agent works inside `cwd`, can read/write
 * files and run bash (pnpm install/build), and iterates until done.
 *
 * Contract with the orchestrator stays structured: the agent must write
 * `result.json` into its workspace; we read and validate it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z, type ZodType } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export interface CodeAgentOptions {
  name: string;
  cwd: string;
  prompt: string;
  appendSystemPrompt?: string;
  maxTurns?: number;
  heavy?: boolean;
}

export async function runCodeAgent<T>(
  opts: CodeAgentOptions,
  resultSchema: ZodType<T>,
): Promise<T> {
  if (!config.anthropic.apiKey) {
    throw Object.assign(new Error(`ANTHROPIC_API_KEY not set; code agent "${opts.name}" cannot run`), { code: 'NEEDS_HUMAN' });
  }

  const q = query({
    prompt:
      `${opts.prompt}\n\n` +
      `MANDATORY FINAL STEP: write a file named result.json in the workspace root ` +
      `matching the required result schema, then stop.`,
    options: {
      cwd: opts.cwd,
      model: opts.heavy ? config.anthropic.modelHeavy : config.anthropic.model,
      permissionMode: 'bypassPermissions',
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      maxTurns: opts.maxTurns ?? 80,
      systemPrompt: opts.appendSystemPrompt
        ? { type: 'preset', preset: 'claude_code', append: opts.appendSystemPrompt }
        : { type: 'preset', preset: 'claude_code' },
      env: { ...process.env, ANTHROPIC_API_KEY: config.anthropic.apiKey } as Record<string, string>,
    },
  });

  let finalText = '';
  let success = false;
  for await (const msg of q) {
    if (msg.type === 'result') {
      success = msg.subtype === 'success';
      finalText = 'result' in msg ? String(msg.result) : '';
      log.info('code agent finished', {
        name: opts.name, success, turns: msg.num_turns,
        costUsd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
      });
    }
  }
  if (!success) {
    throw new Error(`code agent "${opts.name}" did not finish successfully: ${finalText.slice(0, 300)}`);
  }

  const raw = await readFile(path.join(opts.cwd, 'result.json'), 'utf8')
    .catch(() => { throw new Error(`code agent "${opts.name}" did not write result.json`); });
  const parsed = resultSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`code agent "${opts.name}" result.json failed schema: ${parsed.error.message.slice(0, 400)}`);
  }
  return parsed.data;
}

export { z };
