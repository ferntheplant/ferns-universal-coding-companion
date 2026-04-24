import { basename } from "node:path";
import type { ResolvedPromptSet } from "./prompt-registry";

export function buildPromptWrapper(modelKey: string, promptSet: ResolvedPromptSet): string | undefined {
  if (promptSet.combinedContent.length === 0) {
    return undefined;
  }

  return ["## Model-Specific Instructions", "", `Active model: ${modelKey}`, "", promptSet.combinedContent].join("\n");
}

export function appendPromptWrapper(systemPrompt: string, wrapper: string): string {
  const trimmedSystemPrompt = systemPrompt.trimEnd();
  return trimmedSystemPrompt.length > 0 ? `${trimmedSystemPrompt}\n\n${wrapper}` : wrapper;
}

export function listMatchedFileNames(promptSet: ResolvedPromptSet): string[] {
  return promptSet.fragments.map((fragment) => basename(fragment.path));
}
