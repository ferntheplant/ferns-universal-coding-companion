export type ServerState = "stopped" | "starting" | "running" | "stopping";

export const MAX_ACTIVE_REVIEWS = 1;

export interface ActiveReviewMetadata {
  token: string;
  createdAt: number;
  target: string;
}

export interface RuntimeState {
  serverState: ServerState;
  serverStateChangedAt: number;
  serverStartedAt?: number;
  activeReviews: Map<string, ActiveReviewMetadata>;
  maxActiveReviews: number;
}

const runtimeState: RuntimeState = {
  serverState: "stopped",
  serverStateChangedAt: Date.now(),
  serverStartedAt: undefined,
  activeReviews: new Map(),
  maxActiveReviews: MAX_ACTIVE_REVIEWS,
};

export interface RuntimeStatusSnapshot {
  serverState: ServerState;
  activeReviewCount: number;
  maxActiveReviews: number;
  activeReviews: ActiveReviewMetadata[];
  uptimeMs?: number;
  serverStartedAt?: number;
  serverStateChangedAt: number;
}

export function getRuntimeState(): RuntimeState {
  return runtimeState;
}

export function setServerState(next: ServerState): void {
  runtimeState.serverState = next;
  runtimeState.serverStateChangedAt = Date.now();

  if (next === "running") {
    runtimeState.serverStartedAt = Date.now();
    return;
  }

  if (next === "stopped") {
    runtimeState.serverStartedAt = undefined;
  }
}

export function addActiveReview(review: ActiveReviewMetadata): void {
  runtimeState.activeReviews.set(review.token, review);
}

export function removeActiveReview(token: string): void {
  runtimeState.activeReviews.delete(token);
}

export function hasReachedActiveReviewLimit(): boolean {
  return runtimeState.activeReviews.size >= runtimeState.maxActiveReviews;
}

export function getRuntimeStatusSnapshot(now = Date.now()): RuntimeStatusSnapshot {
  return {
    serverState: runtimeState.serverState,
    activeReviewCount: runtimeState.activeReviews.size,
    maxActiveReviews: runtimeState.maxActiveReviews,
    activeReviews: Array.from(runtimeState.activeReviews.values()),
    uptimeMs:
      runtimeState.serverState === "running" && runtimeState.serverStartedAt !== undefined
        ? Math.max(0, now - runtimeState.serverStartedAt)
        : undefined,
    serverStartedAt: runtimeState.serverStartedAt,
    serverStateChangedAt: runtimeState.serverStateChangedAt,
  };
}

export function resetRuntimeState(): void {
  runtimeState.activeReviews.clear();
  setServerState("stopped");
}
