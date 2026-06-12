import type { AutopilotConfig } from "./config";
import type { RunState } from "./types";

/**
 * In-memory state for the (single) armed run in this Pi session.
 * One armed run per session; cmux already gives one session per worktree.
 *
 * TODO(phase 3): rebuild this from pi.appendEntry entries on session_start so
 * /auto-resume survives a Pi restart.
 */

interface Runtime {
  run: RunState | null;
  config: AutopilotConfig | null;
}

const runtime: Runtime = {
  run: null,
  config: null,
};

export function getRun(): RunState | null {
  return runtime.run;
}

export function getConfig(): AutopilotConfig | null {
  return runtime.config;
}

export function startRun(options: {
  config: AutopilotConfig;
  baselineDirtyPaths: string[];
  extraInstructions?: string;
}): RunState {
  runtime.config = options.config;
  runtime.run = {
    phase: "working",
    armedAt: Date.now(),
    extraInstructions: options.extraInstructions,
    gateCursor: 0,
    attempts: {},
    baselineDirtyPaths: options.baselineDirtyPaths,
    injectedFindingFingerprints: new Set(),
    tokensSpent: 0,
    costSpent: 0,
    compactedOnce: false,
    suppressAutoPause: false,
  };
  return runtime.run;
}

/** Install a run rebuilt from a persisted snapshot (session restore). */
export function restoreRun(run: RunState, config: AutopilotConfig): RunState {
  runtime.run = run;
  runtime.config = config;
  return run;
}

export function endRun(): void {
  runtime.run = null;
  runtime.config = null;
}
