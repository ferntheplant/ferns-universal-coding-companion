import { randomUUID } from "node:crypto";
import { estimateTokens, extractLastAssistantMessage, parseContextInfo } from "./context-lens/core.js";
import type { Store } from "./context-lens/server/store.js";
import type { CapturedEntry, ContextInfo, RequestMeta, ResponseData } from "./context-lens/types.js";

interface PiTurnLike {
  sessionId: string;
  timestamp: string;
  sessionStartedAt: string | null;
  model: {
    provider: string | null;
    api: string | null;
    id: string | null;
    baseUrl: string | null;
    contextWindow: number | null;
  };
  providerRequest: {
    payload: Record<string, unknown>;
  } | null;
  providerResponse: {
    status: number;
    headers: Record<string, string>;
  } | null;
  assistantMessage: unknown | null;
  toolResults: unknown[];
  requestBytes: number | null;
  responseBytes: number | null;
  timings: {
    send_ms: number;
    wait_ms: number;
    receive_ms: number;
    total_ms: number;
  } | null;
  timestamps: {
    requestStartedAt: string | null;
    responseStartedAt: string | null;
    assistantCompletedAt: string | null;
  };
}

interface RollingSessionState {
  templateBody: Record<string, unknown> | null;
  messages: unknown[];
  sequence: number;
}

interface PiAssistantUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    total?: number;
  };
}

interface PiAssistantMessage {
  role?: string;
  content?: unknown[];
  provider?: string;
  api?: string;
  model?: string;
  usage?: PiAssistantUsage;
  stopReason?: string;
  responseId?: string;
}

interface PiIngestSummary {
  entry: CapturedEntry;
  traceId: string;
  sequence: number;
}

export class PiIngestPipeline {
  private readonly store: Store;
  private readonly rollingSessions = new Map<string, RollingSessionState>();

  constructor(store: Store) {
    this.store = store;
  }

  ingest(payload: unknown): PiIngestSummary {
    const turn = normalizeTurnPayload(payload);
    const traceId = turn.sessionId;
    const rolling = this.rollingSessions.get(traceId) ?? null;
    const requestBody = buildRequestBodyForTurn(turn, rolling);

    const provider = normalizeProvider(turn.model.provider, turn.model.api, turn.model.baseUrl);
    const apiFormat = normalizeApiFormat(turn.model.api);
    const path = derivePath(apiFormat, turn.model.id);
    const targetUrl = joinUrl(turn.model.baseUrl, path);

    const syntheticResponse = buildSyntheticResponse(turn);
    const requestBytes = turn.requestBytes ?? bytesForJson(requestBody);
    const responseBytes = turn.responseBytes ?? bytesForJson(syntheticResponse);
    const timings = turn.timings ?? computeTimings(turn.timestamps);

    const contextInfo = parseContextInfo(provider, requestBody, apiFormat);
    appendAssistantMessage(contextInfo, syntheticResponse, turn.model.id ?? undefined);

    const meta: RequestMeta = {
      capturedAt: turn.timestamp,
      httpStatus: turn.providerResponse?.status ?? 200,
      timings: {
        ...timings,
        tokens_per_second:
          timings.receive_ms > 0
            ? Math.round((extractOutputTokens(turn.assistantMessage) / timings.receive_ms) * 1000 * 10) /
              10
            : null,
      },
      requestBytes,
      responseBytes,
      targetUrl: targetUrl ?? turn.model.baseUrl ?? "",
      requestHeaders: {},
      responseHeaders: turn.providerResponse?.headers ?? {},
    };

    const entry = this.store.storeRequest(
      contextInfo,
      syntheticResponse,
      "pi",
      requestBody as Record<string, any>,
      meta,
      {},
      traceId,
    );

    const nextState = advanceRollingState(requestBody, turn);
    this.rollingSessions.set(traceId, {
      ...nextState,
      sequence: (rolling?.sequence ?? 0) + 1,
    });

    return {
      entry,
      traceId,
      sequence: this.rollingSessions.get(traceId)?.sequence ?? 1,
    };
  }
}

function normalizeTurnPayload(payload: unknown): PiTurnLike {
  if (!payload || typeof payload !== "object") {
    throw new Error("Pi ingest payload must be an object");
  }

  const value = payload as Record<string, unknown>;

  if (typeof value.sessionId === "string") {
    return normalizeDirectPiPayload(value);
  }

  if (value.schemaVersion === 1) {
    return normalizeSpikeTurnPayload(value);
  }

  throw new Error("Unsupported Pi ingest payload shape");
}

function normalizeDirectPiPayload(value: Record<string, unknown>): PiTurnLike {
  const model = asRecord(value.model);
  const providerRequest = asRecord(value.providerRequest);
  const providerResponse = asRecord(value.providerResponse);
  const timestamps = asRecord(value.timestamps);

  return {
    sessionId: String(value.sessionId),
    timestamp: asIsoString(value.timestamp) ?? new Date().toISOString(),
    sessionStartedAt: asIsoString(value.sessionStartedAt),
    model: {
      provider: asString(model?.provider),
      api: asString(model?.api),
      id: asString(model?.id),
      baseUrl: asString(model?.baseUrl),
      contextWindow: asNumber(model?.contextWindow),
    },
    providerRequest:
      providerRequest && asRecord(providerRequest.payload)
        ? {
            payload: asRecord(providerRequest.payload) ?? {},
          }
        : null,
    providerResponse:
      providerResponse && typeof providerResponse.status === "number"
        ? {
            status: providerResponse.status,
            headers: toStringRecord(providerResponse.headers),
          }
        : null,
    assistantMessage: value.assistantMessage ?? null,
    toolResults: Array.isArray(value.toolResults) ? value.toolResults : [],
    requestBytes: asNumber(value.requestBytes),
    responseBytes: asNumber(value.responseBytes),
    timings:
      asRecord(value.timings) &&
      typeof asRecord(value.timings)?.send_ms === "number" &&
      typeof asRecord(value.timings)?.wait_ms === "number" &&
      typeof asRecord(value.timings)?.receive_ms === "number" &&
      typeof asRecord(value.timings)?.total_ms === "number"
        ? {
            send_ms: asRecord(value.timings)?.send_ms as number,
            wait_ms: asRecord(value.timings)?.wait_ms as number,
            receive_ms: asRecord(value.timings)?.receive_ms as number,
            total_ms: asRecord(value.timings)?.total_ms as number,
          }
        : null,
    timestamps: {
      requestStartedAt: asIsoString(timestamps?.requestStartedAt),
      responseStartedAt: asIsoString(timestamps?.responseStartedAt),
      assistantCompletedAt: asIsoString(timestamps?.assistantCompletedAt),
    },
  };
}

function normalizeSpikeTurnPayload(value: Record<string, unknown>): PiTurnLike {
  const session = asRecord(value.session);
  const model = asRecord(value.model);
  const turn = asRecord(value.turn);
  const timestamps = asRecord(value.timestamps);
  const providerRequest = asRecord(value.providerRequest);
  const providerResponse = asRecord(value.providerResponse);
  const turnEnd = asRecord(value.turnEnd);
  const finalAssistantMessage = asRecord(value.finalAssistantMessage);

  const assistantMessage =
    asRecord(turnEnd?.message) ?? asRecord(finalAssistantMessage?.message) ?? null;

  return {
    sessionId: String(session?.sessionId ?? randomUUID()),
    timestamp:
      asIsoString(turn?.endedAt) ??
      asIsoString(turn?.startedAt) ??
      new Date().toISOString(),
    sessionStartedAt: asIsoString(turn?.startedAt),
    model: {
      provider: asString(model?.provider),
      api: asString(model?.api),
      id: asString(model?.id),
      baseUrl: asString(model?.baseUrl),
      contextWindow: asNumber(model?.contextWindow),
    },
    providerRequest:
      providerRequest && asRecord(providerRequest.payload)
        ? {
            payload: asRecord(providerRequest.payload) ?? {},
          }
        : null,
    providerResponse:
      providerResponse && typeof providerResponse.status === "number"
        ? {
            status: providerResponse.status,
            headers: toStringRecord(providerResponse.headers),
          }
        : null,
    assistantMessage,
    toolResults: Array.isArray(turnEnd?.toolResults) ? turnEnd.toolResults : [],
    requestBytes: null,
    responseBytes: null,
    timings: null,
    timestamps: {
      requestStartedAt: asIsoString(timestamps?.requestStartedAt),
      responseStartedAt: asIsoString(timestamps?.responseStartedAt),
      assistantCompletedAt: asIsoString(timestamps?.assistantCompletedAt),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIsoString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      result[key] = raw;
    } else if (raw != null) {
      result[key] = String(raw);
    }
  }
  return result;
}

function normalizeProvider(
  provider: string | null,
  apiFormat: string | null,
  baseUrl: string | null,
): string {
  if (apiFormat === "anthropic-messages") return "anthropic";
  if (apiFormat === "chatgpt-backend") return "chatgpt";
  if (apiFormat === "responses" || apiFormat === "chat-completions") return "openai";
  if (apiFormat === "gemini") return "gemini";

  if (provider === "anthropic" || provider === "opencode") return "anthropic";
  if (provider === "openai" || provider === "openai-codex") return "openai";
  if (provider === "gemini" || provider === "google" || provider === "vertex") return "gemini";

  const lowered = (baseUrl ?? "").toLowerCase();
  if (lowered.includes("chatgpt.com")) return "chatgpt";
  if (lowered.includes("anthropic")) return "anthropic";
  if (lowered.includes("openai")) return "openai";
  if (lowered.includes("googleapis")) return "gemini";

  return "unknown";
}

function normalizeApiFormat(api: string | null): string {
  if (!api) return "unknown";
  if (api === "anthropic-messages") return "anthropic-messages";
  if (api === "responses") return "responses";
  if (api === "chat-completions") return "chat-completions";
  if (api === "chatgpt-backend") return "chatgpt-backend";
  if (api === "gemini") return "gemini";
  return "unknown";
}

function derivePath(apiFormat: string, modelId: string | null): string {
  switch (apiFormat) {
    case "anthropic-messages":
      return "/v1/messages";
    case "responses":
      return "/responses";
    case "chat-completions":
      return "/v1/chat/completions";
    case "chatgpt-backend":
      return "/backend-api/conversation";
    case "gemini":
      return `/v1beta/models/${modelId ?? "unknown"}:generateContent`;
    default:
      return "/";
  }
}

function joinUrl(baseUrl: string | null, path: string): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (url.pathname === "/" && path !== "/") {
      url.pathname = path;
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function cloneRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function bodyHasMessages(
  body: Record<string, unknown> | null,
): body is Record<string, unknown> & { messages: unknown[] } {
  return body !== null && Array.isArray(body.messages);
}

function getInitialRequestBody(turn: PiTurnLike): Record<string, unknown> | null {
  const payload = turn.providerRequest?.payload;
  if (!payload || typeof payload !== "object") return null;
  const body = cloneRequestBody(payload);
  return Object.keys(body).length > 0 ? body : null;
}

function buildRequestBodyForTurn(
  turn: PiTurnLike,
  rollingState: RollingSessionState | null,
): Record<string, unknown> {
  const directBody = getInitialRequestBody(turn);
  if (bodyHasMessages(directBody)) {
    return directBody;
  }

  const fallbackTemplate = rollingState?.templateBody
    ? cloneRequestBody(rollingState.templateBody)
    : {};
  fallbackTemplate.model = turn.model.id ?? fallbackTemplate.model ?? "unknown";
  fallbackTemplate.stream = true;
  fallbackTemplate.messages = rollingState?.messages ? [...rollingState.messages] : [];
  return fallbackTemplate;
}

function normalizeAssistantContent(message: PiAssistantMessage | null): unknown[] {
  if (!Array.isArray(message?.content)) return [];

  return message.content.map((block) => {
    if (!block || typeof block !== "object") {
      return { type: "text", text: String(block ?? "") };
    }

    const raw = block as Record<string, unknown>;
    const type = typeof raw.type === "string" ? raw.type : "text";

    if (type === "text") return { type: "text", text: String(raw.text ?? "") };
    if (type === "thinking") {
      return {
        type: "thinking",
        thinking: String(raw.thinking ?? raw.text ?? ""),
      };
    }
    if (type === "tool_use" || type === "toolCall" || type === "tool_call") {
      return {
        type: "tool_use",
        id: String(raw.id ?? raw.toolUseId ?? ""),
        name: String(raw.name ?? raw.toolName ?? "unknown"),
        input: (raw.input ?? raw.arguments ?? {}) as Record<string, unknown>,
      };
    }
    if (type === "tool_result" || type === "toolResult") {
      return {
        type: "tool_result",
        tool_use_id: String(raw.tool_use_id ?? raw.toolUseId ?? raw.toolCallId ?? ""),
        content:
          typeof raw.content === "string" || Array.isArray(raw.content)
            ? raw.content
            : JSON.stringify(raw.content ?? ""),
      };
    }
    if (type === "image" || type === "image_url") {
      return { type: "image" };
    }

    return {
      type: "text",
      text: JSON.stringify(block),
    };
  });
}

function normalizeToolResultMessage(toolResult: unknown): Record<string, unknown> | null {
  if (!toolResult || typeof toolResult !== "object") return null;

  const value = toolResult as Record<string, unknown>;
  const content = Array.isArray(value.content) ? value.content : [];
  const textParts = content.map((item) => {
    if (!item || typeof item !== "object") return String(item ?? "");
    const block = item as Record<string, unknown>;
    if (typeof block.text === "string") return block.text;
    return JSON.stringify(item);
  });

  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: String(value.toolCallId ?? ""),
        content: textParts.join(""),
        is_error: Boolean(value.isError),
      },
    ],
  };
}

function pickAssistantMessage(turn: PiTurnLike): PiAssistantMessage | null {
  if (!turn.assistantMessage || typeof turn.assistantMessage !== "object") {
    return null;
  }
  return turn.assistantMessage as PiAssistantMessage;
}

function advanceRollingState(
  requestBody: Record<string, unknown>,
  turn: PiTurnLike,
): Omit<RollingSessionState, "sequence"> {
  const nextMessages = Array.isArray(requestBody.messages) ? [...requestBody.messages] : [];
  const assistantMessage = pickAssistantMessage(turn);

  if (assistantMessage) {
    nextMessages.push({
      role: "assistant",
      content: normalizeAssistantContent(assistantMessage),
    });
  }

  for (const toolResult of turn.toolResults) {
    const normalized = normalizeToolResultMessage(toolResult);
    if (normalized) {
      nextMessages.push(normalized);
    }
  }

  const templateBody = cloneRequestBody(requestBody);
  templateBody.messages = [...nextMessages];

  return {
    templateBody,
    messages: nextMessages,
  };
}

function estimateThinkingTokens(message: PiAssistantMessage | null): number {
  if (!Array.isArray(message?.content)) return 0;
  let total = 0;
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    if ((block as { type?: unknown }).type === "thinking") {
      total += estimateTokens((block as { thinking?: unknown }).thinking ?? "");
    }
  }
  return total;
}

function extractOutputTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const usage = asRecord((message as Record<string, unknown>).usage);
  const output = usage?.output;
  return typeof output === "number" && Number.isFinite(output) ? output : 0;
}

function buildSyntheticResponse(turn: PiTurnLike): Record<string, unknown> {
  const message = pickAssistantMessage(turn);
  const usage = message?.usage ?? {};
  const cacheRead = usage.cacheRead ?? 0;
  const input = usage.input ?? 0;
  const thinkingTokens = estimateThinkingTokens(message);

  return {
    id: message?.responseId ?? null,
    role: "assistant",
    content: normalizeAssistantContent(message),
    model: message?.model ?? turn.model.id ?? "unknown",
    stop_reason: message?.stopReason ?? null,
    usage: {
      input_tokens: input,
      output_tokens: usage.output ?? 0,
      prompt_tokens: input + cacheRead,
      completion_tokens: usage.output ?? 0,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: usage.cacheWrite ?? 0,
      thinking_tokens: thinkingTokens,
      prompt_tokens_details: {
        cached_tokens: cacheRead,
      },
      completion_tokens_details: {
        reasoning_tokens: thinkingTokens,
      },
    },
  };
}

function appendAssistantMessage(
  contextInfo: ContextInfo,
  responseData: ResponseData,
  model?: string,
): void {
  const lastAssistant = extractLastAssistantMessage(responseData, model);
  if (!lastAssistant) return;
  contextInfo.messages.push(lastAssistant);
  contextInfo.messagesTokens += lastAssistant.tokens;
  contextInfo.totalTokens += lastAssistant.tokens;
}

function bytesForJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function computeTimings(timestamps: {
  requestStartedAt: string | null;
  responseStartedAt: string | null;
  assistantCompletedAt: string | null;
}): { send_ms: number; wait_ms: number; receive_ms: number; total_ms: number } {
  const requestStart = timestamps.requestStartedAt
    ? Date.parse(timestamps.requestStartedAt)
    : null;
  const responseStart = timestamps.responseStartedAt
    ? Date.parse(timestamps.responseStartedAt)
    : null;
  const assistantDone = timestamps.assistantCompletedAt
    ? Date.parse(timestamps.assistantCompletedAt)
    : null;

  const waitMs =
    requestStart !== null && responseStart !== null && responseStart >= requestStart
      ? responseStart - requestStart
      : 0;
  const receiveMs =
    responseStart !== null && assistantDone !== null && assistantDone >= responseStart
      ? assistantDone - responseStart
      : 0;
  const totalMs =
    requestStart !== null && assistantDone !== null && assistantDone >= requestStart
      ? assistantDone - requestStart
      : waitMs + receiveMs;

  return {
    send_ms: 0,
    wait_ms: waitMs,
    receive_ms: receiveMs,
    total_ms: totalMs,
  };
}
