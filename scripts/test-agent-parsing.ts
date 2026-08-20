/**
 * Pure-function tests for the agent runtime: JSON extraction, zod->JSON Schema,
 * rate-limit detection and the concurrency semaphore. No model calls, no network.
 *
 *   pnpm tsx scripts/test-agent-parsing.ts
 */
import { extractJson, zodToJsonSchema } from '../src/agents/schema.js';
import { codexLooksRateLimited } from '../src/agents/codexRuntime.js';
import { withAgentSlot, agentSlotStats } from '../src/agents/semaphore.js';
import { RateLimitedError, isRateLimitedError } from '../src/agents/types.js';
import { z } from 'zod';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`, detail ?? ''); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── extractJson ─────────────────────────────────────────────────────────────
check('plain object', eq(extractJson('{"a":1}'), { a: 1 }));
check('fenced json', eq(extractJson('```json\n{"a":1}\n```'), { a: 1 }));
check('bare fence', eq(extractJson('```\n{"a":1}\n```'), { a: 1 }));
check('prose around json', eq(extractJson('Here you go:\n{"a":1}\nHope that helps.'), { a: 1 }));
check('top-level array', eq(extractJson('[1,2,3]'), [1, 2, 3]));
check('braces inside strings', eq(extractJson('{"a":"}{ not a brace"}'), { a: '}{ not a brace' }));
check('nested objects', eq(extractJson('text {"a":{"b":[1,{"c":2}]}} tail'), { a: { b: [1, { c: 2 }] } }));
check('escaped quote in string', eq(extractJson('{"a":"say \\"hi\\""}'), { a: 'say "hi"' }));
check('no json -> undefined', extractJson('there is no json here') === undefined);
check('empty -> undefined', extractJson('   ') === undefined);

// ── zodToJsonSchema ─────────────────────────────────────────────────────────
const Schema = z.object({
  name: z.string(),
  year: z.number().nullable(),
  tags: z.array(z.string()),
  kind: z.enum(['a', 'b']),
  note: z.string().optional(),
});
const js = zodToJsonSchema(Schema) as any;
check('object type', js.type === 'object');
check('required excludes optional', eq(js.required.sort(), ['kind', 'name', 'tags', 'year']), js.required);
check('nullable -> anyOf', eq(js.properties.year, { anyOf: [{ type: 'number' }, { type: 'null' }] }));
check('array items', eq(js.properties.tags, { type: 'array', items: { type: 'string' } }));
check('enum values', eq(js.properties.kind, { type: 'string', enum: ['a', 'b'] }));
check('additionalProperties false', js.additionalProperties === false);

// ── rate limit detection ────────────────────────────────────────────────────
check('detects "rate limit"', codexLooksRateLimited('Error: rate limit exceeded'));
check('detects "usage limit"', codexLooksRateLimited("You've hit your usage limit"));
check('detects 429', codexLooksRateLimited('HTTP 429 Too Many Requests'));
check('ignores normal output', !codexLooksRateLimited('Created hello.txt successfully'));

const rl = new RateLimitedError('window exhausted', { retryAfterMs: 900_000, rateLimitType: 'five_hour' });
check('RateLimitedError code', rl.code === 'RATE_LIMITED');
check('isRateLimitedError true', isRateLimitedError(rl));
check('isRateLimitedError false for plain', !isRateLimitedError(new Error('boom')));
check('retryAfterMs preserved', rl.retryAfterMs === 900_000);

// ── semaphore (AGENT_CONCURRENCY defaults to 1) ─────────────────────────────
const order: string[] = [];
let maxObserved = 0;
const task = (id: string) => withAgentSlot(id, async () => {
  maxObserved = Math.max(maxObserved, agentSlotStats().active);
  order.push(`start:${id}`);
  await new Promise((r) => setTimeout(r, 30));
  order.push(`end:${id}`);
});
await Promise.all([task('a'), task('b'), task('c')]);
check('semaphore serializes at limit 1', maxObserved === 1, { maxObserved });
check('no interleaving', eq(order, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']), order);
check('slots released', agentSlotStats().active === 0 && agentSlotStats().waiting === 0);

// a throwing task must still release its slot
await withAgentSlot('boom', async () => { throw new Error('x'); }).catch(() => {});
check('slot released after throw', agentSlotStats().active === 0);

console.log(failures === 0 ? '\n🧪 AGENT PARSING TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
