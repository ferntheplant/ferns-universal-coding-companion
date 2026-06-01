#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_BASE_URL = "https://cloud.langfuse.com";
const DEFAULT_HARNESS = "codex";
const MAX_TEXT_LENGTH = 20_000;

export async function getConfig(env = process.env) {
  const configPath = nonEmpty(env.CODEX_LANGFUSE_CONFIG) ?? defaultConfigPath();
  const fileConfig = await readConfigFile(configPath);
  const publicKey = nonEmpty(env.LANGFUSE_PUBLIC_KEY) ?? nonEmpty(fileConfig.publicKey);
  const secretKey = nonEmpty(env.LANGFUSE_SECRET_KEY) ?? nonEmpty(fileConfig.secretKey);
  const baseUrl = stripTrailingSlash(
    nonEmpty(env.LANGFUSE_BASE_URL) ??
      nonEmpty(env.LANGFUSE_HOST) ??
      nonEmpty(env.LANGFUSE_BASEURL) ??
      nonEmpty(fileConfig.baseUrl) ??
      DEFAULT_BASE_URL,
  );

  return {
    publicKey,
    secretKey,
    baseUrl,
    environment:
      nonEmpty(env.LANGFUSE_ENVIRONMENT) ??
      nonEmpty(env.CODEX_LANGFUSE_ENVIRONMENT) ??
      nonEmpty(fileConfig.environment),
    userId: nonEmpty(env.CODEX_LANGFUSE_USER_ID) ?? nonEmpty(fileConfig.userId) ?? nonEmpty(env.USER),
    release: nonEmpty(env.CODEX_LANGFUSE_RELEASE) ?? nonEmpty(fileConfig.release),
    version: nonEmpty(env.CODEX_LANGFUSE_VERSION) ?? nonEmpty(fileConfig.version),
    harness: nonEmpty(env.CODEX_LANGFUSE_HARNESS) ?? nonEmpty(fileConfig.harness) ?? DEFAULT_HARNESS,
    debug: envFlag(env.CODEX_LANGFUSE_DEBUG) ?? configFlag(fileConfig.debug) ?? false,
    stateDir: nonEmpty(env.CODEX_LANGFUSE_STATE_DIR) ?? nonEmpty(fileConfig.stateDir) ?? defaultStateDir(),
    includePreToolUse:
      envFlag(env.CODEX_LANGFUSE_INCLUDE_PRE_TOOL_USE) ?? configFlag(fileConfig.includePreToolUse) ?? false,
    configPath,
  };
}

async function getGitContext(cwd) {
  async function git(...args) {
    try {
      const { stdout } = await execFileAsync("git", args, { cwd, timeout: 3000 });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  const [remote, branch, commit] = await Promise.all([
    git("remote", "get-url", "origin"),
    git("branch", "--show-current"),
    git("rev-parse", "--short", "HEAD"),
  ]);

  const repo = remote
    ? (remote.match(/\/([^/]+?)(?:\.git)?$/)?.[1] ?? basename(cwd))
    : basename(cwd);

  return compactObject({ repo, repoRemote: remote, gitBranch: branch, gitCommit: commit });
}

export async function handleHookPayload(payload, options = {}) {
  const config = options.config ?? (await getConfig());
  const transport = options.transport ?? sendToLangfuse;
  const stateStore = options.stateStore ?? fileStateStore(config.stateDir);
  const timestamp = options.now?.() ?? new Date().toISOString();

  if (!config.publicKey || !config.secretKey) {
    debug(config, "Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY; skipping Langfuse ingestion.");
    return { skipped: "missing-credentials" };
  }

  const sessionId = getString(payload.session_id) ?? "unknown-session";
  const eventName = getString(payload.hook_event_name) ?? "Unknown";
  const turnId = getString(payload.turn_id);
  const state = await stateStore.read(sessionId);
  const batch = [];

  // Extract git context stored at SessionStart
  const sessionCtx = state.session?.gitContext ?? {};
  const model = getString(payload.model);

  if (eventName === "SessionStart") {
    const cwd = getString(payload.cwd) ?? process.cwd();
    const gitContext = await getGitContext(cwd);
    state.session = {
      id: sessionId,
      startedAt: timestamp,
      cwd,
      model,
      source: getString(payload.source),
      transcriptPath: getString(payload.transcript_path),
      gitContext,
    };
    batch.push(traceEvent("codex-session-start", payload, sessionTraceId(sessionId), config, timestamp, {}, gitContext));
  }

  if (eventName === "UserPromptSubmit" && turnId) {
    const traceId = turnTraceId(sessionId, turnId);
    const prompt = truncate(getString(payload.prompt) ?? "");
    state.turns[turnId] = {
      traceId,
      prompt,
      startedAt: timestamp,
      model,
      toolCount: 0,
      errorCount: 0,
    };
    batch.push(traceCreate(traceId, "codex:turn", payload, config, timestamp, { input: prompt }, sessionCtx));
    batch.push(traceEvent("codex-user-prompt", payload, traceId, config, timestamp, { input: prompt }, sessionCtx));
  }

  if (eventName === "PreToolUse" && turnId && config.includePreToolUse) {
    const traceId = ensureTurn(state, sessionId, turnId, payload, timestamp).traceId;
    batch.push(traceEvent("codex-tool-start", payload, traceId, config, timestamp, {
      input: payload.tool_input,
      metadata: toolMetadata(payload),
    }, sessionCtx));
  }

  if (eventName === "PostToolUse" && turnId) {
    const turn = ensureTurn(state, sessionId, turnId, payload, timestamp);
    turn.toolCount = (turn.toolCount ?? 0) + 1;
    if (isErrorToolResponse(payload.tool_response)) {
      turn.errorCount = (turn.errorCount ?? 0) + 1;
    }
    batch.push(traceEvent("codex-tool-result", payload, turn.traceId, config, timestamp, {
      input: payload.tool_input,
      output: payload.tool_response,
      level: isErrorToolResponse(payload.tool_response) ? "ERROR" : "DEFAULT",
      metadata: toolMetadata(payload),
    }, sessionCtx));
  }

  if (eventName === "Stop" && turnId) {
    const turn = ensureTurn(state, sessionId, turnId, payload, timestamp);
    const output = truncate(getString(payload.last_assistant_message) ?? "");
    turn.output = output;
    turn.endedAt = timestamp;
    const level = payload.stop_hook_active === true ? "WARNING" : "DEFAULT";
    batch.push(traceCreate(turn.traceId, "codex:turn", payload, config, timestamp, {
      input: turn.prompt,
      output,
      level,
    }, sessionCtx));
    batch.push(generationCreate(turn, payload, config, timestamp, level, sessionCtx));

    // Emit evaluation scores
    const toolCount = turn.toolCount ?? 0;
    const errorCount = turn.errorCount ?? 0;
    const successRate = toolCount > 0 ? (toolCount - errorCount) / toolCount : 1;
    batch.push(scoreCreate("tool_call_count", toolCount, turn.traceId, config, timestamp));
    batch.push(scoreCreate("turn_count", 1, turn.traceId, config, timestamp));
    batch.push(scoreCreate("tool_success_rate", successRate, turn.traceId, config, timestamp));
    batch.push(scoreCreate("session_had_errors", errorCount > 0 ? 1 : 0, turn.traceId, config, timestamp));
  }

  if (eventName === "SessionEnd") {
    batch.push(traceEvent("codex-session-end", payload, sessionTraceId(sessionId), config, timestamp, {}, sessionCtx));
    state.endedAt = timestamp;
  }

  if (batch.length > 0) {
    await transport(config, { batch, metadata: { source: "codex-langfuse" } });
  }

  if (eventName === "SessionEnd") {
    await stateStore.remove(sessionId);
  } else {
    await stateStore.write(sessionId, state);
  }

  return { sent: batch.length };
}

export async function sendToLangfuse(config, body) {
  const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
  const response = await fetch(`${config.baseUrl}/api/public/ingestion`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "x-langfuse-sdk-name": "codex-langfuse",
      "x-langfuse-public-key": config.publicKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok && response.status !== 207) {
    const text = await response.text().catch(() => "");
    throw new Error(`Langfuse ingestion failed: HTTP ${response.status} ${text}`.trim());
  }
}

function buildTraceTags(config, model, sessionCtx = {}) {
  return uniqueTags([
    `harness:${config.harness ?? DEFAULT_HARNESS}`,
    model ? `model:${model}` : undefined,
    sessionCtx.repo ? `repo:${sessionCtx.repo}` : undefined,
  ].filter(v => v !== undefined));
}

function traceCreate(traceId, name, payload, config, timestamp, overrides = {}, sessionCtx = {}) {
  const model = getString(payload.model);
  return {
    id: randomUUID(),
    type: "trace-create",
    timestamp,
    body: compactObject({
      id: traceId,
      timestamp,
      name,
      sessionId: getString(payload.session_id),
      userId: config.userId,
      input: safeJson(overrides.input),
      output: safeJson(overrides.output),
      level: overrides.level,
      tags: buildTraceTags(config, model, sessionCtx),
      environment: config.environment,
      release: config.release,
      version: config.version,
      metadata: baseMetadata(payload, config, sessionCtx),
    }),
  };
}

function traceEvent(name, payload, traceId, config, timestamp, overrides = {}, sessionCtx = {}) {
  return {
    id: randomUUID(),
    type: "event-create",
    timestamp,
    body: compactObject({
      id: randomUUID(),
      traceId,
      name,
      startTime: timestamp,
      input: safeJson(overrides.input),
      output: safeJson(overrides.output),
      level: overrides.level,
      metadata: { ...baseMetadata(payload, config, sessionCtx), ...overrides.metadata },
      environment: config.environment,
    }),
  };
}

function generationCreate(turn, payload, config, timestamp, level, sessionCtx = {}) {
  return {
    id: randomUUID(),
    type: "generation-create",
    timestamp,
    body: compactObject({
      id: observationId(turn.traceId, "generation"),
      traceId: turn.traceId,
      name: "codex:generation",
      startTime: turn.startedAt,
      endTime: turn.endedAt ?? timestamp,
      model: turn.model ?? getString(payload.model),
      input: safeJson(turn.prompt),
      output: safeJson(turn.output),
      level,
      metadata: baseMetadata(payload, config, sessionCtx),
      environment: config.environment,
    }),
  };
}

function scoreCreate(name, value, traceId, config, timestamp) {
  return {
    id: randomUUID(),
    type: "score-create",
    timestamp,
    body: compactObject({
      traceId,
      name,
      value,
      dataType: name === "session_had_errors" ? "BOOLEAN" : "NUMERIC",
      environment: config.environment,
    }),
  };
}

function ensureTurn(state, sessionId, turnId, payload, timestamp) {
  state.turns[turnId] ??= {
    traceId: turnTraceId(sessionId, turnId),
    prompt: undefined,
    startedAt: timestamp,
    model: getString(payload.model),
    toolCount: 0,
    errorCount: 0,
  };
  return state.turns[turnId];
}

function baseMetadata(payload, config, sessionCtx = {}) {
  return compactObject({
    harness: config.harness,
    sessionId: getString(payload.session_id),
    cwd: getString(payload.cwd),
    model: getString(payload.model),
    // git context
    ...sessionCtx,
    // codex-specific fields
    codexSessionId: getString(payload.session_id),
    codexTurnId: getString(payload.turn_id),
    codexHookEventName: getString(payload.hook_event_name),
    codexToolName: getString(payload.tool_name),
    codexToolUseId: getString(payload.tool_use_id),
    permissionMode: getString(payload.permission_mode),
    transcriptPath: getString(payload.transcript_path),
    source: getString(payload.source),
  });
}

function toolMetadata(payload) {
  return compactObject({
    toolName: getString(payload.tool_name),
    toolUseId: getString(payload.tool_use_id),
  });
}

function isErrorToolResponse(response) {
  if (response && typeof response === "object") {
    if (response.is_error === true || response.error === true) return true;
    if (typeof response.exit_code === "number" && response.exit_code !== 0) return true;
    if (typeof response.exitCode === "number" && response.exitCode !== 0) return true;
  }
  return false;
}

function fileStateStore(stateDir) {
  return {
    async read(sessionId) {
      try {
        const raw = await readFile(statePath(stateDir, sessionId), "utf8");
        const parsed = JSON.parse(raw);
        return {
          turns: parsed.turns && typeof parsed.turns === "object" ? parsed.turns : {},
          session: parsed.session,
          endedAt: parsed.endedAt,
        };
      } catch {
        return { turns: {} };
      }
    },
    async write(sessionId, state) {
      await mkdir(stateDir, { recursive: true });
      await writeFile(statePath(stateDir, sessionId), JSON.stringify(state), "utf8");
    },
    async remove(sessionId) {
      await rm(statePath(stateDir, sessionId), { force: true });
    },
  };
}

async function readConfigFile(path) {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function defaultConfigPath() {
  return join(defaultStateDir(), "config.json");
}

function defaultStateDir() {
  return join(homedir(), ".codex", "codex-langfuse");
}

function statePath(stateDir, sessionId) {
  return join(stateDir, `${safeFileName(sessionId)}.json`);
}

function turnTraceId(sessionId, turnId) {
  return hashId(`codex-turn:${sessionId}:${turnId}`);
}

function sessionTraceId(sessionId) {
  return hashId(`codex-session:${sessionId}`);
}

function observationId(traceId, suffix) {
  return hashId(`${traceId}:${suffix}`);
}

function hashId(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

function safeJson(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return truncate(value);
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_TEXT_LENGTH) return value;
  return {
    truncated: true,
    preview: truncate(serialized),
  };
}

function truncate(value) {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}... [truncated]` : value;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

function uniqueTags(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function envFlag(value) {
  if (value === undefined) return undefined;
  return value === "1" || value === "true";
}

function configFlag(value) {
  return typeof value === "boolean" ? value : undefined;
}

function getString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function debug(config, message) {
  if (config.debug) {
    console.error(`[codex-langfuse] ${message}`);
  }
}

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    await handleHookPayload(JSON.parse(raw));
  } catch (error) {
    const config = await getConfig();
    debug(config, error instanceof Error ? error.message : String(error));
  }
}
