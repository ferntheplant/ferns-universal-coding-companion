import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ProviderAdapter, ProviderId, ProviderUsageResult } from "./providers/types";

export type UsageCommandName = "usage" | "usage-zen-login";

export type LifecycleEventName =
  | "session_start"
  | "turn_start"
  | "model_select"
  | "session_shutdown";

export interface ProviderRuntimeCache {
  lastSuccessAt: number | null;
  lastResult: ProviderUsageResult | null;
  lastAuthError: string | null;
  lastFetchError: string | null;
  inFlightFetch: Promise<ProviderUsageResult> | null;
}

export interface RuntimeState {
  extensionStartedAt: number;
  sessionStartedAt: number | null;
  activeModelProvider: string | null;
  activeProviderId: ProviderId | null;
  lastLifecycleEvent: LifecycleEventName | null;
  pollIntervalMs: number;
  cacheFreshnessMs: number;
  usageCommandRuns: number;
  zenLoginCommandRuns: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  providerCache: Map<ProviderId, ProviderRuntimeCache>;
}

export interface RuntimeSnapshot {
  extensionStartedAt: number;
  sessionStartedAt: number | null;
  activeModelProvider: string | null;
  activeProviderId: ProviderId | null;
  lastLifecycleEvent: LifecycleEventName | null;
  pollIntervalMs: number;
  cacheFreshnessMs: number;
  usageCommandRuns: number;
  zenLoginCommandRuns: number;
  isPolling: boolean;
}

export const DEFAULT_POLL_INTERVAL_MS = 120_000;
export const DEFAULT_CACHE_FRESHNESS_MS = 15_000;

const runtimeState: RuntimeState = {
  extensionStartedAt: Date.now(),
  sessionStartedAt: null,
  activeModelProvider: null,
  activeProviderId: null,
  lastLifecycleEvent: null,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  cacheFreshnessMs: DEFAULT_CACHE_FRESHNESS_MS,
  usageCommandRuns: 0,
  zenLoginCommandRuns: 0,
  pollTimer: null,
  providerCache: new Map(),
};

function createEmptyProviderCache(): ProviderRuntimeCache {
  return {
    lastSuccessAt: null,
    lastResult: null,
    lastAuthError: null,
    lastFetchError: null,
    inFlightFetch: null,
  };
}

export function markLifecycleEvent(event: LifecycleEventName): void {
  runtimeState.lastLifecycleEvent = event;
}

export function startSession(modelProvider: string | undefined): void {
  runtimeState.sessionStartedAt = Date.now();
  runtimeState.activeModelProvider = modelProvider ?? null;
  markLifecycleEvent("session_start");
}

export function setActiveModelProvider(modelProvider: string | undefined): void {
  runtimeState.activeModelProvider = modelProvider ?? null;
}

export function setActiveProviderId(providerId: ProviderId | null): void {
  runtimeState.activeProviderId = providerId;
}

export function getActiveProviderId(): ProviderId | null {
  return runtimeState.activeProviderId;
}

export function markCommandRun(commandName: UsageCommandName): void {
  if (commandName === "usage") {
    runtimeState.usageCommandRuns += 1;
    return;
  }

  runtimeState.zenLoginCommandRuns += 1;
}

export function startPolling(task: () => void, intervalMs = runtimeState.pollIntervalMs): void {
  stopPolling();
  runtimeState.pollIntervalMs = intervalMs;
  runtimeState.pollTimer = setInterval(task, intervalMs);
}

export function stopPolling(): void {
  if (runtimeState.pollTimer) {
    clearInterval(runtimeState.pollTimer);
    runtimeState.pollTimer = null;
  }
}

export function getProviderCache(providerId: ProviderId): ProviderRuntimeCache {
  const existing = runtimeState.providerCache.get(providerId);
  if (existing) {
    return existing;
  }

  const created = createEmptyProviderCache();
  runtimeState.providerCache.set(providerId, created);
  return created;
}

export function fetchProviderUsageWithCache(
  provider: ProviderAdapter,
  ctx: ExtensionContext,
  options?: { forceRefresh?: boolean },
): Promise<ProviderUsageResult> {
  const cache = getProviderCache(provider.id);
  const forceRefresh = options?.forceRefresh ?? false;

  const cachedResult = cache.lastResult;
  const isFresh =
    cache.lastSuccessAt !== null && Date.now() - cache.lastSuccessAt < runtimeState.cacheFreshnessMs;

  if (!forceRefresh && cachedResult && isFresh) {
    return Promise.resolve(cachedResult);
  }

  if (cache.inFlightFetch) {
    return cache.inFlightFetch;
  }

  const request = provider
    .fetchUsage(ctx, { forceRefresh })
    .then((result) => {
      cache.lastSuccessAt = Date.now();
      cache.lastResult = result;
      cache.lastAuthError = null;
      cache.lastFetchError = null;
      return result;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      cache.lastFetchError = message;
      throw error;
    })
    .finally(() => {
      cache.inFlightFetch = null;
    });

  cache.inFlightFetch = request;
  return request;
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return {
    extensionStartedAt: runtimeState.extensionStartedAt,
    sessionStartedAt: runtimeState.sessionStartedAt,
    activeModelProvider: runtimeState.activeModelProvider,
    activeProviderId: runtimeState.activeProviderId,
    lastLifecycleEvent: runtimeState.lastLifecycleEvent,
    pollIntervalMs: runtimeState.pollIntervalMs,
    cacheFreshnessMs: runtimeState.cacheFreshnessMs,
    usageCommandRuns: runtimeState.usageCommandRuns,
    zenLoginCommandRuns: runtimeState.zenLoginCommandRuns,
    isPolling: runtimeState.pollTimer !== null,
  };
}

export function resetRuntimeState(): void {
  stopPolling();

  runtimeState.extensionStartedAt = Date.now();
  runtimeState.sessionStartedAt = null;
  runtimeState.activeModelProvider = null;
  runtimeState.activeProviderId = null;
  runtimeState.lastLifecycleEvent = null;
  runtimeState.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  runtimeState.cacheFreshnessMs = DEFAULT_CACHE_FRESHNESS_MS;
  runtimeState.usageCommandRuns = 0;
  runtimeState.zenLoginCommandRuns = 0;
  runtimeState.providerCache.clear();
}
