import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands";
import { notifyInfo } from "./notifications";
import { resetRuntimeState } from "./runtime";
import { stopServer } from "../server";

export default function cmuxDiffExtension(pi: ExtensionAPI): void {
  registerCommands(pi);

  pi.on("session_shutdown", async (_event, ctx) => {
    stopServer();
    resetRuntimeState();
    notifyInfo(ctx, "Session shutdown: cmux-diff runtime cleaned up.");
  });
}
