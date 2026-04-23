import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands";
import { notifyInfo } from "./notifications";
import { modelPromptsDir } from "./paths";
import { resetRuntimeState } from "./runtime";

export default function modelSystemPromptsExtension(pi: ExtensionAPI): void {
  registerCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    notifyInfo(ctx, `Model system prompts extension loaded. Prompt dir: ${modelPromptsDir}`);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resetRuntimeState();
    notifyInfo(ctx, "Model system prompts extension cleaned up on session shutdown.");
  });
}
