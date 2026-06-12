import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands";
import { detectActiveProvider, getProviderRegistry } from "./providers/registry";
import type { ProviderUsageResult } from "./providers/types";
import {
  fetchProviderUsageWithCache,
  markLifecycleEvent,
  markTurnEnd,
  markTurnStart,
  resetRuntimeState,
  setActiveModelProvider,
  setActiveProviderId,
  startPolling,
  startSession,
  stopPolling,
} from "./runtime";
import { clearUsageFooter, updateFooterFromUsage } from "./ui/footer";
import { installUsageCustomFooter, uninstallUsageCustomFooter } from "./ui/custom-footer";

async function refreshActiveProviderFooter(
  ctx: ExtensionContext,
  forceRefresh = false,
): Promise<void> {
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

  // Cross-extension quota queries (pi-autopilot budget guard). Request/response
  // over the shared bus: the requester passes a respond callback; we answer
  // with cached-or-fresh results for every configured provider, going through
  // fetchProviderUsageWithCache so callers can't hammer the dashboard scrapers.
  let latestCtx: ExtensionContext | null = null;
  pi.events.on("usage:query", (data) => {
    const request = data as {
      providerIds?: string[];
      respond?: (results: ProviderUsageResult[]) => void;
    };
    if (typeof request?.respond !== "function") return;
    const respond = request.respond;
    const ctx = latestCtx;
    if (!ctx) {
      respond([]);
      return;
    }
    void (async () => {
      const wanted = getProviderRegistry().filter(
        (provider) => !request.providerIds || request.providerIds.includes(provider.id),
      );
      const results: ProviderUsageResult[] = [];
      for (const provider of wanted) {
        try {
          if (!(await provider.isConfigured(ctx))) continue;
          results.push(await fetchProviderUsageWithCache(provider, ctx));
        } catch {
          // A broken provider must not break the others (or the caller).
        }
      }
      respond(results);
    })();
  });

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    startSession(ctx.model?.provider);
    installUsageCustomFooter(pi, ctx);

    await refreshActiveProviderFooter(ctx, true);

    startPolling(() => {
      void refreshActiveProviderFooter(ctx, false);
    });
  });

  pi.on("agent_start", async (_event, ctx) => {
    latestCtx = ctx;
    setActiveModelProvider(ctx.model?.provider);
    markLifecycleEvent("agent_start");
    markTurnStart();
    await refreshActiveProviderFooter(ctx, false);
  });

  pi.on("turn_start", async (_event, ctx) => {
    setActiveModelProvider(ctx.model?.provider);
    markLifecycleEvent("turn_start");
    await refreshActiveProviderFooter(ctx, false);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshActiveProviderFooter(ctx, false);
  });

  pi.on("agent_end", async (_event, ctx) => {
    markLifecycleEvent("agent_end");
    markTurnEnd();
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
