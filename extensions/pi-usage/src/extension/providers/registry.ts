import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { codexProvider } from "./codex";
import { cursorProvider } from "./cursor";
import type { ProviderAdapter, ProviderId } from "./types";
import { zenProvider } from "./zen";

const PROVIDERS: ProviderAdapter[] = [codexProvider, cursorProvider, zenProvider];

export function getProviderRegistry(): ProviderAdapter[] {
  return PROVIDERS;
}

export function getProviderById(providerId: ProviderId): ProviderAdapter | undefined {
  return PROVIDERS.find((provider) => provider.id === providerId);
}

export function detectActiveProvider(modelProvider: string | undefined): ProviderAdapter | undefined {
  return PROVIDERS.find((provider) => provider.detectActive(modelProvider));
}

export async function getConfiguredProviders(ctx: ExtensionContext): Promise<ProviderAdapter[]> {
  const configured: ProviderAdapter[] = [];

  for (const provider of PROVIDERS) {
    if (await provider.isConfigured(ctx)) {
      configured.push(provider);
    }
  }

  return configured;
}
