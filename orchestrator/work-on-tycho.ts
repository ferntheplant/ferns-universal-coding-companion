#!/usr/bin/env bun
/**
 * Drive a coding agent inside the tycho sandbox.
 *
 *   bun orchestrator/work-on-tycho.ts                              # status
 *   bun orchestrator/work-on-tycho.ts "fix the failing test in X"  # send a prompt
 *   bun orchestrator/work-on-tycho.ts --agent pi --model opencode-go/qwen3.6-plus "..."
 *
 * Flow:
 *   1. Look up (or provision) the tycho sandbox via findOrProvisionAppSandbox.
 *      Cold start does the slow clone+install+dev-server work; subsequent
 *      runs reuse the existing sandbox.
 *   2. Run the agent CLI inside the sandbox with --session-id=<stable>.
 *      Agent session persists inside the sandbox FS, so re-running with
 *      the same agent picks up the same conversation.
 *   3. Stream stdout/stderr back. Ctrl-C disconnects — sandbox + session
 *      stay alive on the Daytona side.
 */

import { loadSandboxEnv } from "../sandbox/env.ts";
loadSandboxEnv();

import { tychoConfig } from "../config/tycho.ts";
import {
  findOrProvisionAppSandbox,
} from "../sandbox/provision.ts";
import { runAgent, type AgentName } from "./run-agent.ts";

interface ParsedArgs {
  agent: AgentName;
  model: string | undefined;
  sessionId: string | undefined;
  prompt: string | undefined;
  statusOnly: boolean;
}

const APP = "tycho";
const DEFAULT_AGENT: AgentName = "pi";
const DEFAULT_MODEL = "opencode-go/qwen3.6-plus";

function parseArgs(argv: string[]): ParsedArgs {
  let agent: AgentName = DEFAULT_AGENT;
  let model: string | undefined;
  let sessionId: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--agent":
      case "-a":
        agent = argv[++i] as AgentName;
        break;
      case "--model":
      case "-m":
        model = argv[++i];
        break;
      case "--session":
      case "-s":
        sessionId = argv[++i];
        break;
      case "--fresh":
        // Quick escape hatch: timestamp-suffixed session so any prior
        // state (corrupt or otherwise) is bypassed.
        sessionId = `fresh-${Date.now()}`;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (a && a.startsWith("--")) {
          throw new Error(`unknown flag: ${a}`);
        }
        if (a !== undefined) positional.push(a);
    }
  }

  const prompt = positional.length > 0 ? positional.join(" ") : undefined;
  return { agent, model, sessionId, prompt, statusOnly: prompt === undefined };
}

function printHelp(): void {
  console.log(`
work-on-tycho — drive a coding agent inside the tycho Daytona sandbox

Usage:
  bun orchestrator/work-on-tycho.ts                              status
  bun orchestrator/work-on-tycho.ts "<prompt>"                   send to ${DEFAULT_AGENT}
  bun orchestrator/work-on-tycho.ts --agent <name> "<prompt>"

Flags:
  -a, --agent <name>     pi (default) | claude-code | codex | opencode
  -m, --model <spec>     model specifier (default: ${DEFAULT_MODEL})
  -s, --session <id>     conversation id; default "${APP}-<agent>"
      --fresh            use a timestamp-suffixed session (bypasses any
                         prior state — useful if the default session
                         seems corrupted or you want a clean run)
  -h, --help             this help

Session continuity:
  Same agent name + same sandbox = same conversation, automatically.
  Disconnect with Ctrl-C; re-run to resume.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { sandbox, repoDir } = await findOrProvisionAppSandbox(tychoConfig);

  if (args.statusOnly) {
    console.log(`sandbox:  ${sandbox.id} (${sandbox.state})`);
    console.log(`repo:     ${repoDir}`);
    console.log(`logs:     /var/log/app/{spacetime-host,tycho-dev}.log`);
    console.log("");
    console.log(`Send a prompt:`);
    console.log(`  bun orchestrator/work-on-tycho.ts "your prompt here"`);
    return;
  }

  const sessionId = args.sessionId ?? `${APP}-${args.agent}`;
  const model = args.model ?? DEFAULT_MODEL;

  console.error(
    `[orchestrator] agent=${args.agent} model=${model} session=${sessionId} sandbox=${sandbox.id}`,
  );
  console.error(`[orchestrator] ---`);

  const { exitCode } = await runAgent(sandbox, {
    agent: args.agent,
    prompt: args.prompt!,
    sessionId,
    cwd: repoDir,
    model,
  });

  if (exitCode !== 0) {
    console.error(`[orchestrator] agent exited with code ${exitCode}`);
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error("[orchestrator] failed:", err);
  process.exit(1);
});
