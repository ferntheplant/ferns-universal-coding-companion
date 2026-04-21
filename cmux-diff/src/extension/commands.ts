import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "./notifications";
import {
  addActiveReview,
  getRuntimeStatusSnapshot,
  hasReachedActiveReviewLimit,
  removeActiveReview,
  resetRuntimeState,
  setServerState,
} from "./runtime";
import {
  ensureCmuxAvailable,
  ensureInCmuxEnvironment,
  listCmuxPanes,
  openCmuxPane,
  type PaneInfo,
} from "../domain/cmux";
import { formatDiffTarget, validateDiffTarget } from "../domain/diff-target";
import { buildReviewPayload, resolveRepoRoot } from "../domain/git";
import { promptForCmuxMode, promptForDiffTarget, type CmuxModePromptResult, type DiffTargetPromptResult } from "./prompts";
import { createReviewContext, disposeReviewContext, listActiveReviewContexts } from "../server/review-registry";
import { buildReviewRoute, buildSubmitRoute } from "../server/routes";
import { getServerStatus, startServer, stopServer } from "../server";
import type { ReviewPayload, CommentSubmitPayload } from "../domain/types";
import { injectCommentsIntoPi } from "../domain/comments";

function formatUptime(uptimeMs: number | undefined): string {
  if (uptimeMs === undefined) {
    return "n/a";
  }

  const totalSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatElapsedTime(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return "n/a";
  }
  const elapsedMs = Date.now() - timestamp;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s ago`;
  }
  return `${seconds}s ago`;
}

async function renderStatusMessage(_pi: ExtensionAPI): Promise<string> {
  const server = getServerStatus();
  const runtime = getRuntimeStatusSnapshot();
  const activeContexts = listActiveReviewContexts();

  if (!server.running) {
    return `server: stopped; active reviews: ${runtime.activeReviewCount}`;
  }

  const tokens = server.activeTokens.length > 0 ? server.activeTokens.join(",") : "none";

  const activeDetails = runtime.activeReviews.map((review) => {
    const context = activeContexts.find((c) => c.token === review.token);
    const lastAccess = context ? formatElapsedTime(context.lastAccessedAt) : "unknown";
    return `${review.token}:${review.target} (created ${formatElapsedTime(review.createdAt)}, last access ${lastAccess})`;
  }).join(" | ") || "none";

  return `server: running on ${server.host}:${server.port}; uptime: ${formatUptime(server.uptimeMs)}; active tokens: ${tokens}; active reviews: ${activeDetails}`;
}

function renderActiveReviewError(): string {
  return "A review is already active (max 1 per session). Finish the current review, run /cmux-diff-status to inspect it, or run /cmux-diff-kill to force reset.";
}

async function fetchAvailablePanes(pi: ExtensionAPI): Promise<PaneInfo[]> {
  try {
    const result = await listCmuxPanes(pi);
    if (result.success) {
      return result.panes;
    }
    // Log error but don't block - user can still use "new pane"
    return [];
  } catch {
    return [];
  }
}

async function handleCmuxDiff(_args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  if (hasReachedActiveReviewLimit()) {
    notifyError(ctx, renderActiveReviewError());
    return;
  }

  const repoRoot = await resolveRepoRoot(ctx.cwd);
  if (!repoRoot) {
    notifyError(ctx, "Not inside a git repository. cd into a repo and try /cmux-diff again.");
    return;
  }

  try {
    await ensureCmuxAvailable(pi);
    ensureInCmuxEnvironment();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cmux validation error";
    notifyError(ctx, message);
    return;
  }

  let target: DiffTargetPromptResult;
  let availablePanes: PaneInfo[];
  try {
    target = await promptForDiffTarget(ctx);
    availablePanes = await fetchAvailablePanes(pi);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt cancelled.";
    notifyWarning(ctx, message);
    return;
  }

  let cmuxMode: CmuxModePromptResult;
  try {
    cmuxMode = await promptForCmuxMode(ctx, pi, availablePanes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pane selection cancelled.";
    notifyWarning(ctx, message);
    return;
  }

  const targetValidation = validateDiffTarget(target);
  if (!targetValidation.valid) {
    notifyError(ctx, targetValidation.error);
    return;
  }

  // Start server immediately for fast feedback - payload builds in parallel
  notifyInfo(ctx, `Starting review server and preparing diff for ${formatDiffTarget(target)}...`);
  setServerState("starting");
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer();
    setServerState("running");
  } catch (error) {
    setServerState("stopped");
    const message = error instanceof Error ? error.message : "Unknown error";
    notifyError(ctx, `Failed to start review server: ${message}`);
    return;
  }

  // Build review payload after server is running (can be parallelized further if needed)
  let payload: ReviewPayload;
  try {
    payload = await buildReviewPayload(repoRoot, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown git error";
    notifyError(ctx, `Failed to compute git diff payload: ${message}`);
    return;
  }

  const token = crypto.randomUUID();
  const targetLabel = formatDiffTarget(target);

  const reviewUrl = `${server.url}${buildReviewRoute(token)}`;
  const submitUrl = `${server.url}${buildSubmitRoute(token)}`;

  createReviewContext({
    token,
    target: targetLabel,
    payload,
    submitUrl,
    onSubmit: async (submitPayload: CommentSubmitPayload) => {
      try {
        await injectCommentsIntoPi(pi, submitPayload, ctx);
        notifySuccess(ctx, `Review submitted: ${submitPayload.comments.length} comments added to Pi.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        notifyError(ctx, `Failed to inject comments into Pi: ${message}`);
        throw error;
      } finally {
        removeActiveReview(token);
        disposeReviewContext(token);
      }
    },
  });

  addActiveReview({
    token,
    createdAt: Date.now(),
    target: `${targetLabel} (${payload.files.length} files)`,
  });

  try {
    const selection = cmuxMode.selection;
    if (selection.kind === "new-pane") {
      await openCmuxPane(pi, {
        url: reviewUrl,
        mode: "new-pane",
      });
    } else {
      await openCmuxPane(pi, {
        url: reviewUrl,
        mode: "existing-pane",
        paneId: selection.paneId,
      });
    }
  } catch (error) {
    removeActiveReview(token);
    disposeReviewContext(token);

    const message = error instanceof Error ? error.message : "Unknown cmux open error";
    notifyError(ctx, message);
    return;
  }

  notifyInfo(
    ctx,
    `${server.reused ? "Reused" : "Started"} review server on ${server.host}:${server.port}. Token: ${token}. Target: ${targetLabel}. Files: ${payload.files.length}.`,
  );
  notifyInfo(ctx, `Opened review in cmux: ${reviewUrl}`);
  notifyInfo(ctx, `Internal submit endpoint (do not open in browser): ${submitUrl}`);
}

async function handleCmuxDiffStatus(_args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  const message = await renderStatusMessage(pi);
  notifyInfo(ctx, `status: ${message}`);
}

async function handleCmuxDiffKill(_args: string, ctx: ExtensionCommandContext, _pi: ExtensionAPI): Promise<void> {
  const statusBeforeKill = getServerStatus();
  const runtimeBeforeKill = getRuntimeStatusSnapshot();

  if (!statusBeforeKill.running && runtimeBeforeKill.activeReviewCount === 0) {
    notifyInfo(ctx, "Kill requested, but runtime is already stopped (no-op).");
    return;
  }

  // Report what we're about to clean up
  const activeTokens = runtimeBeforeKill.activeReviews.map((r) => r.token).join(", ") || "none";
  notifyInfo(ctx, `Stopping server and clearing ${runtimeBeforeKill.activeReviewCount} active review(s) (${activeTokens})...`);

  setServerState("stopping");

  let stopResult: { stopped: boolean; contextsCleared: boolean };
  try {
    stopResult = stopServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    notifyError(ctx, `Error during server stop: ${message}. Proceeding with state cleanup...`);
    stopResult = { stopped: false, contextsCleared: false };
  }

  // Always reset runtime state even if server stop failed
  resetRuntimeState();

  if (stopResult.stopped && stopResult.contextsCleared) {
    notifyWarning(ctx, "Review server stopped and all review contexts cleared.");
  } else if (!stopResult.stopped) {
    notifyWarning(ctx, "No server process was running, but review registry/runtime state was cleared.");
  } else {
    notifyWarning(ctx, "Server stopped but context cleanup may be incomplete. Runtime state reset.");
  }
}

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("cmux-diff", {
    description: "Open cmux diff review",
    handler: (args, ctx) => handleCmuxDiff(args, ctx, pi),
  });

  pi.registerCommand("cmux-diff-status", {
    description: "Show cmux diff runtime status",
    handler: (args, ctx) => handleCmuxDiffStatus(args, ctx, pi),
  });

  pi.registerCommand("cmux-diff-kill", {
    description: "Stop cmux diff runtime and clear active reviews",
    handler: (args, ctx) => handleCmuxDiffKill(args, ctx, pi),
  });
}
