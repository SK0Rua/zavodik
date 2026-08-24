/**
 * The workspace artifact contract shared by EVERY adapter and transport.
 *
 * A code agent's only channel back into the pipeline is `result.json` in the
 * workspace root, validated against the caller's zod schema. Headless SDK
 * runs (Claude), CLI subprocess runs (Codex) and tmux terminal runs all read
 * their answer through this one function — which is what makes the transports
 * interchangeable: same file, same schema, same errors.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ZodType } from 'zod';
import { extractJson } from './schema.js';
import { AgentSchemaError } from './types.js';

/** Where an agent of `name` must have written its answer inside `workspace`. */
export function resultPathIn(workspace: string): string {
  return path.join(workspace, 'result.json');
}

/** Read result.json from the workspace and validate it. Shared by all adapters. */
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
