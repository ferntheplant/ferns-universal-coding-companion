/**
 * Provision a Daytona sandbox prepared to host work on an external app.
 *
 * Caller hands us a config describing the app (private repo, env files,
 * init script, dev servers); we hand back a Daytona Sandbox handle that
 * a Flue agent can wrap with the daytona() connector.
 *
 * Steps, in order:
 *   1. Create the sandbox from the prebuilt snapshot (sandbox/Dockerfile).
 *   2. Inject ~/.pi/agent/{auth,models}.json so Pi inherits host creds.
 *      (Shared with run-sandbox.ts — see sandbox/README.md for context.)
 *   3. Inject ~/.config/gh/hosts.yml so `gh` inside the sandbox is logged
 *      in as you, then `gh repo clone` the private app.
 *   4. Upload `.env.local` (and any other env files) from host paths to
 *      paths inside the cloned repo.
 *   5. `mise install` inside the repo (respects mise.toml / .tool-versions).
 *   6. Run the app's init command (`bun install`, repo's own setup, etc.).
 *   7. Start each dev server in the background with `nohup`, capturing
 *      stdout/stderr to /var/log/app/<name>.log and PIDs to /run/app/<name>.pid.
 *
 * Lifecycle: per Flue docs, "your application owns creation, retention,
 * and deletion" — provisionAppSandbox() creates; the caller is on the
 * hook for stopping/deleting when done.
 */

import { Daytona, type Sandbox } from "@daytona/sdk";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSandboxEnv, requireEnv } from "./env.ts";

loadSandboxEnv();

const DEFAULT_SNAPSHOT_BASE = "fucc-pi-harness";
const HOST_PI_DIR = join(homedir(), ".pi", "agent");
const SANDBOX_PI_DIR = "/root/.pi/agent";
/**
 * Files (and sub-paths) under ~/.pi/agent/ to mirror into the sandbox.
 *
 *   - auth.json:                 OAuth refresh tokens + provider API keys.
 *   - models.json:               Custom provider/model definitions.
 *   - pi-langfuse/config.json:   Langfuse host + keys for the pi-langfuse
 *                                extension; without it the extension blocks
 *                                Pi startup waiting for first-run setup.
 *
 * Add other extension configs here as needed. Anything written here is
 * uploaded with 0600 perms.
 */
const PI_STATE_FILES = [
  "auth.json",
  "models.json",
  "pi-langfuse/config.json",
] as const;

// Same forwarded-key list as run-sandbox.ts. If you change one, change both —
// or extract this to a shared module once a third caller shows up.
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

export interface AppEnvFile {
  /** Path on the host machine. Resolved relative to HOME if it starts with `~`. */
  hostPath: string;
  /** Path inside the sandbox. Resolved relative to the cloned repo if relative. */
  sandboxPath: string;
}

export interface AppDevServer {
  /** Stable, filesystem-safe name. Used for log + PID file names. */
  name: string;
  /** Shell command to run from inside the repo dir. */
  command: string;
}

export interface AppSandboxConfig {
  /** `owner/repo`, e.g. "with-co/my-app". */
  repo: string;
  /** Optional branch / ref to check out after clone. Default: repo default. */
  branch?: string;
  /** Absolute path inside the sandbox where the repo gets cloned. */
  cloneDir: string;
  /** Files to upload from host → sandbox after clone. */
  envFiles?: AppEnvFile[];
  /**
   * Command (or commands) to run after `mise install`, before starting dev
   * servers. Runs from the repo dir with mise activated. Multi-step setups
   * can chain with `&&` or pass an array.
   */
  initCommand?: string | string[];
  /** Long-running dev servers to start in the background. */
  devServers?: AppDevServer[];
  /** Override snapshot name. Default: $FUCC_SNAPSHOT_BASE-$FUCC_SNAPSHOT_VERSION or "fucc-pi-harness". */
  snapshotName?: string;
  /** Set true to skip the ~/.pi auth upload. Default: respects FUCC_SKIP_PI_AUTH env. */
  skipPiAuth?: boolean;
}

export interface ProvisionedSandbox {
  sandbox: Sandbox;
  /** Inside-sandbox absolute path of the cloned repo. Same as config.cloneDir. */
  repoDir: string;
  /** Inside-sandbox path of dev-server log dir, for tailing later. */
  logDir: string;
}

function log(msg: string): void {
  console.log(`[provision] ${msg}`);
}

/**
 * Stable label set we tag every app sandbox with. Used to look an existing
 * one up later (by repo) without remembering a sandbox ID.
 */
export function appSandboxLabels(repo: string): Record<string, string> {
  return { purpose: "flue-app-worker", repo };
}

/** Daytona client built from env (DAYTONA_API_KEY, DAYTONA_API_URL). */
export function buildDaytonaClient(): Daytona {
  const apiUrl = process.env.DAYTONA_API_URL ?? "http://localhost:3000/api";
  const apiKey = requireEnv("DAYTONA_API_KEY");
  return new Daytona({ apiUrl, apiKey });
}

/**
 * Look up an existing sandbox we previously provisioned for `repo`.
 * Returns the first match (any state) or null.
 */
export async function findExistingAppSandbox(
  daytona: Daytona,
  repo: string,
): Promise<Sandbox | null> {
  for await (const sandbox of daytona.list({ labels: appSandboxLabels(repo) })) {
    return sandbox;
  }
  return null;
}

function resolveSnapshotName(override?: string): string {
  if (override) return override;
  if (process.env.FUCC_SNAPSHOT_NAME) return process.env.FUCC_SNAPSHOT_NAME;
  const base = process.env.FUCC_SNAPSHOT_BASE ?? DEFAULT_SNAPSHOT_BASE;
  const version = process.env.FUCC_SNAPSHOT_VERSION;
  return version ? `${base}-${version}` : base;
}

function collectLlmEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LLM_ENV_KEYS) {
    const v = process.env[key];
    if (v) out[key] = v;
  }
  return out;
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** Quote a string for safe use inside double-quoted bash. */
function shq(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Run a shell command inside the sandbox; throw with the command in the
 * message if it exits non-zero. Prints stdout/stderr live-ish (Daytona's
 * executeCommand buffers, but we re-emit).
 */
async function exec(
  sandbox: Sandbox,
  command: string,
  cwd?: string,
): Promise<string> {
  const res = await sandbox.process.executeCommand(command, cwd);
  if (res.result) process.stdout.write(res.result);
  if (typeof res.exitCode === "number" && res.exitCode !== 0) {
    throw new Error(
      `sandbox command failed (exit ${res.exitCode}): ${command}${cwd ? ` (cwd=${cwd})` : ""}`,
    );
  }
  return res.result ?? "";
}

async function injectPiAuth(sandbox: Sandbox, skip: boolean): Promise<void> {
  if (skip) {
    log("skipping ~/.pi auth upload (skipPiAuth=true)");
    return;
  }
  const present = PI_STATE_FILES.filter((f) =>
    existsSync(join(HOST_PI_DIR, f)),
  );
  if (present.length === 0) {
    log(`no ~/.pi/agent/{${PI_STATE_FILES.join(",")}} on host — nothing to inject`);
    return;
  }
  await exec(sandbox, `mkdir -p ${SANDBOX_PI_DIR}`);
  for (const f of present) {
    const remote = `${SANDBOX_PI_DIR}/${f}`;
    // Sub-paths like "pi-langfuse/config.json" need their parent dir created.
    const parent = remote.replace(/\/[^/]+$/, "");
    if (parent && parent !== SANDBOX_PI_DIR) {
      await exec(sandbox, `mkdir -p ${shq(parent)}`);
    }
    const sourcePath = join(HOST_PI_DIR, f);
    let content: Buffer = readFileSync(sourcePath);
    if (f === "pi-langfuse/config.json") {
      content = rewriteLangfuseHostForSandbox(content);
    }
    log(`uploading ${sourcePath} -> ${remote}`);
    await sandbox.fs.uploadFile(content, remote);
    await exec(sandbox, `chmod 600 ${remote}`);
  }
}

/**
 * Rewrite the Langfuse host inside pi-langfuse/config.json when it points
 * at a tailnet (`*.ts.net`) hostname.
 *
 * The sandbox can't resolve tailscale names (tailscaled lives on the host,
 * two namespaces away). The documented workaround in sandbox/README.md is
 * a caddy reverse-proxy on the host: `caddy reverse-proxy --from :PORT
 * --to https://<tailnet-host>:PORT`. From inside the sandbox, that proxy
 * is reachable at `host.docker.internal:PORT` over plain HTTP — caddy is
 * the TLS terminator.
 *
 * If the host is anything other than `*.ts.net`, the config is uploaded
 * untouched.
 */
function rewriteLangfuseHostForSandbox(buf: Buffer): Buffer {
  let cfg: { host?: string; [k: string]: unknown };
  try {
    cfg = JSON.parse(buf.toString("utf-8"));
  } catch {
    return buf;
  }
  if (typeof cfg.host !== "string") return buf;

  let url: URL;
  try {
    url = new URL(cfg.host);
  } catch {
    return buf;
  }
  if (!url.hostname.endsWith(".ts.net")) return buf;

  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const rewritten = `http://host.docker.internal:${port}`;
  log(
    `langfuse host rewritten for sandbox: ${cfg.host} -> ${rewritten} ` +
      `(needs caddy reverse-proxy on host port ${port} — see sandbox/README.md)`,
  );
  cfg.host = rewritten;
  return Buffer.from(JSON.stringify(cfg, null, 2));
}

/**
 * Read the host's gh CLI token via `gh auth token` and return it.
 *
 * We deliberately do NOT mount `~/.config/gh/hosts.yml` into the sandbox:
 * on a fresh slim Debian image gh tries to migrate older multi-account
 * configs via the system keyring, which shells out to `dbus-launch` and
 * fails because dbus isn't installed. Passing GH_TOKEN as an env var
 * bypasses hosts.yml + keyring entirely — gh just uses the token.
 */
function readHostGhToken(): string {
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf-8" });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "(no stderr)";
    throw new Error(
      `\`gh auth token\` failed on host (exit ${result.status}): ${stderr}\n` +
        `Log in first with: gh auth login`,
    );
  }
  const token = result.stdout.trim();
  if (!token) {
    throw new Error(
      "`gh auth token` returned empty output. Run `gh auth login` on the host.",
    );
  }
  return token;
}

async function cloneRepo(
  sandbox: Sandbox,
  cfg: AppSandboxConfig,
): Promise<void> {
  log(`cloning ${cfg.repo}${cfg.branch ? `@${cfg.branch}` : ""} -> ${cfg.cloneDir}`);
  // Use `git clone` rather than `gh repo clone`. gh has been seen to hit a Go
  // runtime "marked free object" panic inside the sandbox image — likely a
  // libc/arch interaction — and we don't actually need any of gh's smarts
  // here. The token is already in the sandbox env as GH_TOKEN; we splice it
  // into the URL via shell expansion so the literal token never appears in
  // the command string (Daytona's RPC logs the command, not the env).
  // --depth omitted on purpose; dev servers may want history.
  const parent = cfg.cloneDir.replace(/\/[^/]+$/, "") || "/";
  const branchArg = cfg.branch ? `--branch ${shq(cfg.branch)}` : "";
  await exec(
    sandbox,
    `mkdir -p ${shq(parent)} && ` +
      `git clone ${branchArg} ` +
      `"https://x-access-token:$GH_TOKEN@github.com/${cfg.repo}.git" ` +
      `${shq(cfg.cloneDir)}`,
  );
}

async function uploadEnvFiles(
  sandbox: Sandbox,
  cfg: AppSandboxConfig,
): Promise<void> {
  if (!cfg.envFiles || cfg.envFiles.length === 0) return;
  for (const f of cfg.envFiles) {
    const hostPath = expandHome(f.hostPath);
    if (!existsSync(hostPath)) {
      throw new Error(`env file not found on host: ${hostPath}`);
    }
    const sandboxPath = f.sandboxPath.startsWith("/")
      ? f.sandboxPath
      : join(cfg.cloneDir, f.sandboxPath);
    log(`uploading ${hostPath} -> ${sandboxPath}`);
    // mkdir -p the parent in case the repo's gitignore omits the dir.
    const parent = sandboxPath.replace(/\/[^/]+$/, "");
    if (parent) await exec(sandbox, `mkdir -p ${shq(parent)}`);
    await sandbox.fs.uploadFile(readFileSync(hostPath), sandboxPath);
    await exec(sandbox, `chmod 600 ${shq(sandboxPath)}`);
  }
}

/**
 * Wrap a command so it runs under mise-managed tool versions. Uses
 * `mise exec` rather than `mise activate` because activate needs an
 * interactive shell init; exec is a one-shot wrapper.
 *
 * Note: `bash -c`, NOT `bash -lc`. A login shell sources /etc/profile +
 * /root/.profile, which on Debian reset PATH to a system default that
 * does *not* include /root/.local/bin — so the inner shell can't find
 * mise or anything we put under ~/.local. Non-login shell preserves the
 * PATH we set in the sandbox envVars.
 */
function withMise(command: string): string {
  return `mise exec -- bash -c ${shq(command)}`;
}

async function miseInstall(sandbox: Sandbox, repoDir: string): Promise<void> {
  // Sanity: fail loud if mise isn't on PATH. Catches snapshot/PATH drift
  // before the more cryptic `mise install` error.
  const which = await sandbox.process.executeCommand(
    "command -v mise || echo MISSING",
  );
  if ((which.result ?? "").trim() === "MISSING") {
    throw new Error(
      `mise not on PATH in the sandbox. Either the snapshot was built ` +
        `without the mise layer (rebuild with FUCC_FORCE_REBUILD=1 ` +
        `bun sandbox/build-snapshot.ts) or PATH didn't propagate ` +
        `(check envVars in provision.ts).`,
    );
  }

  log(`mise install in ${repoDir}`);
  // mise refuses untrusted config by default; trust the repo's mise.toml
  // (and any nested ones) before install. `mise trust --all` is a no-op
  // when there's nothing to trust, so this stays safe for mise-less repos.
  await exec(sandbox, "mise trust --all", repoDir);
  await exec(sandbox, "mise install", repoDir);
}

async function runInit(sandbox: Sandbox, cfg: AppSandboxConfig): Promise<void> {
  if (!cfg.initCommand) return;
  const cmds = Array.isArray(cfg.initCommand) ? cfg.initCommand : [cfg.initCommand];
  for (const c of cmds) {
    log(`init: ${c}`);
    await exec(sandbox, withMise(c), cfg.cloneDir);
  }
}

async function startDevServers(
  sandbox: Sandbox,
  cfg: AppSandboxConfig,
  logDir: string,
): Promise<void> {
  if (!cfg.devServers || cfg.devServers.length === 0) return;
  await exec(sandbox, `mkdir -p ${shq(logDir)} /run/app`);
  for (const s of cfg.devServers) {
    const logFile = `${logDir}/${s.name}.log`;
    const pidFile = `/run/app/${s.name}.pid`;
    log(`starting dev server "${s.name}": ${s.command}`);
    // nohup + setsid detaches from the executeCommand session; otherwise
    // Daytona kills the process when this RPC returns.
    const wrapped = withMise(s.command);
    await exec(
      sandbox,
      `setsid bash -c ${shq(
        `nohup ${wrapped} >${shq(logFile)} 2>&1 & echo $! > ${shq(pidFile)}`,
      )} < /dev/null > /dev/null 2>&1`,
      cfg.cloneDir,
    );
    // Sanity check: read the PID back. If it's empty the nohup failed.
    const pid = (await exec(sandbox, `cat ${shq(pidFile)} 2>/dev/null || true`)).trim();
    if (!pid) {
      throw new Error(
        `dev server "${s.name}" failed to start — check ${logFile} via the agent.`,
      );
    }
    log(`  pid=${pid} log=${logFile}`);
  }
}

/**
 * Create + prepare a Daytona sandbox for app work. Caller is responsible
 * for `sandbox.delete()` (or relying on Daytona auto-stop) when done.
 */
export async function provisionAppSandbox(
  cfg: AppSandboxConfig,
): Promise<ProvisionedSandbox> {
  const snapshotName = resolveSnapshotName(cfg.snapshotName);
  log(`connecting to daytona`);
  const daytona = buildDaytonaClient();

  try {
    await daytona.snapshot.get(snapshotName);
  } catch {
    throw new Error(
      `snapshot "${snapshotName}" not found. Build it with:\n` +
        `  bun sandbox/build-snapshot.ts\n` +
        `or override with FUCC_SNAPSHOT_NAME / cfg.snapshotName.`,
    );
  }

  const llmEnv = collectLlmEnv();
  const ghToken = readHostGhToken();
  log(`creating sandbox from snapshot "${snapshotName}"`);
  const sandbox = await daytona.create(
    {
      snapshot: snapshotName,
      labels: appSandboxLabels(cfg.repo),
      envVars: {
        HOME: "/root",
        // Bypasses gh's hosts.yml + keyring migration path — see readHostGhToken.
        GH_TOKEN: ghToken,
        // Explicit PATH because Daytona's executeCommand env doesn't reliably
        // inherit the Dockerfile ENV PATH. Mirror what the image sets so
        // /root/.local/bin (mise) + /root/.bun/bin are on PATH.
        PATH: "/root/.local/bin:/root/.local/share/mise/shims:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin",
        ...llmEnv,
      },
      autoStopInterval: 60,
      autoArchiveInterval: 60,
      autoDeleteInterval: -1,
    },
    { timeout: 0 },
  );
  log(`sandbox ready: id=${sandbox.id} state=${sandbox.state}`);

  const skipPi =
    cfg.skipPiAuth ?? Boolean(process.env.FUCC_SKIP_PI_AUTH);
  await injectPiAuth(sandbox, skipPi);
  await cloneRepo(sandbox, cfg);
  await uploadEnvFiles(sandbox, cfg);
  await miseInstall(sandbox, cfg.cloneDir);
  await runInit(sandbox, cfg);

  const logDir = "/var/log/app";
  await startDevServers(sandbox, cfg, logDir);

  log(`provisioned: repo=${cfg.cloneDir} logs=${logDir}`);
  return { sandbox, repoDir: cfg.cloneDir, logDir };
}

/**
 * Return an existing app sandbox if one is healthy; otherwise provision
 * fresh. Used by sandbox/provision-tycho.ts (and any future per-app CLIs)
 * so the slow provision path runs once and subsequent invocations are
 * near-instant.
 *
 * "Healthy" = exists, state === "started". Stopped/archived/errored
 * sandboxes are left in place (so you can inspect them) and a new one is
 * provisioned alongside. If that gets noisy, add a --recreate flag and
 * delete the dead one first.
 */
export async function findOrProvisionAppSandbox(
  cfg: AppSandboxConfig,
): Promise<ProvisionedSandbox> {
  const daytona = buildDaytonaClient();
  const existing = await findExistingAppSandbox(daytona, cfg.repo);
  if (existing && existing.state === "started") {
    log(`reusing running sandbox ${existing.id} for ${cfg.repo}`);
    return {
      sandbox: existing,
      repoDir: cfg.cloneDir,
      logDir: "/var/log/app",
    };
  }
  if (existing) {
    log(
      `existing sandbox ${existing.id} is in state="${existing.state}" — ` +
        `provisioning a fresh one. Delete the stale one with daytona stop/delete ` +
        `if you want to keep things tidy.`,
    );
  }
  return provisionAppSandbox(cfg);
}
