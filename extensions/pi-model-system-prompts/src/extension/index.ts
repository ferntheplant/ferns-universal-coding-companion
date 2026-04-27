import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands";
import { notifyError, notifyInfo, notifyWarning } from "./notifications";
import { modelPromptsDir } from "./paths";
import { appendPromptWrapper, buildPromptWrapper, listMatchedFileNames } from "./prompt-resolver";
import {
  resetRuntimeState,
  getPromptRegistry,
  recordWarnings,
  setLastAppliedPromptState,
} from "./runtime";
import { toModelKey } from "./paths";

async function handleBeforeAgentStart(
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
): Promise<{ systemPrompt?: string } | undefined> {
  const promptRegistry = getPromptRegistry();
  await promptRegistry.ensureFresh();

  const newWarnings = recordWarnings(promptRegistry.getSnapshot().warnings);
  for (const warning of newWarnings) {
    notifyWarning(ctx, warning);
  }

  if (!ctx.model) {
    setLastAppliedPromptState({
      appliedAt: Date.now(),
      matchedFiles: [],
      appendedCharacters: 0,
      outcome: "no-model",
      detail: "No active model in extension context.",
    });
    return undefined;
  }

  const modelKey = toModelKey(ctx.model.provider, ctx.model.id);
  const resolved = promptRegistry.resolvePromptSet(modelKey);
  const wrapper = buildPromptWrapper(modelKey, resolved);

  if (!wrapper) {
    setLastAppliedPromptState({
      appliedAt: Date.now(),
      modelKey,
      matchedFiles: [],
      appendedCharacters: 0,
      outcome: "no-match",
      detail: "No matching prompt fragments for the active model.",
    });
    return undefined;
  }

  const nextSystemPrompt = appendPromptWrapper(event.systemPrompt, wrapper);
  setLastAppliedPromptState({
    appliedAt: Date.now(),
    modelKey,
    matchedFiles: listMatchedFileNames(resolved),
    appendedCharacters: wrapper.length,
    outcome: "applied",
    detail: `Appended ${resolved.fragments.length} prompt fragment(s).`,
  });

  return { systemPrompt: nextSystemPrompt };
}

export default function modelSystemPromptsExtension(pi: ExtensionAPI): void {
  registerCommands(pi);

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      return await handleBeforeAgentStart(event as BeforeAgentStartEvent, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setLastAppliedPromptState({
        appliedAt: Date.now(),
        modelKey: ctx.model ? toModelKey(ctx.model.provider, ctx.model.id) : undefined,
        matchedFiles: [],
        appendedCharacters: 0,
        outcome: "error",
        detail: message,
      });
      notifyError(ctx, `Model system prompts injection failed: ${message}`);
      return undefined;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    notifyInfo(ctx, `Model system prompts extension loaded. Prompt dir: ${modelPromptsDir}`);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resetRuntimeState();
    notifyInfo(ctx, "Model system prompts extension cleaned up on session shutdown.");
  });
}
