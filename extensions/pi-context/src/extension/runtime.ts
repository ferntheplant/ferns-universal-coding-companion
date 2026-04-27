import type {
  BeforeProviderRequestEvent,
  ContextEvent,
  ExtensionContext,
  ToolResultEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionModelSnapshot {
  provider: string | null;
  api: string | null;
  id: string | null;
  baseUrl: string | null;
  contextWindow: number | null;
}

export interface ProviderResponseEventLike {
  status: number;
  headers: Record<string, string>;
}

export interface MessageUpdateEventLike {
  message: unknown;
  assistantMessageEvent: unknown;
}

export interface MessageEndEventLike {
  message: unknown;
}

export interface ModelSelectEventLike {
  model: {
    provider?: string;
    api?: string;
    id?: string;
    baseUrl?: string;
    contextWindow?: number;
  };
}

export interface SessionSnapshot {
  sessionId: string;
  sessionFile: string | null;
  cwd: string;
  systemPrompt: string | null;
  systemPromptSource: "session_start" | "context" | null;
}

export type SidecarLifecycleState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface SpikeTurnRecord {
  schemaVersion: 1;
  capturedAt: string;
  outputPath: string;
  session: SessionSnapshot;
  model: SessionModelSnapshot;
  turn: {
    index: number;
    startedAt: string;
    endedAt: string | null;
  };
  timestamps: {
    extensionStartedAt: string;
    sessionStartedAt: string | null;
    requestStartedAt: string | null;
    responseStartedAt: string | null;
    assistantCompletedAt: string | null;
  };
  contextSnapshot: unknown | null;
  providerRequest: {
    capturedAt: string;
    payload: unknown;
  } | null;
  providerResponse: {
    capturedAt: string;
    status: number;
    headers: Record<string, string>;
  } | null;
  assistantMessageUpdates: Array<{
    capturedAt: string;
    assistantMessageEvent: unknown;
    message: unknown;
  }>;
  finalAssistantMessage: {
    capturedAt: string;
    message: unknown;
  } | null;
  toolResultEvents: Array<{
    capturedAt: string;
    event: unknown;
  }>;
  turnEnd: {
    capturedAt: string;
    message: unknown;
    toolResults: unknown[];
  } | null;
  flushReason: "turn_end" | "session_shutdown" | "reset";
}

interface PendingTurnState {
  turnIndex: number;
  startedAtMs: number;
  startedAtIso: string;
  model: SessionModelSnapshot;
  contextSnapshot: unknown | null;
  requestStartedAtIso: string | null;
  responseStartedAtIso: string | null;
  assistantCompletedAtIso: string | null;
  providerRequest: SpikeTurnRecord["providerRequest"];
  providerResponse: SpikeTurnRecord["providerResponse"];
  assistantMessageUpdates: SpikeTurnRecord["assistantMessageUpdates"];
  finalAssistantMessage: SpikeTurnRecord["finalAssistantMessage"];
  toolResultEvents: SpikeTurnRecord["toolResultEvents"];
  turnEnd: SpikeTurnRecord["turnEnd"];
}

interface SessionState {
  session: SessionSnapshot;
  sessionStartedAtIso: string | null;
  lastModel: SessionModelSnapshot;
  currentTurn: PendingTurnState | null;
}

export interface RuntimeStatus {
  extensionStartedAt: string;
  sidecar: {
    state: SidecarLifecycleState;
    url: string;
    lastError: string | null;
    lastTransitionAt: string;
  };
  sessions: {
    active: number;
    pendingTurns: number;
  };
  debug: {
    captureDir: string;
    persistedFixtures: number;
    failedWrites: number;
    postedCaptures: number;
    failedPosts: number;
  };
}

interface RuntimeState {
  extensionStartedAtMs: number;
  sidecarState: SidecarLifecycleState;
  sidecarLastError: string | null;
  sidecarLastTransitionAtMs: number;
  completedTurnFixtures: number;
  failedWrites: number;
  postedCaptures: number;
  failedPosts: number;
  sessions: Map<string, SessionState>;
}

const SPIKE_DIR = join(homedir(), ".pi", "agent", "state", "pi-context", "spike");
const SIDECAR_URL = "http://127.0.0.1:4041";

const runtimeState: RuntimeState = {
  extensionStartedAtMs: Date.now(),
  sidecarState: "stopped",
  sidecarLastError: null,
  sidecarLastTransitionAtMs: Date.now(),
  completedTurnFixtures: 0,
  failedWrites: 0,
  postedCaptures: 0,
  failedPosts: 0,
  sessions: new Map(),
};

export function getSpikeDir(): string {
  return SPIKE_DIR;
}

export function markWriteFailure(): void {
  runtimeState.failedWrites += 1;
}

export function markTurnPersisted(): void {
  runtimeState.completedTurnFixtures += 1;
}

export function markCapturePosted(): void {
  runtimeState.postedCaptures += 1;
}

export function markPostFailure(): void {
  runtimeState.failedPosts += 1;
}

export function setSidecarState(state: SidecarLifecycleState, errorMessage?: string | null): void {
  runtimeState.sidecarState = state;
  runtimeState.sidecarLastTransitionAtMs = Date.now();
  runtimeState.sidecarLastError = state === "error" ? errorMessage ?? "Unknown sidecar error" : null;
}

function asIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function normalizeSystemPromptCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const asRecord = block as Record<string, unknown>;
    if (typeof asRecord.text === "string") {
      parts.push(asRecord.text);
      continue;
    }
    if (typeof asRecord.thinking === "string") {
      parts.push(asRecord.thinking);
      continue;
    }
    if (typeof asRecord.content === "string") {
      parts.push(asRecord.content);
    }
  }

  return parts.join("\n");
}

function extractSystemPromptFromMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;

  const systemChunks: string[] = [];
  for (const rawMessage of messages) {
    if (!rawMessage || typeof rawMessage !== "object") continue;
    const message = rawMessage as Record<string, unknown>;
    const role = message.role;
    if (role !== "system" && role !== "developer") continue;

    const content = extractTextFromMessageContent(message.content);
    if (content.trim().length > 0) {
      systemChunks.push(content.trim());
    }
  }

  if (systemChunks.length === 0) return null;
  return systemChunks.join("\n\n");
}

function readSessionSystemPrompt(ctx: ExtensionContext): string | null {
  const sessionManager = ctx.sessionManager as unknown as {
    getSystemPrompt?: () => unknown;
  };
  return normalizeSystemPromptCandidate(sessionManager.getSystemPrompt?.());
}

function updateSessionSystemPrompt(
  state: SessionState,
  prompt: string | null,
  source: "session_start" | "context",
): void {
  if (!prompt) return;
  if (state.session.systemPrompt === prompt) return;
  state.session.systemPrompt = prompt;
  state.session.systemPromptSource = source;
}

export function getModelSnapshot(ctx: ExtensionContext): SessionModelSnapshot {
  return {
    provider: ctx.model?.provider ?? null,
    api: ctx.model?.api ?? null,
    id: ctx.model?.id ?? null,
    baseUrl: ctx.model?.baseUrl ?? null,
    contextWindow: ctx.model?.contextWindow ?? null,
  };
}

function getOrCreateSessionState(ctx: ExtensionContext): SessionState {
  const sessionKey = getSessionKey(ctx);
  const existing = runtimeState.sessions.get(sessionKey);
  if (existing) {
    existing.session.cwd = ctx.cwd;
    existing.session.sessionFile = ctx.sessionManager.getSessionFile() ?? null;
    existing.lastModel = getModelSnapshot(ctx);
    return existing;
  }

  const created: SessionState = {
    session: {
      sessionId: sessionKey,
      sessionFile: ctx.sessionManager.getSessionFile() ?? null,
      cwd: ctx.cwd,
      systemPrompt: null,
      systemPromptSource: null,
    },
    sessionStartedAtIso: null,
    lastModel: getModelSnapshot(ctx),
    currentTurn: null,
  };

  runtimeState.sessions.set(sessionKey, created);
  return created;
}

export function startSessionCapture(ctx: ExtensionContext): void {
  const state = getOrCreateSessionState(ctx);
  state.sessionStartedAtIso = new Date().toISOString();
  state.lastModel = getModelSnapshot(ctx);
  updateSessionSystemPrompt(state, readSessionSystemPrompt(ctx), "session_start");
}

export function updateSessionModel(ctx: ExtensionContext, event?: ModelSelectEventLike): void {
  const state = getOrCreateSessionState(ctx);
  state.lastModel = event
    ? {
        provider: event.model.provider ?? null,
        api: event.model.api ?? null,
        id: event.model.id ?? null,
        baseUrl: event.model.baseUrl ?? null,
        contextWindow: event.model.contextWindow ?? null,
      }
    : getModelSnapshot(ctx);
}

export function startTurnCapture(event: TurnStartEvent, ctx: ExtensionContext): void {
  const state = getOrCreateSessionState(ctx);
  const model = getModelSnapshot(ctx);

  state.lastModel = model;
  state.currentTurn = {
    turnIndex: event.turnIndex,
    startedAtMs: event.timestamp,
    startedAtIso: asIso(event.timestamp),
    model,
    contextSnapshot: null,
    requestStartedAtIso: null,
    responseStartedAtIso: null,
    assistantCompletedAtIso: null,
    providerRequest: null,
    providerResponse: null,
    assistantMessageUpdates: [],
    finalAssistantMessage: null,
    toolResultEvents: [],
    turnEnd: null,
  };
}

function getCurrentTurn(ctx: ExtensionContext): PendingTurnState | null {
  const state = getOrCreateSessionState(ctx);
  return state.currentTurn;
}

export function captureContextSnapshot(event: ContextEvent, ctx: ExtensionContext): void {
  const state = getOrCreateSessionState(ctx);
  updateSessionSystemPrompt(
    state,
    extractSystemPromptFromMessages(event.messages),
    "context",
  );

  const turn = getCurrentTurn(ctx);
  if (!turn) return;

  turn.contextSnapshot = toSerializable({
    messages: event.messages,
  });
}

export function captureProviderRequest(event: BeforeProviderRequestEvent, ctx: ExtensionContext): void {
  const turn = getCurrentTurn(ctx);
  if (!turn) return;

  const capturedAt = new Date().toISOString();
  turn.requestStartedAtIso = capturedAt;
  turn.providerRequest = {
    capturedAt,
    payload: toSerializable(event.payload),
  };
  turn.model = getModelSnapshot(ctx);
}

export function captureProviderResponse(event: ProviderResponseEventLike, ctx: ExtensionContext): void {
  const turn = getCurrentTurn(ctx);
  if (!turn) return;

  const capturedAt = new Date().toISOString();
  turn.responseStartedAtIso = capturedAt;
  turn.providerResponse = {
    capturedAt,
    status: event.status,
    headers: toSerializable(event.headers) as Record<string, string>,
  };
}

function getMessageRole(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
}

export function captureAssistantMessageUpdate(event: MessageUpdateEventLike, ctx: ExtensionContext): void {
  const turn = getCurrentTurn(ctx);
  if (!turn) return;
  if (getMessageRole(event.message) !== "assistant") return;

  turn.assistantMessageUpdates.push({
    capturedAt: new Date().toISOString(),
    assistantMessageEvent: toSerializable(event.assistantMessageEvent),
    message: toSerializable(event.message),
  });
}

export function captureMessageEnd(event: MessageEndEventLike, ctx: ExtensionContext): void {
  const turn = getCurrentTurn(ctx);
  if (!turn) return;
  if (getMessageRole(event.message) !== "assistant") return;

  turn.assistantCompletedAtIso = new Date().toISOString();
  turn.finalAssistantMessage = {
    capturedAt: turn.assistantCompletedAtIso,
    message: toSerializable(event.message),
  };
}

export function captureToolResult(event: ToolResultEvent, ctx: ExtensionContext): void {
  const turn = getCurrentTurn(ctx);
  if (!turn) return;

  turn.toolResultEvents.push({
    capturedAt: new Date().toISOString(),
    event: toSerializable(event),
  });
}

export function captureTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): SpikeTurnRecord | null {
  const state = getOrCreateSessionState(ctx);
  const turn = state.currentTurn;
  if (!turn) return null;

  turn.turnEnd = {
    capturedAt: new Date().toISOString(),
    message: toSerializable(event.message),
    toolResults: toSerializable(event.toolResults) as unknown[],
  };

  return finalizeTurn(state, "turn_end");
}

export function flushPendingTurn(ctx: ExtensionContext, reason: "session_shutdown" | "reset"): SpikeTurnRecord | null {
  const state = getOrCreateSessionState(ctx);
  if (!state.currentTurn) return null;
  return finalizeTurn(state, reason);
}

function finalizeTurn(state: SessionState, reason: "turn_end" | "session_shutdown" | "reset"): SpikeTurnRecord {
  const turn = state.currentTurn!;
  const outputPath = buildFixturePath(state.session.sessionId, turn.turnIndex, turn.startedAtMs);
  const record: SpikeTurnRecord = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    outputPath,
    session: { ...state.session },
    model: turn.model,
    turn: {
      index: turn.turnIndex,
      startedAt: turn.startedAtIso,
      endedAt: turn.turnEnd?.capturedAt ?? null,
    },
    timestamps: {
      extensionStartedAt: asIso(runtimeState.extensionStartedAtMs),
      sessionStartedAt: state.sessionStartedAtIso,
      requestStartedAt: turn.requestStartedAtIso,
      responseStartedAt: turn.responseStartedAtIso,
      assistantCompletedAt: turn.assistantCompletedAtIso,
    },
    contextSnapshot: turn.contextSnapshot,
    providerRequest: turn.providerRequest,
    providerResponse: turn.providerResponse,
    assistantMessageUpdates: [...turn.assistantMessageUpdates],
    finalAssistantMessage: turn.finalAssistantMessage,
    toolResultEvents: [...turn.toolResultEvents],
    turnEnd: turn.turnEnd,
    flushReason: reason,
  };

  state.currentTurn = null;
  return record;
}

function buildFixturePath(sessionId: string, turnIndex: number, startedAtMs: number): string {
  const safeSessionId = sanitizePathSegment(sessionId);
  const fileName = `turn-${String(turnIndex).padStart(4, "0")}-${startedAtMs}.json`;
  return join(SPIKE_DIR, safeSessionId, fileName);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getRuntimeStatus(): RuntimeStatus {
  let pendingTurns = 0;
  for (const session of runtimeState.sessions.values()) {
    if (session.currentTurn) pendingTurns += 1;
  }

  return {
    extensionStartedAt: asIso(runtimeState.extensionStartedAtMs),
    sidecar: {
      state: runtimeState.sidecarState,
      url: SIDECAR_URL,
      lastError: runtimeState.sidecarLastError,
      lastTransitionAt: asIso(runtimeState.sidecarLastTransitionAtMs),
    },
    sessions: {
      active: runtimeState.sessions.size,
      pendingTurns,
    },
    debug: {
      captureDir: SPIKE_DIR,
      persistedFixtures: runtimeState.completedTurnFixtures,
      failedWrites: runtimeState.failedWrites,
      postedCaptures: runtimeState.postedCaptures,
      failedPosts: runtimeState.failedPosts,
    },
  };
}

export function resetRuntimeState(): void {
  runtimeState.extensionStartedAtMs = Date.now();
  runtimeState.sidecarState = "stopped";
  runtimeState.sidecarLastError = null;
  runtimeState.sidecarLastTransitionAtMs = Date.now();
  runtimeState.completedTurnFixtures = 0;
  runtimeState.failedWrites = 0;
  runtimeState.postedCaptures = 0;
  runtimeState.failedPosts = 0;
  runtimeState.sessions.clear();
}

export function dropSession(ctx: ExtensionContext): void {
  runtimeState.sessions.delete(getSessionKey(ctx));
}

export function toSerializable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (currentValue instanceof Error) {
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack,
        };
      }

      if (typeof currentValue === "function") {
        return `[function ${currentValue.name || "anonymous"}]`;
      }

      if (currentValue instanceof Map) {
        return Object.fromEntries(currentValue.entries());
      }

      if (currentValue instanceof Set) {
        return [...currentValue.values()];
      }

      return currentValue;
    }),
  ) as T;
}
