import type { ContentBlock } from "../types.js";

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => textFromValue(item)).filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") return value == null ? "" : String(value);

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.thinking === "string") return record.thinking;
  if (typeof record.content === "string") return record.content;
  if (typeof record.output === "string") return record.output;
  if (typeof record.summary === "string") return record.summary;
  if (typeof record.response === "string") return record.response;

  return JSON.stringify(record);
}

function normalizeToolUseInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeToolResultContent(value: unknown): string | ContentBlock[] {
  if (Array.isArray(value)) {
    return normalizeContentBlocks(value);
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) return normalizeContentBlocks(record.content);
    if (typeof record.content === "string") return record.content;
    if (typeof record.output === "string") return record.output;
    if (typeof record.error === "string") return record.error;
  }
  return textFromValue(value);
}

export function normalizeMessageRole(role: unknown): string {
  if (typeof role !== "string") return "user";
  if (
    role === "tool" ||
    role === "toolResult" ||
    role === "tool_result" ||
    role === "function_call_output" ||
    role === "custom_tool_call_output"
  ) {
    return "tool";
  }
  if (role === "model") return "assistant";
  return role;
}

export function normalizeContentBlock(block: unknown): ContentBlock {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return { type: "text", text: textFromValue(block) };
  }

  const raw = block as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type : "text";

  if (type === "text" || type === "input_text") {
    return {
      type,
      text: textFromValue(raw.text ?? raw.content ?? raw.output ?? raw.summary ?? raw),
    } as ContentBlock;
  }

  if (type === "thinking" || type === "reasoning") {
    return {
      type: "thinking",
      thinking: textFromValue(raw.thinking ?? raw.text ?? raw.summary ?? raw.content ?? raw),
    } as ContentBlock;
  }

  if (type === "tool_use" || type === "toolCall" || type === "tool_call" || type === "function_call" || type === "custom_tool_call") {
    const fn = raw.function && typeof raw.function === "object" ? (raw.function as Record<string, unknown>) : null;
    return {
      type: "tool_use",
      id: String(raw.id ?? raw.call_id ?? raw.toolUseId ?? raw.toolCallId ?? raw.tool_call_id ?? ""),
      name: String(raw.name ?? raw.toolName ?? fn?.name ?? "unknown"),
      input: normalizeToolUseInput(raw.input ?? raw.arguments ?? raw.args ?? raw.parameters),
    };
  }

  if (
    type === "tool_result" ||
    type === "toolResult" ||
    type === "function_call_output" ||
    type === "custom_tool_call_output"
  ) {
    return {
      type: "tool_result",
      tool_use_id: String(
        raw.tool_use_id ?? raw.toolUseId ?? raw.toolCallId ?? raw.call_id ?? raw.id ?? "",
      ),
      content: normalizeToolResultContent(raw.content ?? raw.output ?? raw.response ?? raw.error),
    };
  }

  if (type === "image" || type === "image_url") {
    return { type: "image" };
  }

  return { type: "text", text: textFromValue(raw) };
}

export function normalizeContentBlocks(blocks: unknown[] | null | undefined): ContentBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block) => normalizeContentBlock(block));
}

export function contentBlocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text" || block.type === "input_text") return block.text;
      if (block.type === "thinking") return block.thinking;
      if (block.type === "tool_use") {
        const input =
          block.input && Object.keys(block.input).length > 0 ? ` ${JSON.stringify(block.input)}` : "";
        return `tool call: ${block.name}${input}`;
      }
      if (block.type === "tool_result") {
        return typeof block.content === "string" ? block.content : contentBlocksToText(block.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
