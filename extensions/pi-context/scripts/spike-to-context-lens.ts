import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

type CompositionCategory =
  | "system_prompt"
  | "tool_definitions"
  | "tool_results"
  | "tool_calls"
  | "assistant_text"
  | "user_text"
  | "thinking"
  | "system_injections"
  | "images"
  | "cache_markers"
  | "other";

interface SpikeTurnRecord {
  schemaVersion: 1;
  session: {
    sessionId: string;
    sessionFile: string | null;
    cwd: string;
  };
  model: {
    provider: string | null;
    api: string | null;
    id: string | null;
    baseUrl: string | null;
    contextWindow: number | null;
  };
  turn: {
    index: number;
    startedAt: string;
    endedAt: string | null;
  };
  timestamps: {
    requestStartedAt: string | null;
    responseStartedAt: string | null;
    assistantCompletedAt: string | null;
  };
  providerRequest: {
    payload: Record<string, unknown>;
  } | null;
  providerResponse: {
    status: number;
    headers: Record<string, string>;
  } | null;
  assistantMessageUpdates: Array<{
    assistantMessageEvent: Record<string, unknown>;
  }>;
  finalAssistantMessage: {
    message: PiAssistantMessage;
  } | null;
  turnEnd: {
    message: PiAssistantMessage;
    toolResults: unknown[];
  } | null;
}

interface PiAssistantMessage {
  role?: string;
  content?: unknown[];
  provider?: string;
  api?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: {
      total?: number;
    };
  };
  stopReason?: string;
  responseId?: string;
}

interface CompositionEntry {
  category: CompositionCategory;
  tokens: number;
  pct: number;
  count: number;
}

interface ConvertedTurn {
  capturePayload: Record<string, unknown>;
  lharEntry: Record<string, unknown>;
  traceId: string;
  sessionStartedAt: string;
  model: string;
  contextLimit: number;
  composition: CompositionEntry[];
  toolDefinitionsCount: number;
  toolCallCount: number;
  toolResultCount: number;
  thinkingBlockCount: number;
  inputTokens: number;
}

interface CliOptions {
  inputPath: string;
  outputPath: string | null;
  ingestUrl: string | null;
  resetFirst: boolean;
}

interface Summary {
  traces: number;
  turns: number;
  latestModel: string | null;
  maxContextUtilizationPct: number;
  toolDefinitions: number;
  toolCalls: number;
  toolResults: number;
  thinkingBlocks: number;
  outputPath: string | null;
  ingestUrl: string | null;
}

interface TimingSummary {
  send_ms: number;
  wait_ms: number;
  receive_ms: number;
  total_ms: number;
}

interface RollingSessionState {
  templateBody: Record<string, unknown> | null;
  messages: unknown[];
}

const DEFAULT_SPIKE_DIR = join(homedir(), ".pi", "agent", "state", "pi-context", "spike");
const DEFAULT_OUTPUT_DIR = join(homedir(), ".pi", "agent", "state", "pi-context", "exports");

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/spike-to-context-lens.ts [options]

Options:
  --input <path>         Spike root, session dir, or single turn json.
                         Default: ${DEFAULT_SPIKE_DIR}
  --output <path>        Output .lhar.json file path.
                         Default: ${DEFAULT_OUTPUT_DIR}/pi-context-<session>.lhar.json
  --ingest-url <url>     POST converted turns to a running Context Lens server.
                         Example: http://127.0.0.1:4041/api/ingest
  --reset-first          POST /api/reset before ingesting turns.
  --help                 Show this help.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: DEFAULT_SPIKE_DIR,
    outputPath: null,
    ingestUrl: null,
    resetFirst: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--reset-first") {
      options.resetFirst = true;
      continue;
    }
    if (arg === "--input" || arg === "-i") {
      options.inputPath = argv[index + 1] ?? options.inputPath;
      index += 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      options.outputPath = argv[index + 1] ?? options.outputPath;
      index += 1;
      continue;
    }
    if (arg === "--ingest-url") {
      options.ingestUrl = argv[index + 1] ?? options.ingestUrl;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function listJsonFiles(targetPath: string): Promise<string[]> {
  const resolved = resolve(targetPath);
  const targetStat = await stat(resolved);

  if (targetStat.isFile()) {
    return extname(resolved) === ".json" ? [resolved] : [];
  }

  const entries = await readdir(resolved, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(resolved, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".json") {
      files.push(fullPath);
    }
  }
  return files;
}

async function loadSpikeTurns(inputPath: string): Promise<SpikeTurnRecord[]> {
  const files = await listJsonFiles(inputPath);
  const turns: SpikeTurnRecord[] = [];

  for (const filePath of files) {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as SpikeTurnRecord;
    if (raw.schemaVersion !== 1 || !raw.session?.sessionId) {
      continue;
    }
    turns.push(raw);
  }

  turns.sort((left, right) => {
    const leftTime = Date.parse(left.turn.startedAt);
    const rightTime = Date.parse(right.turn.startedAt);
    if (leftTime !== rightTime) return leftTime - rightTime;
    if (left.session.sessionId !== right.session.sessionId) {
      return left.session.sessionId.localeCompare(right.session.sessionId);
    }
    return left.turn.index - right.turn.index;
  });

  return turns;
}

function normalizeProvider(record: SpikeTurnRecord): string {
  const provider = record.model.provider ?? "";
  const api = record.model.api ?? "";
  const baseUrl = record.model.baseUrl ?? "";

  if (api === "anthropic-messages") return "anthropic";
  if (api === "chatgpt-backend") return "chatgpt";
  if (api === "responses" || api === "chat-completions") return "openai";
  if (api === "gemini") return "gemini";
  if (provider === "anthropic" || provider === "opencode") return "anthropic";
  if (provider === "openai" || provider === "openai-codex") return "openai";
  if (provider === "gemini" || provider === "google" || provider === "vertex") return "gemini";
  if (baseUrl.includes("chatgpt.com")) return "chatgpt";
  if (baseUrl.includes("anthropic")) return "anthropic";
  if (baseUrl.includes("openai")) return "openai";
  return "unknown";
}

function derivePath(apiFormat: string | null, modelId: string | null): string {
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

function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") {
    return Math.max(1, Math.ceil(value.length / 4));
  }
  return estimateTokens(JSON.stringify(value));
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
        content: typeof raw.content === "string" || Array.isArray(raw.content)
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

function buildSyntheticResponse(record: SpikeTurnRecord): Record<string, unknown> {
  const message = record.turnEnd?.message ?? record.finalAssistantMessage?.message ?? null;
  const usage = message?.usage ?? {};
  const cacheRead = usage.cacheRead ?? 0;
  const input = usage.input ?? 0;
  const thinkingTokens = estimateThinkingTokens(message);

  return {
    id: message?.responseId ?? null,
    role: "assistant",
    content: normalizeAssistantContent(message),
    model: message?.model ?? record.model.id ?? "unknown",
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

function bytesForJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function computeTimings(record: SpikeTurnRecord): TimingSummary {
  const requestStart = record.timestamps.requestStartedAt ? Date.parse(record.timestamps.requestStartedAt) : null;
  const responseStart = record.timestamps.responseStartedAt ? Date.parse(record.timestamps.responseStartedAt) : null;
  const assistantDone = record.timestamps.assistantCompletedAt ? Date.parse(record.timestamps.assistantCompletedAt) : null;

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

function cloneRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function bodyHasMessages(body: Record<string, unknown> | null): body is Record<string, unknown> & { messages: unknown[] } {
  return body !== null && Array.isArray(body.messages);
}

function getInitialRequestBody(record: SpikeTurnRecord): Record<string, unknown> | null {
  const payload = record.providerRequest?.payload;
  if (!payload || typeof payload !== "object") return null;
  const body = cloneRequestBody(payload);
  return Object.keys(body).length > 0 ? body : null;
}

function buildRequestBodyForTurn(
  record: SpikeTurnRecord,
  rollingState: RollingSessionState | null,
): Record<string, unknown> {
  const directBody = getInitialRequestBody(record);
  if (bodyHasMessages(directBody)) {
    return directBody;
  }

  const fallbackTemplate = rollingState?.templateBody ? cloneRequestBody(rollingState.templateBody) : {};
  fallbackTemplate.model = record.model.id ?? fallbackTemplate.model ?? "unknown";
  fallbackTemplate.stream = true;
  fallbackTemplate.messages = rollingState?.messages ? [...rollingState.messages] : [];
  return fallbackTemplate;
}

function advanceRollingState(requestBody: Record<string, unknown>, record: SpikeTurnRecord): RollingSessionState {
  const nextMessages = Array.isArray(requestBody.messages) ? [...requestBody.messages] : [];
  const assistantMessage = pickAssistantMessage(record);

  if (assistantMessage) {
    nextMessages.push({
      role: "assistant",
      content: normalizeAssistantContent(assistantMessage),
    });
  }

  const toolResults = Array.isArray(record.turnEnd?.toolResults) ? record.turnEnd.toolResults : [];
  for (const toolResult of toolResults) {
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

function addComposition(
  counts: Map<CompositionCategory, { tokens: number; count: number }>,
  category: CompositionCategory,
  tokens: number,
): void {
  if (tokens <= 0) return;
  const current = counts.get(category);
  if (current) {
    current.tokens += tokens;
    current.count += 1;
    return;
  }
  counts.set(category, { tokens, count: 1 });
}

function classifyBlock(
  block: unknown,
  role: string,
  counts: Map<CompositionCategory, { tokens: number; count: number }>,
): void {
  if (!block || typeof block !== "object") {
    addComposition(counts, role === "assistant" ? "assistant_text" : "user_text", estimateTokens(block));
    return;
  }

  const value = block as Record<string, unknown>;
  const type = typeof value.type === "string" ? value.type : "";

  if (type === "tool_use" || type === "function_call" || type === "custom_tool_call") {
    addComposition(counts, "tool_calls", estimateTokens(block));
    return;
  }
  if (type === "tool_result" || type === "function_call_output" || type === "custom_tool_call_output") {
    addComposition(counts, "tool_results", estimateTokens(value.content ?? value.output ?? ""));
    return;
  }
  if (type === "thinking" || type === "reasoning") {
    addComposition(counts, "thinking", estimateTokens(value.thinking ?? value.text ?? value.summary ?? block));
    return;
  }
  if (type === "image" || type === "image_url") {
    addComposition(counts, "images", 256);
    return;
  }

  const text = typeof value.text === "string" ? value.text : JSON.stringify(block);
  if (text.includes("<system-reminder>")) {
    addComposition(counts, "system_injections", estimateTokens(text));
  } else if (role === "assistant") {
    addComposition(counts, "assistant_text", estimateTokens(text));
  } else {
    addComposition(counts, "user_text", estimateTokens(text));
  }
}

function classifyMessage(
  message: unknown,
  counts: Map<CompositionCategory, { tokens: number; count: number }>,
): void {
  if (!message || typeof message !== "object") {
    addComposition(counts, "other", estimateTokens(message));
    return;
  }

  const value = message as Record<string, unknown>;
  const role = typeof value.role === "string" ? value.role : "user";
  const type = typeof value.type === "string" ? value.type : "";

  if (!("role" in value) && type) {
    classifyBlock(value, "user", counts);
    return;
  }

  if (role === "system" || role === "developer") {
    addComposition(counts, "system_prompt", estimateTokens(value.content ?? value));
    return;
  }

  if (role === "tool") {
    addComposition(counts, "tool_results", estimateTokens(value.content ?? ""));
    return;
  }

  if (Array.isArray(value.tool_calls)) {
    addComposition(counts, "tool_calls", estimateTokens(value.tool_calls));
  }

  if (Array.isArray(value.parts)) {
    for (const part of value.parts) classifyBlock(part, role === "model" ? "assistant" : role, counts);
    return;
  }

  const content = value.content;
  if (typeof content === "string") {
    if (content.includes("<system-reminder>")) {
      addComposition(counts, "system_injections", estimateTokens(content));
    } else if (role === "assistant") {
      addComposition(counts, "assistant_text", estimateTokens(content));
    } else {
      addComposition(counts, "user_text", estimateTokens(content));
    }
    return;
  }

  if (Array.isArray(content)) {
    for (const block of content) classifyBlock(block, role, counts);
    return;
  }

  addComposition(counts, "other", estimateTokens(value));
}

function normalizeComposition(
  counts: Map<CompositionCategory, { tokens: number; count: number }>,
  inputTokens: number,
): CompositionEntry[] {
  const rawEntries = Array.from(counts.entries()).map(([category, value]) => ({
    category,
    tokens: value.tokens,
    count: value.count,
  }));

  const rawTotal = rawEntries.reduce((sum, entry) => sum + entry.tokens, 0);
  const denominator = inputTokens > 0 ? inputTokens : rawTotal;
  if (rawEntries.length === 0 || denominator <= 0) return [];

  let scaledTotal = 0;
  const scaled = rawEntries.map((entry) => {
    const tokens =
      inputTokens > 0 && rawTotal > 0
        ? Math.max(1, Math.round((entry.tokens / rawTotal) * inputTokens))
        : entry.tokens;
    scaledTotal += tokens;
    return {
      category: entry.category,
      tokens,
      count: entry.count,
      pct: 0,
    };
  });

  if (inputTokens > 0 && scaledTotal !== inputTokens) {
    const delta = inputTokens - scaledTotal;
    scaled.sort((left, right) => right.tokens - left.tokens);
    const first = scaled[0];
    if (first) {
      first.tokens += delta;
    }
  }

  const finalDenominator = inputTokens > 0 ? inputTokens : scaled.reduce((sum, entry) => sum + entry.tokens, 0);
  scaled.sort((left, right) => right.tokens - left.tokens);
  return scaled.map((entry) => ({
    category: entry.category,
    tokens: entry.tokens,
    count: entry.count,
    pct: finalDenominator > 0 ? Math.round((entry.tokens / finalDenominator) * 1000) / 1000 : 0,
  }));
}

function analyzeRequestComposition(record: SpikeTurnRecord, inputTokens: number): CompositionEntry[] {
  const body = record.providerRequest?.payload ?? {};
  const counts = new Map<CompositionCategory, { tokens: number; count: number }>();

  if (typeof body.system === "string") {
    addComposition(counts, "system_prompt", estimateTokens(body.system));
  } else if (Array.isArray(body.system)) {
    for (const block of body.system) {
      const text =
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? String((block as { text?: unknown }).text)
          : JSON.stringify(block);
      addComposition(counts, "system_prompt", estimateTokens(text));
    }
  }

  if (typeof body.instructions === "string") {
    addComposition(counts, "system_prompt", estimateTokens(body.instructions));
  }

  if (Array.isArray(body.tools)) {
    addComposition(counts, "tool_definitions", estimateTokens(body.tools));
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : Array.isArray((body.request as { contents?: unknown[] } | undefined)?.contents)
        ? ((body.request as { contents?: unknown[] }).contents ?? [])
        : [];

  for (const message of messages) {
    classifyMessage(message, counts);
  }

  return normalizeComposition(counts, inputTokens);
}

function countAssistantToolCalls(message: PiAssistantMessage | null): number {
  if (!Array.isArray(message?.content)) return 0;
  return message.content.filter((block) => {
    if (!block || typeof block !== "object") return false;
    const type = (block as { type?: unknown }).type;
    return type === "tool_use" || type === "tool_call" || type === "toolCall";
  }).length;
}

function countThinkingBlocks(message: PiAssistantMessage | null): number {
  if (!Array.isArray(message?.content)) return 0;
  return message.content.filter((block) => {
    if (!block || typeof block !== "object") return false;
    return (block as { type?: unknown }).type === "thinking";
  }).length;
}

function toolDefinitionsCount(requestBody: Record<string, unknown>): number {
  return Array.isArray(requestBody.tools) ? requestBody.tools.length : 0;
}

function pickAssistantMessage(record: SpikeTurnRecord): PiAssistantMessage | null {
  return record.turnEnd?.message ?? record.finalAssistantMessage?.message ?? null;
}

function convertTurn(record: SpikeTurnRecord, sequence: number, requestBody: Record<string, unknown>): ConvertedTurn {
  const assistantMessage = pickAssistantMessage(record);
  const syntheticResponse = buildSyntheticResponse(record);
  const apiFormat = record.model.api ?? "unknown";
  const provider = normalizeProvider(record);
  const path = derivePath(apiFormat, record.model.id);
  const targetUrl = joinUrl(record.model.baseUrl, path);
  const requestBytes = bytesForJson(requestBody);
  const responseBytes = bytesForJson(syntheticResponse);
  const timings = computeTimings(record);
  const receiveMs = timings.receive_ms;
  const usage = assistantMessage?.usage ?? {};
  const inputTokens = usage.input ?? estimateTokens(requestBody);
  const thinkingTokens = estimateThinkingTokens(assistantMessage);
  const composition = analyzeRequestComposition(record, inputTokens);
  const traceId = record.session.sessionId;
  const timestamp = record.turn.endedAt ?? record.turn.startedAt;
  const finishReason = assistantMessage?.stopReason ? [assistantMessage.stopReason] : [];

  const capturePayload = {
    timestamp,
    method: "POST",
    path,
    source: "pi",
    provider,
    apiFormat,
    targetUrl: targetUrl ?? record.model.baseUrl ?? "",
    requestHeaders: {},
    requestBody,
    requestBytes,
    responseStatus: record.providerResponse?.status ?? 200,
    responseHeaders: record.providerResponse?.headers ?? {},
    responseBody: JSON.stringify(syntheticResponse),
    responseIsStreaming: false,
    responseBytes,
    sessionId: record.session.sessionId,
    timings,
  };

  const lharEntry = {
    id: randomUUID(),
    trace_id: traceId,
    span_id: randomUUID().replace(/-/g, "").slice(0, 16),
    parent_span_id: null,
    timestamp,
    sequence,
    source: {
      tool: "pi",
      agent_role: "main",
    },
    gen_ai: {
      system: provider,
      request: {
        model: record.model.id ?? "unknown",
        max_tokens: typeof requestBody.max_tokens === "number" ? requestBody.max_tokens : null,
      },
      response: {
        model: assistantMessage?.model ?? record.model.id ?? null,
        finish_reasons: finishReason,
      },
      usage: {
        input_tokens: inputTokens,
        output_tokens: usage.output ?? 0,
        total_tokens: (usage.input ?? 0) + (usage.output ?? 0),
      },
    },
    usage_ext: {
      cache_read_tokens: usage.cacheRead ?? 0,
      cache_write_tokens: usage.cacheWrite ?? 0,
      thinking_tokens: thinkingTokens,
      cost_usd: assistantMessage?.usage?.cost?.total ?? 0,
    },
    http: {
      method: "POST",
      url: targetUrl,
      status_code: record.providerResponse?.status ?? 200,
      api_format: apiFormat,
      stream: Boolean((requestBody as { stream?: unknown }).stream),
    },
    timings: {
      ...timings,
      tokens_per_second:
        receiveMs > 0 && (usage.output ?? 0) > 0
          ? Math.round(((usage.output ?? 0) / receiveMs) * 1000 * 10) / 10
          : null,
    },
    transfer: {
      request_bytes: requestBytes,
      response_bytes: responseBytes,
    },
    context_lens: {
      window_size: record.model.contextWindow ?? 0,
      system_tokens: composition
        .filter((entry) => entry.category === "system_prompt")
        .reduce((sum, entry) => sum + entry.tokens, 0),
      tools_tokens: composition
        .filter((entry) => entry.category === "tool_definitions")
        .reduce((sum, entry) => sum + entry.tokens, 0),
      messages_tokens: composition
        .filter((entry) => entry.category !== "system_prompt" && entry.category !== "tool_definitions")
        .reduce((sum, entry) => sum + entry.tokens, 0),
      composition,
      security: {
        alerts: [],
      },
    },
    raw: {
      request_body: requestBody,
      response_body: syntheticResponse,
    },
  };

  return {
    capturePayload,
    lharEntry,
    traceId,
    sessionStartedAt: record.turn.startedAt,
    model: record.model.id ?? "unknown",
    contextLimit: record.model.contextWindow ?? 0,
    composition,
    toolDefinitionsCount: toolDefinitionsCount(requestBody),
    toolCallCount: countAssistantToolCalls(assistantMessage),
    toolResultCount: Array.isArray(record.turnEnd?.toolResults) ? record.turnEnd.toolResults.length : 0,
    thinkingBlockCount: countThinkingBlocks(assistantMessage),
    inputTokens,
  };
}

async function writeLharFile(outputPath: string, turns: ConvertedTurn[]): Promise<void> {
  const byTrace = new Map<string, ConvertedTurn[]>();
  for (const turn of turns) {
    const group = byTrace.get(turn.traceId) ?? [];
    group.push(turn);
    byTrace.set(turn.traceId, group);
  }

  const sessions = Array.from(byTrace.entries()).map(([traceId, group]) => ({
    trace_id: traceId,
    started_at: group[0]?.sessionStartedAt ?? new Date().toISOString(),
    tool: "pi",
    model: group[group.length - 1]?.model ?? "unknown",
  }));

  const wrapper = {
    lhar: {
      version: "0.1.0",
      creator: {
        name: "pi-context-spike",
        version: "0.1.0",
      },
      sessions,
      entries: turns.map((turn) => turn.lharEntry),
    },
  };

  await mkdir(dirname(outputPath), { recursive: true }).catch(() => undefined);
  await writeFile(outputPath, `${JSON.stringify(wrapper, null, 2)}\n`, "utf8");
}

async function maybeResetContextLens(ingestUrl: string): Promise<void> {
  const resetUrl = new URL(ingestUrl);
  resetUrl.pathname = "/api/reset";
  const response = await fetch(resetUrl, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Reset failed: ${response.status} ${response.statusText}`);
  }
}

async function ingestTurns(ingestUrl: string, turns: ConvertedTurn[], resetFirst: boolean): Promise<void> {
  if (resetFirst) {
    await maybeResetContextLens(ingestUrl);
  }

  for (const turn of turns) {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(turn.capturePayload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ingest failed: ${response.status} ${response.statusText} ${body}`);
    }
  }
}

function defaultOutputPath(inputPath: string, turns: ConvertedTurn[]): string {
  const sessionPart =
    turns.length === 1
      ? (turns[0]?.traceId ?? "session")
      : basename(resolve(inputPath)).replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(DEFAULT_OUTPUT_DIR, `pi-context-${sessionPart}.lhar.json`);
}

function buildSummary(turns: ConvertedTurn[], outputPath: string | null, ingestUrl: string | null): Summary {
  let latestModel: string | null = null;
  let maxUtilizationPct = 0;
  let toolDefinitions = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let thinkingBlocks = 0;

  for (const turn of turns) {
    latestModel = turn.model;
    toolDefinitions = Math.max(toolDefinitions, turn.toolDefinitionsCount);
    toolCalls += turn.toolCallCount;
    toolResults += turn.toolResultCount;
    thinkingBlocks += turn.thinkingBlockCount;
    if (turn.contextLimit > 0) {
      maxUtilizationPct = Math.max(
        maxUtilizationPct,
        Math.round((turn.inputTokens / turn.contextLimit) * 10_000) / 100,
      );
    }
  }

  return {
    traces: new Set(turns.map((turn) => turn.traceId)).size,
    turns: turns.length,
    latestModel,
    maxContextUtilizationPct: maxUtilizationPct,
    toolDefinitions,
    toolCalls,
    toolResults,
    thinkingBlocks,
    outputPath,
    ingestUrl,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const spikeTurns = await loadSpikeTurns(options.inputPath);
  if (spikeTurns.length === 0) {
    throw new Error(`No spike fixtures found under ${options.inputPath}`);
  }

  const traceSequences = new Map<string, number>();
  const rollingStates = new Map<string, RollingSessionState>();
  const convertedTurns = spikeTurns.map((turn) => {
    const sessionId = turn.session.sessionId;
    const nextSequence = (traceSequences.get(sessionId) ?? 0) + 1;
    traceSequences.set(sessionId, nextSequence);

    const requestBody = buildRequestBodyForTurn(turn, rollingStates.get(sessionId) ?? null);
    const converted = convertTurn(turn, nextSequence, requestBody);
    rollingStates.set(sessionId, advanceRollingState(requestBody, turn));
    return converted;
  });

  const outputPath = options.outputPath ? resolve(options.outputPath) : defaultOutputPath(options.inputPath, convertedTurns);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeLharFile(outputPath, convertedTurns);

  if (options.ingestUrl) {
    await ingestTurns(options.ingestUrl, convertedTurns, options.resetFirst);
  }

  const summary = buildSummary(convertedTurns, outputPath, options.ingestUrl);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
