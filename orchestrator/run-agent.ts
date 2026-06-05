/**
 * Run a coding-agent CLI inside an already-prepared Daytona sandbox.
 *
 * The sandbox is the runtime. The agent is the program — Pi, claude-code,
 * codex, opencode. Each is "just" a CLI that we invoke with a prompt and
 * a session ID; the orchestrator's job is to know each one's flag syntax
 * and stream its output back to the local terminal.
 *
 * Session continuity:
 *   - We pass a stable `sessionId` to the agent (e.g. "tycho-pi"). For Pi
 *     this becomes --session-id; the agent persists its state inside the
 *     sandbox (~/.pi/agent/sessions/...). Sandboxes auto-stop after 60min
 *     idle, but their disk persists, so reconnecting later picks up the
 *     same session.
 *   - We use ONE Daytona session per sandbox ("orchestrator") to stream
 *     output. Daytona's "session" is just a persistent shell — separate
 *     concept from the agent's conversation session.
 *
 * Streaming:
 *   executeSessionCommand with runAsync:true returns immediately with a
 *   cmdId. getSessionCommandLogs(cmdId, onStdout, onStderr) streams logs
 *   until the command exits; we then poll getSessionCommand for the
 *   exit code.
 */

import type { Sandbox } from "@daytona/sdk";

/** Agents we know how to invoke. Add cases to buildAgentCommand as you wire more. */
export type AgentName = "pi" | "claude-code" | "codex" | "opencode";

export interface RunAgentOptions {
  agent: AgentName;
  /** The user-supplied prompt. */
  prompt: string;
  /**
   * Stable conversation ID. Same value across runs = same conversation
   * resumed by the agent. Choose something app+agent-scoped like
   * "tycho-pi" or "tycho-claude".
   */
  sessionId: string;
  /** Working directory inside the sandbox. The agent runs with this as cwd. */
  cwd: string;
  /** Optional model override; passed to the agent if it supports it. */
  model?: string;
}

const DAYTONA_SESSION_ID = "orchestrator";

/** Shell-quote for embedding in single-quoted bash strings. */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the agent-specific CLI invocation. Each agent has its own flag
 * vocabulary for "resume this session" + "print non-interactively".
 *
 * Pi:          --session-id <id> --model <m> -p <prompt>
 *              (creates the session-id if missing; sessions stored under
 *              ~/.pi/agent/sessions/)
 * claude-code: --resume <id> --model <m> --print <prompt>     (stubbed)
 * codex:       exec --session-id <id> --model <m> <prompt>    (stubbed)
 * opencode:    run --session <id> -m <m> <prompt>             (stubbed)
 *
 * The stubs throw on use until you verify each agent's exact syntax in
 * the snapshot — the help text shifts between versions and I'd rather
 * fail loud than ship a guess.
 */
function buildAgentCommand(opts: RunAgentOptions): string {
  const { agent, prompt, sessionId, model } = opts;
  switch (agent) {
    case "pi": {
      const modelFlag = model ? ` --model ${sq(model)}` : "";
      // Wrap in `script -q -c ... /dev/null` so pi runs under a pty. Without
      // a tty pi block-buffers stdout (libuv default), so we'd only see
      // output when pi exits — which on long sessions looks like a hang.
      // script's typescript file goes to /dev/null; the live output is what
      // Daytona's session logs see and stream back.
      const piCmd = `pi --session-id ${sq(sessionId)}${modelFlag} -p ${sq(prompt)}`;
      return `script -q -c ${sq(piCmd)} /dev/null`;
    }
    case "claude-code":
    case "codex":
    case "opencode":
      throw new Error(
        `agent "${agent}" not wired yet. Add the right CLI invocation to ` +
          `orchestrator/run-agent.ts:buildAgentCommand once you confirm the ` +
          `exact flags inside the sandbox snapshot.`,
      );
  }
}

/**
 * Ensure the long-lived Daytona session exists. Idempotent — sessions
 * survive across calls; trying to create one that already exists throws,
 * which we swallow.
 */
async function ensureSession(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.process.createSession(DAYTONA_SESSION_ID);
  } catch {
    // already exists
  }
}

/**
 * Run the agent and stream output to the local stdout/stderr. Resolves
 * when the agent exits.
 *
 * Returns the exit code so callers can decide whether to retry / bail.
 */
export async function runAgent(
  sandbox: Sandbox,
  opts: RunAgentOptions,
): Promise<{ exitCode: number }> {
  await ensureSession(sandbox);

  const command = `cd ${sq(opts.cwd)} && ${buildAgentCommand(opts)}`;

  const submit = await sandbox.process.executeSessionCommand(
    DAYTONA_SESSION_ID,
    { command, runAsync: true },
  );
  const cmdId = submit.cmdId;
  if (!cmdId) {
    throw new Error(
      "Daytona executeSessionCommand returned no cmdId; cannot stream logs.",
    );
  }

  // Streams until the command exits (or the connection drops).
  await sandbox.process.getSessionCommandLogs(
    DAYTONA_SESSION_ID,
    cmdId,
    (chunk) => process.stdout.write(chunk),
    (chunk) => process.stderr.write(chunk),
  );

  const final = await sandbox.process.getSessionCommand(
    DAYTONA_SESSION_ID,
    cmdId,
  );
  return { exitCode: final.exitCode ?? 0 };
}
