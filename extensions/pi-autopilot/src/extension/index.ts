import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands";
import { onAgentEnd, pause, restoreFromSession } from "./controller";
import { emitArmedState } from "./events";
import { autopilotPromptFragment, registerReportStatusTool } from "./report-status";
import { endRun, getRun } from "./runtime";
import { clearSidebar } from "./status";

/**
 * pi-autopilot — automates the verify → ship → review → fix loop for ticket
 * work in cmux worktree workspaces. See SPEC.md for the full design. Build
 * phases 1–3 are implemented (gates + greptile/codex/claude reviewers +
 * guards); phase 4 finishers (QA gate, auto-merge, /auto-cleanup) are stubs.
 */
export default function piAutopilot(pi: ExtensionAPI): void {
  registerReportStatusTool(pi);
  registerCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    await restoreFromSession(pi, ctx);
  });

  pi.on("before_agent_start", async (event) => {
    const run = getRun();
    if (!run) return undefined;
    return { systemPrompt: event.systemPrompt + autopilotPromptFragment(run.extraInstructions) };
  });

  pi.on("agent_start", async () => {
    const run = getRun();
    if (run) run.lastReport = undefined;
  });

  // Budget accounting: finalized assistant messages carry per-request usage.
  pi.on("message_end", async (event) => {
    const run = getRun();
    if (!run) return;
    const message = event.message as {
      role?: string;
      usage?: { totalTokens?: number; cost?: { total?: number } };
    };
    if (message.role !== "assistant" || !message.usage) return;
    run.tokensSpent += message.usage.totalTokens ?? 0;
    run.costSpent += message.usage.cost?.total ?? 0;
  });

  pi.on("agent_end", async (event, ctx) => {
    await onAgentEnd(pi, ctx, event.messages);
  });

  // The operator typing a real prompt while the loop is active means they
  // took the wheel: auto-pause instead of racing them. Slash commands and
  // non-interactive sources (including our own injections) don't count, and
  // needs_human is exactly the phase where typing an answer is expected.
  pi.on("input", async (event, ctx) => {
    const run = getRun();
    if (!run) return;
    if (event.source !== "interactive") return;
    if (event.text.trimStart().startsWith("/")) return;
    if (run.phase === "working" || run.phase === "gating") {
      await pause(pi, ctx);
      ctx.ui.notify("Autopilot auto-paused: you took the wheel.", "info");
    }
  });

  pi.on("session_shutdown", async () => {
    endRun();
    emitArmedState(pi, false);
    await clearSidebar(pi);
  });
}
