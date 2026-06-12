import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { arm, disarm, pause, resume, statusLines } from "./controller";

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("auto", {
    description: "Arm autopilot for the current task (optional extra instructions as args)",
    handler: async (args, ctx) => {
      await arm(pi, ctx, args.trim());
    },
  });

  pi.registerCommand("auto-status", {
    description: "Show autopilot state, gate cursor, attempts, and budget",
    handler: async (_args, ctx) => {
      ctx.ui.notify(statusLines().join("\n"), "info");
    },
  });

  pi.registerCommand("auto-pause", {
    description: "Pause autopilot without losing run state",
    handler: async (_args, ctx) => {
      await pause(pi, ctx);
    },
  });

  pi.registerCommand("auto-resume", {
    description: "Resume a paused or needs-human autopilot run",
    handler: async (_args, ctx) => {
      await resume(pi, ctx);
    },
  });

  pi.registerCommand("auto-off", {
    description: "Disarm autopilot and clear its status",
    handler: async (_args, ctx) => {
      await disarm(pi, ctx);
    },
  });

  pi.registerCommand("auto-cleanup", {
    description: "Post-merge finisher: remove the worktree and close the cmux workspace",
    handler: async (_args, ctx) => {
      // TODO(phase 4): verify the PR is merged, then `git worktree remove` +
      // `cmux workspace close` — sidesteps the `gh pr merge -sd` failure when
      // main is checked out in the main workspace.
      ctx.ui.notify("auto-cleanup is not implemented yet (phase 4).", "warning");
    },
  });
}
