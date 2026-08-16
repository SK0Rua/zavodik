/**
 * Agent harness: every fuzzy task runs as a Claude agent with FORCED structured
 * output (tool_choice -> a single "submit" tool with a JSON schema).
 * The orchestrator never accepts free-text agent conclusions.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z, ZodType } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export interface AgentOptions {
  heavy?: boolean;         // use the heavy model (design/build tasks)
  maxTokens?: number;
  retries?: number;
}

function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  // zod v3: use built-in JSON schema conversion via zod-to-json-schema-like minimal walk.
  // We keep schemas simple (objects/arrays/primitives/enums), so a compact converter suffices.
  const def: any = (schema as any)._def;
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v as ZodType);
        if (!(v as any).isOptional()) required.push(k);
      }
      return { type: 'object', properties, required, additionalProperties: false };
    }
    case 'ZodArray': return { type: 'array', items: zodToJsonSchema(def.type) };
    case 'ZodString': return { type: 'string' };
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'string', enum: def.values };
    case 'ZodNullable': return { anyOf: [zodToJsonSchema(def.innerType), { type: 'null' }] };
    case 'ZodOptional': return zodToJsonSchema(def.innerType);
    case 'ZodRecord': return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) };
    case 'ZodLiteral': return { const: def.value };
    case 'ZodUnion': return { anyOf: def.options.map((o: ZodType) => zodToJsonSchema(o)) };
    default: return {};
  }
}

export async function runAgent<T>(
  name: string,
  systemPrompt: string,
  userContent: string,
  outputSchema: ZodType<T>,
  opts: AgentOptions = {},
): Promise<T> {
  if (!config.anthropic.apiKey) {
    throw Object.assign(new Error(`ANTHROPIC_API_KEY not set; agent "${name}" cannot run`), { code: 'NEEDS_HUMAN' });
  }
  const model = opts.heavy ? config.anthropic.modelHeavy : config.anthropic.model;
  const retries = opts.retries ?? 2;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: systemPrompt +
          '\n\nCRITICAL: You must return your result ONLY via the "submit" tool. ' +
          'Never invent facts. If evidence for a field is missing, use null and list it in gaps.',
        messages: [{ role: 'user', content: userContent }],
        tools: [{
          name: 'submit',
          description: 'Submit the final structured result.',
          input_schema: zodToJsonSchema(outputSchema) as any,
        }],
        tool_choice: { type: 'tool', name: 'submit' },
      });
      const toolUse = res.content.find((b) => b.type === 'tool_use') as { input: unknown } | undefined;
      if (!toolUse) throw new Error('agent returned no tool_use block');
      const parsed = outputSchema.safeParse(toolUse.input);
      if (!parsed.success) throw new Error(`schema validation failed: ${parsed.error.message.slice(0, 500)}`);
      log.info('agent done', { name, model, attempt });
      return parsed.data;
    } catch (err: any) {
      const retriable = err?.status === 429 || err?.status >= 500 || String(err).includes('schema validation');
      log.warn('agent attempt failed', { name, attempt, err: String(err?.message ?? err).slice(0, 300) });
      if (attempt === retries || !retriable) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

export { z };
