/**
 * The workspace guard as a STANDALONE PreToolUse command hook.
 *
 * Why this file exists: `buildPreToolUseGuard()` in sandbox.ts is a JavaScript
 * closure, which only the Agent SDK can call. The tmux runner launches the
 * interactive `claude` CLI instead, and a CLI session can only run a hook that
 * is a *command* — a process that reads the hook payload on stdin and writes a
 * decision on stdout. Without this file the tmux path would have NO guard at
 * all, which is exactly the kind of silent downgrade the sandbox comment warns
 * about.
 *
 * Both paths therefore share ONE decision function (`evaluateToolCall`); only
 * the transport differs. `scripts/test-tmux-agent.ts` asserts the two agree on
 * the same inputs, so parity is checked rather than assumed.
 *
 * Contract (verified against the published hook reference for CLI 2.1.x):
 *   stdin  — JSON with `tool_name`, `tool_input`, `cwd`, `hook_event_name`, …
 *   stdout — `{}` to stay out of the way, or a `hookSpecificOutput` block with
 *            `permissionDecision: "deny"` to block the call.
 *   exit 0 in both cases: a non-zero exit is a *hook* failure, which is not what
 *            a considered "deny" is, and exit 2 would drop our reason text.
 *
 * PreToolUse hooks fire before the permission-mode check, so a deny here holds
 * even under `--dangerously-skip-permissions` — the same property the SDK path
 * relies on.
 *
 * Fail-closed: an unreadable payload, an unparseable body or a throwing guard
 * all deny. A guard that fails open is not a guard.
 *
 * Invoked as: `node --import tsx <this file> <workspace-dir>`, wired by
 * `tmuxRuntime.ts`. The workspace dir is passed as argv rather than read from
 * the payload's `cwd`, because `cwd` is where the *agent* currently is, and the
 * boundary must be fixed at launch.
 */
import { evaluateToolCall } from './sandbox.js';

/** Read all of stdin. Returns '' when nothing arrives (also a deny, see below). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function deny(reason: string, workspace: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Denied by the factory workspace guard: ${reason}. ` +
        `Work only inside ${workspace}; do not read credentials or reach the network beyond package registries.`,
    },
  });
}

async function main(): Promise<void> {
  const workspace = process.argv[2];
  if (!workspace) {
    // No boundary was configured, so no call can be judged safe.
    process.stdout.write(deny('the guard was started without a workspace path', '(unset)'));
    return;
  }

  let payload: { tool_name?: string; tool_input?: unknown };
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw) as typeof payload;
  } catch (err) {
    process.stdout.write(deny(`unreadable hook payload (${String(err).slice(0, 120)})`, workspace));
    return;
  }

  let decision: { allow: boolean; reason?: string };
  try {
    decision = evaluateToolCall(workspace, String(payload.tool_name ?? ''), payload.tool_input);
  } catch (err) {
    decision = { allow: false, reason: `guard error: ${String(err).slice(0, 120)}` };
  }

  // `{}` rather than an explicit "allow": allowing is the CLI's own job, and a
  // hook that returns `allow` would ALSO suppress the deny rules configured
  // elsewhere. This guard only ever has an opinion about denial.
  process.stdout.write(decision.allow ? '{}' : deny(decision.reason ?? 'not permitted', workspace));
}

void main().catch((err) => {
  // Unreachable in practice; still fail closed rather than exit non-zero.
  process.stdout.write(deny(`guard crashed: ${String(err).slice(0, 120)}`, process.argv[2] ?? '(unset)'));
});
