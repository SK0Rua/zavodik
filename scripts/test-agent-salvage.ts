/**
 * Regression test: a session that hits the turn cap but has ALREADY produced a
 * valid payload must NOT be thrown away.
 *
 * Background: the Agent SDK converts a non-zero exit carrying an error result
 * into a thrown "Claude Code returned an error result: ..." (Query.readMessages).
 * Before the fix, that throw escaped `collectRun`, so a complete answer written
 * on the final turn was discarded and the caller burned all its retries.
 *
 * Reported by phase-c from a live `design-directions` run (error_max_turns,
 * turns: 2) on a real Patras business.
 *
 *   pnpm tsx scripts/test-agent-salvage.ts
 *
 * Makes REAL subscription calls (a few cents, ~1 min).
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAgent, runCodeAgent, z } from '../src/agents/runtime.js';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`, detail ?? ''); }
};

async function main(): Promise<void> {
  // ── code agent: writes result.json, then is cut off by the turn cap ────────
  const ws = await mkdtemp(path.join(tmpdir(), 'factory-salvage-'));
  try {
    const out = await runCodeAgent({
      name: 'salvage-probe', cwd: ws, maxTurns: 2,
      prompt:
        'Step 1: immediately write result.json containing {"ok":true,"note":"artifact written"}. ' +
        'Step 2: then create ten more files a1.txt..a10.txt, one per turn, reading each back after writing.',
    }, z.object({ ok: z.boolean(), note: z.string() }));

    check('code agent result salvaged after turn cap', out.ok === true, out);
    check('salvaged value matches the artifact on disk',
      JSON.parse(await readFile(path.join(ws, 'result.json'), 'utf8')).note === out.note);
  } catch (err) {
    failures++;
    console.error('❌ code agent salvage threw instead of returning:', String((err as Error).message).slice(0, 300));
  } finally {
    await rm(ws, { recursive: true, force: true });
  }

  // ── structured: a large output must survive the default turn budget ───────
  const Direction = z.object({
    name: z.string(), layoutConcept: z.string(), typography: z.string(),
    palette: z.array(z.string()), motionConcept: z.string(), heroTreatment: z.string(),
    distinctiveness: z.number(), riskOfKitsch: z.number(),
  });
  const directions = await runAgent(
    'salvage-structured',
    'You are an art director. Produce exactly 3 STRUCTURALLY different design directions. Be detailed and concrete in every field.',
    'Business: Pagoulatos Luxury Hair Salon, Patras, Greece. Balayage, bridal styling, keratin treatments.',
    z.object({ directions: z.array(Direction) }),
    { heavy: true, retries: 0 },
  );
  check('large structured output returns 3 directions', directions.directions.length === 3,
    directions.directions.map((d) => d.name));

  console.log(failures === 0 ? '\n🧪 AGENT SALVAGE TESTS PASSED' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('TEST ERROR:', err); process.exit(1); });
