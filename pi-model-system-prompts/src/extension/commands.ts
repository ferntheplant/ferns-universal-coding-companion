import { basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { toModelKey } from "./paths";
import { notifyError, notifyInfo } from "./notifications";
import { getPromptRegistry, getRuntimeStatus, incrementCommandCount, resetRuntimeState } from "./runtime";

async function handleStatusCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  incrementCommandCount();

  const promptRegistry = getPromptRegistry();
  await promptRegistry.ensureFresh();

  const status = getRuntimeStatus();
  const snapshot = promptRegistry.getSnapshot();
  const activeModel = ctx.model ? toModelKey(ctx.model.provider, ctx.model.id) : undefined;
  const resolved = activeModel ? promptRegistry.resolvePromptSet(activeModel) : undefined;
  const matchedFiles = resolved?.fragments.map((fragment) => basename(fragment.path)) ?? [];
  const matchedSelectors = resolved?.fragments.flatMap((fragment) =>
    fragment.selectors.map((selector) => `${basename(fragment.path)} => ${selector}`),
  ) ?? [];
  const warningLines = snapshot.warnings.length > 0 ? snapshot.warnings : ["none"];
  const lastApplied = status.lastApplied;
  const lastAppliedLines = lastApplied
    ? [
        `lastAppliedAt: ${lastApplied.appliedAt}`,
        `lastAppliedOutcome: ${lastApplied.outcome}`,
        `lastAppliedDetail: ${lastApplied.detail}`,
        `lastAppliedModel: ${lastApplied.modelKey ?? "none"}`,
        `lastAppliedMatchedFiles: ${lastApplied.matchedFiles.length > 0 ? lastApplied.matchedFiles.join(", ") : "none"}`,
        `lastAppliedAppendedCharacters: ${lastApplied.appendedCharacters}`,
      ]
    : [
        "lastAppliedAt: never",
        "lastAppliedOutcome: none",
        "lastAppliedDetail: no prompt injection has run yet",
        "lastAppliedModel: none",
        "lastAppliedMatchedFiles: none",
        "lastAppliedAppendedCharacters: 0",
      ];

  notifyInfo(
    ctx,
    [
      `model-prompts dir: ${snapshot.promptDir}`,
      `active model: ${activeModel ?? "none"}`,
      `startedAt: ${status.startedAt}`,
      `commandCount: ${status.commandCount}`,
      `registry cached: ${snapshot.cached}`,
      `registry fragmentCount: ${snapshot.fragmentCount}`,
      `registry lastScanAt: ${snapshot.lastScanAt ?? "never"}`,
      `registry fingerprint: ${snapshot.fingerprint ?? "none"}`,
      `matched files: ${matchedFiles.length > 0 ? matchedFiles.join(", ") : "none"}`,
      `matched selectors: ${matchedSelectors.length > 0 ? matchedSelectors.join("; ") : "none"}`,
      `warnings: ${warningLines.join("; ")}`,
      ...lastAppliedLines,
      "phase status: prompt registry, before_agent_start injection, and status reporting implemented.",
    ].join("\n"),
  );
}

async function handleResetCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  resetRuntimeState();
  notifyInfo(ctx, "Model system prompts runtime state reset.");
}

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("model-system-prompts-status", {
    description: "Show registry status, prompt directory path, warnings, and current matches",
    handler: async (args, ctx) => {
      try {
        await handleStatusCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `model-system-prompts-status failed: ${message}`);
      }
    },
  });

  pi.registerCommand("model-system-prompts-reset", {
    description: "Reset extension runtime state",
    handler: async (args, ctx) => {
      try {
        await handleResetCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `model-system-prompts-reset failed: ${message}`);
      }
    },
  });
}
