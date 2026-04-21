import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands";
import { detectActiveProvider } from "./providers/registry";
import { fetchProviderUsageWithCache, markLifecycleEvent, resetRuntimeState, setActiveModelProvider, setActiveProviderId, startPolling, startSession, stopPolling } from "./runtime";
import { clearUsageFooter, updateFooterFromUsage } from "./ui/footer";
import { installUsageCustomFooter, uninstallUsageCustomFooter } from "./ui/custom-footer";

async function refreshActiveProviderFooter(ctx: ExtensionContext, forceRefresh = false): Promise<void> {
  const activeAdapter = detectActiveProvider(ctx.model?.provider);
  setActiveProviderId(activeAdapter?.id ?? null);

  if (!activeAdapter) {
    clearUsageFooter(ctx);
    return;
  }

  const configured = await activeAdapter.isConfigured(ctx);
  if (!configured) {
    clearUsageFooter(ctx);
    return;
  }

  try {
    const result = await fetchProviderUsageWithCache(activeAdapter, ctx, { forceRefresh });
    updateFooterFromUsage(ctx, activeAdapter, result);
  } catch {
    clearUsageFooter(ctx);
}
}

export default function usageExtension(pi: ExtensionAPI): void {
  registerCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    startSession(ctx.model?.provider);
    installUsageCustomFooter(pi, ctx);

    await refreshActiveProviderFooter(ctx, true);

    startPolling(() => {
      void refreshActiveProviderFooter(ctx, false);
    });
  });

  pi.on("turn_start", async (_event, ctx) => {
    setActiveModelProvider(ctx.model?.provider);
    markLifecycleEvent("turn_start");
    await refreshActiveProviderFooter(ctx, false);
  });

  pi.on("model_select", async (event, ctx) => {
    setActiveModelProvider(event.model.provider);
    markLifecycleEvent("model_select");
    await refreshActiveProviderFooter(ctx, true);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    markLifecycleEvent("session_shutdown");
    stopPolling();
    resetRuntimeState();
    clearUsageFooter(ctx);
    uninstallUsageCustomFooter(ctx);
  });
}
