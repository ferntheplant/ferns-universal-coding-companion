#!/usr/bin/env bun
/**
 * Spin up a Daytona sandbox preloaded with this Pi agent harness.
 *
 * The snapshot (built by sandbox/build-snapshot.ts) already contains:
 *   - the harness repo at /opt/fucc
 *   - bun install + ./install.sh applied → /root/.pi/agent/ wired up
 *   - all third-party tools (pi, agent-browser + Chromium, ast-grep, fd,
 *     ripgrep, ctags, difftastic, ffmpeg)
 *
 * This script just creates a sandbox from the snapshot, forwards LLM
 * credentials, and runs a smoke test. Sandbox creation should be near
 * instant — no per-sandbox install steps.
 *
 * Run:  bun sandbox/run-sandbox.ts [<version>]
 *
 * Optional positional <version> picks a specific tagged snapshot — must
 * match what was passed to build-snapshot.ts.
 *
 * Required env (load from sandbox/.env):
 *   DAYTONA_API_KEY         your local Daytona API key
 *
 * Optional env:
 *   DAYTONA_API_URL         default http://localhost:3000/api
 *   FUCC_SNAPSHOT_BASE      default "fucc-pi-harness"
 *   FUCC_SNAPSHOT_VERSION   alternative to positional arg
 *   FUCC_SNAPSHOT_NAME      bypass base/version with an explicit snapshot name
 *   FUCC_KEEP_SANDBOX       if set, leave the sandbox running after the smoke test
 *   FUCC_SKIP_PI_AUTH       if set, do NOT upload ~/.pi/auth.json (and friends)
 *                           into the sandbox. By default we inject them so the
 *                           sandbox inherits your OAuth subscriptions
 *                           (openai-codex, claude pro/max) + API keys.
 *
 *   Any LLM provider key set on the host (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 *   SYNTHETIC_API_KEY, etc. — see LLM_ENV_KEYS) is also forwarded into the
 *   sandbox env. Unset keys are skipped. Belt-and-suspenders alongside the
 *   auth.json upload — pi will resolve from whichever source it prefers.
 */

import { Daytona } from "@daytona/sdk";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSandboxEnv, requireEnv } from "./env.ts";

loadSandboxEnv();

const REMOTE_REPO_DIR = "/opt/fucc";
const DEFAULT_SNAPSHOT_BASE = "fucc-pi-harness-v1";

// Host-side ~/.pi state we mirror into the sandbox. Pi reads OAuth refresh
// tokens (openai-codex, claude pro/max, github copilot) AND API keys for
// non-subscription providers from auth.json. models.json holds custom
// provider definitions (home-server endpoints, opencode gateway, etc.).
// We skip anything that doesn't exist locally.
const HOST_PI_DIR = join(homedir(), ".pi", "agent");
const SANDBOX_PI_DIR = "/root/.pi/agent";
const PI_STATE_FILES = ["auth.json", "models.json"] as const;

function resolveSnapshotName(): string {
  if (process.env.FUCC_SNAPSHOT_NAME) return process.env.FUCC_SNAPSHOT_NAME;
  const base = process.env.FUCC_SNAPSHOT_BASE ?? DEFAULT_SNAPSHOT_BASE;
  const version = process.argv[2] ?? process.env.FUCC_SNAPSHOT_VERSION;
  return version ? `${base}-${version}` : base;
}

// Provider credentials forwarded from the host env into the sandbox.
// Anything unset on the host is simply not passed through.
const LLM_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "SYNTHETIC_API_KEY",
  "ZEN_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY",
] as const;

function collectLlmEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LLM_ENV_KEYS) {
    const val = process.env[key];
    if (val) out[key] = val;
  }
  return out;
}

function log(msg: string): void {
  console.log(`[fucc-sandbox] ${msg}`);
}

async function main() {
  const apiUrl = process.env.DAYTONA_API_URL ?? "http://localhost:3000/api";
  const apiKey = requireEnv("DAYTONA_API_KEY");
  const snapshotName = resolveSnapshotName();

  log(`connecting to daytona at ${apiUrl}`);
  const daytona = new Daytona({ apiUrl, apiKey });

  // Fail fast with a useful message if the snapshot hasn't been built yet.
  try {
    await daytona.snapshot.get(snapshotName);
    log(`using snapshot: ${snapshotName}`);
  } catch {
    const version = process.argv[2] ?? process.env.FUCC_SNAPSHOT_VERSION ?? "";
    console.error(
      `[fucc-sandbox] snapshot "${snapshotName}" not found.\n` +
        `Build it first:\n` +
        `  bun sandbox/build-snapshot.ts${version ? ` ${version}` : ""}\n` +
        `or override with FUCC_SNAPSHOT_NAME=<existing-snapshot>.`,
    );
    process.exit(1);
  }

  const llmEnv = collectLlmEnv();
  const forwarded = Object.keys(llmEnv);
  if (forwarded.length === 0) {
    log("warning: no LLM credentials found on host — pi will start but won't have a provider");
  } else {
    log(`forwarding ${forwarded.length} credential(s) to sandbox: ${forwarded.join(", ")}`);
  }

  log("creating sandbox from snapshot");
  const sandbox = await daytona.create(
    {
      snapshot: snapshotName,
      labels: { purpose: "fucc-harness-test" },
      envVars: {
        // Make sure pi can find its config dir (matches Dockerfile's HOME).
        HOME: "/root",
        ...llmEnv,
      },
      autoStopInterval: 60,
      autoArchiveInterval: 60,
      autoDeleteInterval: -1,
    },
    { timeout: 0 },
  );

  log(`sandbox ready: id=${sandbox.id} state=${sandbox.state}`);

  await injectPiState(sandbox);

  log("smoke test:");
  await runAndPrint(sandbox, "which pi && pi --version");
  await runAndPrint(
    sandbox,
    // One line per tool: prints "<name>: <version>" or "<name>: MISSING".
    [
      "for cmd in pi agent-browser ffmpeg fd ast-grep ctags difft rg; do",
      '  if command -v "$cmd" >/dev/null 2>&1; then',
      '    printf "%-14s %s\\n" "$cmd:" "$($cmd --version 2>&1 | head -n1)";',
      "  else",
      '    printf "%-14s MISSING\\n" "$cmd:";',
      "  fi;",
      "done",
    ].join(" "),
  );
  await runAndPrint(sandbox, `ls -la ${REMOTE_REPO_DIR}`);
  await runAndPrint(sandbox, "ls -la /root/.pi/agent");
  await runAndPrint(sandbox, "ls -la /root/.pi/agent/extensions || true");
  await runAndPrint(sandbox, "pi list || true");

  log("=".repeat(60));
  log(`Sandbox ID:   ${sandbox.id}`);
  log(`Snapshot:     ${snapshotName}`);
  log(`Repo path:    ${REMOTE_REPO_DIR}`);
  log(`pi binary:    /usr/local/bin/pi`);
  log(`harness root: /root/.pi/agent (symlinks back to ${REMOTE_REPO_DIR})`);
  log("=".repeat(60));

  if (process.env.FUCC_KEEP_SANDBOX) {
    log("FUCC_KEEP_SANDBOX set — leaving sandbox running");
  } else {
    log("auto-delete disabled; stop manually with `daytona stop` when done");
  }
}

async function injectPiState(
  sandbox: Awaited<ReturnType<Daytona["create"]>>,
): Promise<void> {
  if (process.env.FUCC_SKIP_PI_AUTH) {
    log("FUCC_SKIP_PI_AUTH set — skipping ~/.pi/* upload");
    return;
  }
  const present = PI_STATE_FILES.filter((name) =>
    existsSync(join(HOST_PI_DIR, name)),
  );
  if (present.length === 0) {
    log(`no ~/.pi/{${PI_STATE_FILES.join(",")}} found on host — nothing to inject`);
    return;
  }

  // The snapshot's install.sh already created /root/.pi/agent during build,
  // but mkdir -p is cheap insurance.
  await sandbox.process.executeCommand(`mkdir -p ${SANDBOX_PI_DIR}`);

  for (const name of present) {
    const hostPath = join(HOST_PI_DIR, name);
    const remotePath = `${SANDBOX_PI_DIR}/${name}`;
    log(`uploading ${hostPath} -> ${remotePath}`);
    await sandbox.fs.uploadFile(readFileSync(hostPath), remotePath);
    // auth.json holds OAuth refresh tokens; lock it down on the sandbox side
    // to mirror typical host perms (0600).
    await sandbox.process.executeCommand(`chmod 600 ${remotePath}`);
  }
}

async function runAndPrint(
  sandbox: Awaited<ReturnType<Daytona["create"]>>,
  command: string,
  cwd?: string,
): Promise<void> {
  const res = await sandbox.process.executeCommand(command, cwd);
  if (res.result) process.stdout.write(res.result);
  if (typeof res.exitCode === "number" && res.exitCode !== 0) {
    throw new Error(`command failed (${res.exitCode}): ${command}`);
  }
}

main().catch((err) => {
  console.error("[fucc-sandbox] failed:", err);
  process.exit(1);
});
