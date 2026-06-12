import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutopilotConfig } from "./config";

/**
 * Canonical actionable item produced by any gate. The fix-injection path does
 * not know or care whether a finding came from llm:verify, greptile, or QA.
 */
export interface Finding {
  /** Gate that produced this finding ("verify", "review", "qa", ...). */
  source: string;
  file?: string;
  line?: number;
  title: string;
  body: string;
  severity?: "low" | "medium" | "high";
}

export type GateResult =
  | { status: "pass" }
  | { status: "findings"; findings: Finding[] }
  | { status: "needs_human"; reason: string };

export interface GateContext {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  /** Worktree root the agent is operating in. */
  cwd: string;
  config: AutopilotConfig;
  run: RunState;
}

/**
 * A quality check between "agent says done" and "ready to merge". Verify,
 * ship, review, and QA are all gates behind this interface; the configured
 * gate order is the pipeline. Attempt caps are resolved by the controller
 * from config, not stored on the gate.
 */
export interface Gate {
  id: string;
  run(gate: GateContext): Promise<GateResult>;
}

export type ReportedStatus = "complete" | "need_input" | "blocked";

/** Recorded when the agent calls the report_status tool. */
export interface StatusReport {
  status: ReportedStatus;
  summary: string;
  reportedAt: number;
}

export type AutopilotPhase = "idle" | "working" | "gating" | "paused" | "needs_human" | "ready";

/** In-memory state for one armed autopilot run. */
export interface RunState {
  phase: AutopilotPhase;
  armedAt: number;
  /** Extra operator instructions passed to /auto. */
  extraInstructions?: string;
  /** Index into config.gates for the gate currently being evaluated. */
  gateCursor: number;
  /** Attempts used per gate id (a "findings" result consumes one attempt). */
  attempts: Record<string, number>;
  /** Paths that were already dirty when the run was armed (pre-existing dirt is never committed). */
  baselineDirtyPaths: string[];
  /** sha256 of the last verify failure tail; identical hash twice in a row = stuck. */
  lastVerifyFailureHash?: string;
  /** HEAD sha of the last completed review round; review only re-triggers on new commits. */
  lastReviewSha?: string;
  /** Last report_status tool call observed during the current agent loop. */
  lastReport?: StatusReport;
  /** First report summary of the run; reused for PR title/body. */
  firstSummary?: string;
  /** Fingerprints of findings already injected, so reviewers repeating themselves don't cause duplicate fix loops. */
  injectedFindingFingerprints: Set<string>;
  /** Why the run is parked in needs_human, when it is. */
  needsHumanReason?: string;
  /** Live progress note from the currently running gate (shown in the widget). */
  gateNote?: string;
  /** Phase to return to on /auto-resume. */
  pausedFromPhase?: AutopilotPhase;
  /** Tokens summed across finalized assistant messages while armed. */
  tokensSpent: number;
  /** USD cost summed across finalized assistant messages while armed. */
  costSpent: number;
  /** The one allowed auto-compaction per run has been used. */
  compactedOnce: boolean;
  /** Suppress auto-pause while the autopilot is injecting its own prompt. */
  suppressAutoPause: boolean;
}

/** JSON-safe snapshot of RunState persisted via appendEntry for crash recovery. */
export type RunSnapshot = Omit<RunState, "injectedFindingFingerprints"> & {
  injectedFindingFingerprints: string[];
};
