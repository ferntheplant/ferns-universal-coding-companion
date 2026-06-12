import { completeSimple } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Fallback classifier (layer 2 of done-vs-question detection): when the agent
 * stops without calling report_status, classify its final message instead of
 * parking in needs_human. Conservative on every failure path — a null result
 * means "could not classify", and the caller treats that as needs_human.
 */

export interface Classification {
  kind: "complete" | "question" | "blocked";
  summary: string;
}

const CLASSIFY_SYSTEM_PROMPT = [
  "You classify the final message of a coding agent that stopped working.",
  "Return ONLY a JSON object, no prose, no code fences:",
  '{ "kind": "complete" | "question" | "blocked", "summary": string }',
  "- complete: the agent finished the task it was given.",
  "- question: the agent is asking the operator something or offering choices.",
  "- blocked: the agent cannot proceed (missing access, broken environment, contradiction).",
  "summary: for complete, a conventional-commit style one-liner of what was done;",
  "for question/blocked, the question or blocker restated in one plain sentence.",
].join("\n");

interface MessageLike {
  role?: string;
  content?: unknown;
}

/** Last assistant message's text, from the agent_end messages array. */
export function lastAssistantText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as MessageLike;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = (message.content as Array<{ type?: string; text?: string }>)
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}

export async function classifyFinalMessage(
  ctx: ExtensionContext,
  messages: unknown[],
): Promise<Classification | null> {
  const text = lastAssistantText(messages);
  if (!text || !ctx.model) return null;

  try {
    const apiKey = await ctx.modelRegistry.getApiKeyForProvider(ctx.model.provider);
    const response = await completeSimple(
      ctx.model,
      {
        systemPrompt: CLASSIFY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: text.slice(-8000), timestamp: Date.now() }],
      },
      { apiKey, maxTokens: 300 },
    );
    const responseText = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<Classification>;
    if (
      (parsed.kind === "complete" || parsed.kind === "question" || parsed.kind === "blocked") &&
      typeof parsed.summary === "string"
    ) {
      return { kind: parsed.kind, summary: parsed.summary };
    }
    return null;
  } catch {
    return null;
  }
}
