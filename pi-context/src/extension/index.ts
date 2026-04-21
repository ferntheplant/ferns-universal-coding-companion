import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  handleAfterProviderResponse,
  handleBeforeProviderRequest,
  handleContext,
  handleMessageEnd,
  handleMessageUpdate,
  handleSessionFlush,
  handleToolResult,
  handleTurnEnd,
  handleTurnStart,
} from "./collector";
import { registerCommands } from "./commands";
import { notifyError } from "./notifications";
import { dropSession, startSessionCapture, updateSessionModel } from "./runtime";

export default function piContextExtension(pi: ExtensionAPI): void {
  registerCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    startSessionCapture(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    updateSessionModel(ctx, event);
  });

  pi.on("turn_start", async (event, ctx) => {
    handleTurnStart(event, ctx);
  });

  pi.on("context", async (event, ctx) => {
    handleContext(event, ctx);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    handleBeforeProviderRequest(event, ctx);
  });

  pi.on("after_provider_response", async (event, ctx) => {
    handleAfterProviderResponse(event, ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    handleMessageUpdate(event, ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    handleMessageEnd(event, ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    handleToolResult(event, ctx);
  });

  pi.on("turn_end", async (event, ctx) => {
    await handleTurnEnd(event, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      await handleSessionFlush(ctx, "session_shutdown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notifyError(ctx, `pi-context flush on shutdown failed: ${message}`);
    }
    dropSession(ctx);
  });
}
