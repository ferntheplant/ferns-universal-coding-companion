import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface VerifyConfig {
  /** Shell command run in the worktree (e.g. "pnpm run llm:verify"). */
  command: string;
  maxAttempts: number;
  timeoutMinutes: number;
}

export type ReviewAdapterName = "greptile" | "codex" | "claude";

/** A local CLI reviewer (codex / claude) run headless in the worktree. */
export interface CliReviewerConfig {
  /** Model passed to the CLI (codex -m / claude --model). */
  model: string;
  /** Reasoning effort (codex model_reasoning_effort / claude --effort). */
  effort: string;
}

export interface ReviewConfig {
  adapter: ReviewAdapterName;
  maxRounds: number;
  /** Base branch the PR is reviewed against. */
  baseBranch: string;
  /** Case-insensitive substring matched against comment author logins. */
  botPattern: string;
  /** PR comment that triggers a review round. */
  triggerComment: string;
  /**
   * Case-insensitive marker locating the "prompt to fix all with AI" section
   * in greptile's summary comment — the primary completion/content signal.
   */
  fixSectionMarker: string;
  pollIntervalSeconds: number;
  timeoutMinutes: number;
  codex: CliReviewerConfig;
  claude: CliReviewerConfig;
  /** Wall-clock cap for one local CLI reviewer run. */
  cliTimeoutMinutes: number;
}

export interface QaConfig {
  enabled: boolean;
  maxRounds: number;
}

export interface BudgetConfig {
  maxTokensPerRun: number;
  maxWallClockMinutes: number;
  /** Context percent that triggers the one allowed auto-compact per run. */
  contextPercentCompact: number;
}

/**
 * Per-provider quota thresholds checked against pi-usage via the events bus,
 * keyed by pi-usage provider id ("codex" | "zen" | "cursor" | "go" | ...).
 * Label-agnostic on purpose: maxPercent trips on ANY percent bar the provider
 * reports (5h, weekly, ...), minDollars on any dollar balance.
 */
export interface QuotaThreshold {
  maxPercent?: number;
  minDollars?: number;
}
export type QuotaThresholds = Record<string, QuotaThreshold>;

export interface MergeConfig {
  autoMergeWhenGreen: boolean;
}

export interface AutopilotConfig {
  /** Ordered gate pipeline. Adding a stage is config + one module. */
  gates: string[];
  verify: VerifyConfig;
  review: ReviewConfig;
  qa: QaConfig;
  budget: BudgetConfig;
  quota: QuotaThresholds;
  merge: MergeConfig;
}

/** On-disk shape: global config plus per-repo overrides keyed by repo root path. */
type ConfigFile = Partial<AutopilotConfig> & {
  repos?: Record<string, Partial<AutopilotConfig>>;
};

export const DEFAULT_CONFIG: AutopilotConfig = {
  // "qa" joins the default once phase 4 lands.
  gates: ["verify", "ship", "review"],
  verify: { command: "pnpm run llm:verify", maxAttempts: 3, timeoutMinutes: 10 },
  review: {
    adapter: "greptile",
    maxRounds: 3,
    baseBranch: "main",
    botPattern: "greptile",
    triggerComment: "@greptile review",
    fixSectionMarker: "prompt to fix",
    pollIntervalSeconds: 20,
    timeoutMinutes: 15,
    codex: { model: "gpt-5.4", effort: "medium" },
    claude: { model: "opus", effort: "medium" },
    cliTimeoutMinutes: 20,
  },
  qa: { enabled: false, maxRounds: 2 },
  budget: { maxTokensPerRun: 2_000_000, maxWallClockMinutes: 90, contextPercentCompact: 80 },
  quota: {},
  merge: { autoMergeWhenGreen: false },
};

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-autopilot", "config.json");

function mergeConfig(base: AutopilotConfig, patch: Partial<AutopilotConfig>): AutopilotConfig {
  return {
    gates: patch.gates ?? base.gates,
    verify: { ...base.verify, ...patch.verify },
    review: { ...base.review, ...patch.review },
    qa: { ...base.qa, ...patch.qa },
    budget: { ...base.budget, ...patch.budget },
    quota: { ...base.quota, ...patch.quota },
    merge: { ...base.merge, ...patch.merge },
  };
}

/**
 * defaults <- global config file <- longest repos[...] key that is a path
 * prefix of cwd. Nothing repo-specific is hardcoded.
 */
export function loadConfig(cwd: string): AutopilotConfig {
  let config = DEFAULT_CONFIG;
  if (!existsSync(CONFIG_PATH)) return config;

  let file: ConfigFile;
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ConfigFile;
  } catch (error) {
    throw new Error(
      `Failed to parse ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  config = mergeConfig(config, file);

  const absoluteCwd = resolve(cwd);
  const repoKeys = Object.keys(file.repos ?? {})
    .filter((key) => absoluteCwd === resolve(key) || absoluteCwd.startsWith(`${resolve(key)}/`))
    .sort((a, b) => b.length - a.length);
  const repoKey = repoKeys[0];
  if (repoKey && file.repos) {
    config = mergeConfig(config, file.repos[repoKey]!);
  }
  return config;
}

export function attemptCapFor(gateId: string, config: AutopilotConfig): number {
  switch (gateId) {
    case "verify":
      return config.verify.maxAttempts;
    case "review":
      return config.review.maxRounds;
    case "qa":
      return config.qa.maxRounds;
    default:
      return 3;
  }
}
