/**
 * Real subscription verification for the agent runtime layer.
 * Runs a structured call and a workspace (code agent) call through whichever
 * runtime AGENT_RUNTIME selects. No ANTHROPIC_API_KEY is used or required.
 *
 *   pnpm tsx scripts/verify-agent-runtime.ts            # claude-code
 *   AGENT_RUNTIME=codex pnpm tsx scripts/verify-agent-runtime.ts
 */
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAgent, runCodeAgent, z } from '../src/agents/runtime.js';
import { config } from '../src/config.js';

const FactsSchema = z.object({
  name: z.string(),
  city: z.string(),
  services: z.array(z.string()),
  yearFounded: z.number().nullable(),
});

const BuildResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  filesCreated: z.array(z.string()),
});

async function main(): Promise<void> {
  console.log(`runtime=${config.agents.runtime}  model=${config.agents.model}  heavy=${config.agents.modelHeavy}`);
  console.log(`ANTHROPIC_API_KEY present in env: ${Boolean(process.env.ANTHROPIC_API_KEY)} (must NOT be needed)\n`);

  // ── 1. structured, no tools ────────────────────────────────────────────────
  const t0 = Date.now();
  const facts = await runAgent(
    'verify-structured',
    'You extract verified facts about a local business. Never invent: unknown -> null.',
    `Nails by Eleni is a small nail studio in Patras, Greece. Eleni offers gel manicure,
pedicure and nail art. The studio's opening year is not mentioned anywhere.`,
    FactsSchema,
  );
  console.log(`[1] structured OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(facts, null, 2));
  if (facts.yearFounded !== null) throw new Error('evidence rule violated: invented yearFounded');

  // ── 2. code agent in a throwaway workspace ────────────────────────────────
  const ws = await mkdtemp(path.join(tmpdir(), 'factory-verify-'));
  try {
    const t1 = Date.now();
    const built = await runCodeAgent(
      {
        name: 'verify-code-agent',
        cwd: ws,
        prompt:
          'Create a file named hello.txt in the workspace root containing exactly the text ' +
          '"websites-factory agent runtime OK". Then verify it exists by reading it back.',
        maxTurns: 15,
      },
      BuildResultSchema,
    );
    console.log(`\n[2] code agent OK in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    console.log(JSON.stringify(built, null, 2));
    console.log('workspace files:', (await readdir(ws)).join(', '));
  } finally {
    await rm(ws, { recursive: true, force: true });
  }

  console.log('\nBOTH CALLS SUCCEEDED ON SUBSCRIPTION AUTH.');
}

main().catch((err) => { console.error('VERIFY FAILED:', err); process.exit(1); });
