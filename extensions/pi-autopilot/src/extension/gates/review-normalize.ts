import { completeSimple } from "@earendil-works/pi-ai";
import type { Finding, GateContext } from "../types";

/**
 * Shared LLM normalizer: raw reviewer output (greptile comment diffs, codex /
 * claude review text) → canonical Finding[]. Raw markdown soup never reaches
 * the main agent's context.
 */

const NORMALIZE_SYSTEM_PROMPT = [
  "You extract code review findings from raw reviewer output (markdown of mixed quality).",
  "Return ONLY a JSON array, no prose, no code fences. Each element:",
  '{ "file": string?, "line": number?, "title": string, "body": string, "severity": "low"|"medium"|"high"? }',
  "Rules:",
  "- Include only concrete, actionable requests for code changes.",
  "- Exclude praise, summaries, confidence tables, disclaimers, badges, boilerplate, and review-in-progress status notes.",
  "- title: one stable, specific sentence naming the issue (used for dedup across rounds — avoid volatile details like timestamps or counts).",
  "- body: the reviewer's reasoning plus enough context to act on it.",
  "- Return [] when nothing actionable remains.",
].join("\n");

export async function normalizeFindings(gate: GateContext, rawText: string): Promise<Finding[]> {
  const model = gate.ctx.model;
  const passthrough = (): Finding[] => [
    {
      source: "review",
      title: "Review feedback (unnormalized)",
      body: rawText.slice(0, 6000),
    },
  ];
  if (!model) return passthrough();

  try {
    const apiKey = await gate.ctx.modelRegistry.getApiKeyForProvider(model.provider);
    const response = await completeSimple(
      model,
      {
        systemPrompt: NORMALIZE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: rawText.slice(0, 30_000), timestamp: Date.now() }],
      },
      { apiKey, maxTokens: 4000 },
    );

    const text = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return passthrough();
    const parsed = JSON.parse(jsonMatch[0]) as Array<Partial<Finding>>;
    return parsed
      .filter((item) => typeof item.title === "string" && typeof item.body === "string")
      .map((item) => ({
        source: "review",
        file: typeof item.file === "string" ? item.file : undefined,
        line: typeof item.line === "number" ? item.line : undefined,
        title: item.title!,
        body: item.body!,
        severity: item.severity,
      }));
  } catch {
    // Normalizer failures must not kill the loop; raw passthrough keeps the
    // agent informed and the fingerprint dedup still applies.
    return passthrough();
  }
}
