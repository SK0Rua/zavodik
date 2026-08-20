/**
 * Back-compat facade for the structured agent call.
 *
 * The real implementation lives in `runtime.ts` (subscription-only runtimes:
 * Claude Code / Codex CLI). This module keeps the historic import path used
 * across `src/workers/*` working: `import { runAgent, z } from '../agents/agent.js'`.
 */
export { runAgent, z } from './runtime.js';
export type { StructuredOptions, StructuredOptions as AgentOptions } from './types.js';
