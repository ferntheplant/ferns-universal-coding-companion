import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { bootstrapZenAuthFromCurl } from "./auth/zen-auth";
import { notifyError, notifyInfo, notifySuccess } from "./notifications";
import { getConfiguredProviders, getProviderRegistry } from "./providers/registry";
import type { ProviderAdapter, ProviderId } from "./providers/types";
import { fetchProviderUsageWithCache, getActiveProviderId, markCommandRun } from "./runtime";
import {
  buildDashboardViewModel,
  createErrorCard,
  createLoadingCard,
  createReadyCard,
  renderDashboardAsLines,
} from "./ui/dashboard";

async function fetchProviderCard(
  provider: ProviderAdapter,
  ctx: ExtensionCommandContext,
  activeProviderId: ProviderId | null,
) {
  const isActive = provider.id === activeProviderId;
  const loadingCard = createLoadingCard(provider.id, provider.label, isActive);

  try {
    const result = await fetchProviderUsageWithCache(provider, ctx, { forceRefresh: true });
    return createReadyCard(result, isActive);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider fetch error";
    return createErrorCard(loadingCard.providerId, loadingCard.providerLabel, isActive, message);
  }
}

async function handleUsageCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  markCommandRun("usage");

  const providers = await getConfiguredProviders(ctx);
  const activeProviderId = getActiveProviderId();
  const cards = await Promise.all(
    providers.map((provider) => fetchProviderCard(provider, ctx, activeProviderId)),
  );

  const dashboard = buildDashboardViewModel(cards);
  const lines = renderDashboardAsLines(dashboard);
  notifyInfo(ctx, lines.join("\n"));
}

async function requestZenCurlText(args: string, ctx: ExtensionCommandContext): Promise<string> {
  const fromArgs = args.trim();
  if (fromArgs.length > 0) {
    return fromArgs;
  }

  const instructions = [
    "Open Zen dashboard in your browser while logged in.",
    "In DevTools Network, copy the dashboard document request as curl.",
    "Paste the full curl command below.",
  ].join("\n");

  if (!ctx.hasUI) {
    throw new Error(
      `${instructions}\n\nNo UI input is available here, so pass the curl text as command args: /usage-zen-login <curl ...>`,
    );
  }

  notifyInfo(ctx, instructions);
  const pasted = await ctx.ui.editor("Paste Zen dashboard curl command");
  if (!pasted || pasted.trim().length === 0) {
    throw new Error("No curl command was provided.");
  }

  return pasted.trim();
}

async function handleZenLoginCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  markCommandRun("usage-zen-login");

  const curlText = await requestZenCurlText(args, ctx);
  const { record } = await bootstrapZenAuthFromCurl(ctx, curlText);

  notifySuccess(
    ctx,
    `Zen auth saved and validated for ${record.dashboardUrl} (${Object.keys(record.cookies).length} cookie(s)).`,
  );
}

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("usage", {
    description: "Show the usage dashboard",
    handler: async (args, ctx) => {
      try {
        await handleUsageCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `usage failed: ${message}`);
      }
    },
  });

  pi.registerCommand("usage-zen-login", {
    description: "Setup Zen dashboard login auth",
    handler: async (args, ctx) => {
      try {
        await handleZenLoginCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `usage-zen-login failed: ${message}`);
      }
    },
  });

  const registeredProviderCount = getProviderRegistry().length;
  if (registeredProviderCount === 0) {
    throw new Error("No providers were registered for /usage.");
  }
}
