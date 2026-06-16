import { createHash } from "node:crypto";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import { updateSidebar, updateWidget } from "../status";
import type { Finding, GateContext, GateResult } from "../types";
import { normalizeFindings } from "./review-normalize";

/**
 * Greptile review gate. We never parse greptile's comment layout structurally
 * and we never treat "something changed and went quiet" as completion (greptile
 * edits an "in progress" placeholder into its summary right after triggering,
 * which a settle heuristic misreads as a finished clean review).
 *
 * A round completes ONLY on an explicit signal:
 *  1. FINDINGS: the "prompt to fix all with AI" section of a greptile summary
 *     comment changed vs the pre-trigger baseline (greptile updates it in
 *     place) AND the bot's artifacts were stable across two consecutive polls.
 *     The section is ready-made fix content — parsed directly into findings,
 *     no LLM needed.
 *  2. CLEAN/OTHER: the greptile CI check completed after our trigger. Whatever
 *     artifact diff exists then is LLM-normalized; an empty/unactionable diff
 *     passes the gate.
 *
 * A CONFLICTING PR short-circuits before triggering: no checks or review will
 * ever run, so the conflict itself is returned as an agent-fixable finding.
 */

interface Artifact {
  /** "<kind>:<id>" — stable across polls. */
  key: string;
  kind: "issue_comment" | "review_comment" | "review";
  author: string;
  body: string;
}

type Snapshot = Map<string, Artifact>;

interface ArtifactChange {
  artifact: Artifact;
  /** Body before the edit; undefined for brand-new artifacts. */
  previousBody?: string;
}

const COMPLETED_BUCKETS = new Set(["pass", "fail", "cancel", "skipping"]);
/** Tolerance between GitHub timestamps and the local clock. */
const CLOCK_SKEW_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function bodyHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function gh(gate: GateContext, args: string[]): Promise<ExecResult> {
  return gate.pi.exec("gh", args, { cwd: gate.cwd, timeout: 60_000 });
}

function fail(step: string, result: ExecResult): GateResult {
  const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-1000);
  return { status: "needs_human", reason: `review: ${step} failed (exit ${result.code}): ${tail}` };
}

function note(gate: GateContext, text: string): void {
  gate.run.gateNote = text;
  updateWidget(gate.ctx, gate.run, gate.config.gates);
  void updateSidebar(gate.pi, "gating", text);
}

interface RawComment {
  id: number;
  user?: { login?: string };
  body?: string;
}

async function fetchBotArtifacts(
  gate: GateContext,
  prNumber: number,
): Promise<Snapshot | GateResult> {
  const pattern = gate.config.review.botPattern.toLowerCase();
  const endpoints: Array<{ kind: Artifact["kind"]; path: string }> = [
    {
      kind: "issue_comment",
      path: `repos/{owner}/{repo}/issues/${prNumber}/comments?per_page=100`,
    },
    {
      kind: "review_comment",
      path: `repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100`,
    },
    { kind: "review", path: `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100` },
  ];

  const snapshot: Snapshot = new Map();
  for (const endpoint of endpoints) {
    const result = await gh(gate, ["api", endpoint.path]);
    if (result.code !== 0) return fail(`fetch ${endpoint.kind}s`, result);
    const items = JSON.parse(result.stdout) as RawComment[];
    for (const item of items) {
      const author = item.user?.login ?? "";
      const body = item.body ?? "";
      if (!author.toLowerCase().includes(pattern) || !body.trim()) continue;
      const artifact: Artifact = {
        key: `${endpoint.kind}:${item.id}`,
        kind: endpoint.kind,
        author,
        body,
      };
      snapshot.set(artifact.key, artifact);
    }
  }
  return snapshot;
}

/** Order-independent hash of the full bot-artifact state, for stability checks. */
function snapshotHash(snapshot: Snapshot): string {
  const parts = [...snapshot.keys()]
    .sort()
    .map((key) => `${key}:${bodyHash(snapshot.get(key)!.body)}`);
  return bodyHash(parts.join("\n"));
}

function diffSnapshots(before: Snapshot, after: Snapshot): ArtifactChange[] {
  const changes: ArtifactChange[] = [];
  for (const [key, artifact] of after) {
    const previous = before.get(key);
    if (!previous) {
      changes.push({ artifact });
    } else if (previous.body !== artifact.body) {
      changes.push({ artifact, previousBody: previous.body });
    }
  }
  return changes;
}

/** For in-place-edited bodies, only lines that weren't there before count. */
function addedContent(change: ArtifactChange): string {
  if (change.previousBody === undefined) return change.artifact.body;
  const oldLines = new Set(change.previousBody.split("\n").map((line) => line.trim()));
  return change.artifact.body
    .split("\n")
    .filter((line) => !oldLines.has(line.trim()))
    .join("\n");
}

function changesToRawText(changes: ArtifactChange[]): string {
  return changes
    .map((change) => {
      const status = change.previousBody === undefined ? "new" : "edited (added content only)";
      const content = addedContent(change).trim();
      return content
        ? `--- ${change.artifact.kind} by ${change.artifact.author} [${status}] ---\n${content}`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Locate the "prompt to fix all with AI" section in a summary comment body.
 * Prefers the fenced code block following the marker; falls back to the raw
 * tail so a format tweak degrades to noisier-but-working behavior.
 */
function extractFixSection(body: string, marker: string): string | null {
  const index = body.toLowerCase().indexOf(marker.toLowerCase());
  if (index === -1) return null;
  const after = body.slice(index);
  const fence = after.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  return after.slice(0, 4000).trim();
}

/** key → fix-section text, for every summary comment that has one. */
function fixSectionsOf(snapshot: Snapshot, marker: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const [key, artifact] of snapshot) {
    if (artifact.kind !== "issue_comment") continue;
    const section = extractFixSection(artifact.body, marker);
    if (section) sections.set(key, section);
  }
  return sections;
}

/** Sections that are new or whose content hash changed vs the baseline. */
function changedFixSections(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [key, section] of after) {
    const previous = before.get(key);
    if (previous === undefined || bodyHash(previous) !== bodyHash(section)) changed.push(section);
  }
  return changed;
}

const FILE_PATH_RE = /([A-Za-z0-9_@./-]+\.[A-Za-z0-9]{1,8})/;

/** The fix-all prompt is one paragraph per issue; each becomes a finding. */
function parseFixSections(sections: string[]): Finding[] {
  return sections
    .join("\n\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const firstLine = paragraph.split("\n")[0]!.trim();
      return {
        source: "review",
        file: paragraph.match(FILE_PATH_RE)?.[1],
        title: firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine,
        body: paragraph,
      };
    });
}

interface RawCheck {
  name?: string;
  bucket?: string;
  completedAt?: string;
}

/**
 * Whether a bot check run completed after our trigger. `gh pr checks` exit
 * codes are unreliable (8 = pending, 1 = failures), so only parseable stdout
 * counts; no checks reported yet (conflicts, reporting lag) is just "not yet".
 */
async function botCheckCompleted(gate: GateContext, triggerAtMs: number): Promise<boolean> {
  const result = await gate.pi.exec("gh", ["pr", "checks", "--json", "name,bucket,completedAt"], {
    cwd: gate.cwd,
    timeout: 60_000,
  });
  let checks: RawCheck[];
  try {
    checks = JSON.parse(result.stdout) as RawCheck[];
  } catch {
    return false;
  }
  const pattern = gate.config.review.botPattern.toLowerCase();
  return checks.some(
    (check) =>
      (check.name ?? "").toLowerCase().includes(pattern) &&
      COMPLETED_BUCKETS.has(check.bucket ?? "") &&
      (Date.parse(check.completedAt ?? "") || 0) > triggerAtMs - CLOCK_SKEW_MS,
  );
}

/**
 * One greptile review round. HEAD-skip semantics and lastReviewSha bookkeeping
 * live in the dispatcher (gates/review.ts); headSha is only used to label the
 * merge-conflict finding.
 */
export async function runGreptileReview(gate: GateContext, headSha: string): Promise<GateResult> {
  const { triggerComment, fixSectionMarker, pollIntervalSeconds, timeoutMinutes } =
    gate.config.review;
  const round = (gate.run.attempts["review"] ?? 0) + 1;

  const prResult = await gh(gate, ["pr", "view", "--json", "number,mergeable"]);
  if (prResult.code !== 0) return fail("pr view (no PR for this branch?)", prResult);
  const pr = JSON.parse(prResult.stdout) as { number: number; mergeable?: string };
  if (pr.mergeable === "CONFLICTING") {
    // No checks or review will ever run on a conflicted PR — make the
    // conflict itself the finding instead of waiting on a signal that
    // cannot arrive. Title includes the sha so a later re-conflict in the
    // same run isn't swallowed by fingerprint dedup.
    return {
      status: "findings",
      findings: [
        {
          source: "review",
          title: `PR #${pr.number} has merge conflicts with the base branch (HEAD ${headSha.slice(0, 7)})`,
          body:
            "Merge the base branch into this branch (do NOT rebase — autopilot never force-pushes), " +
            "resolve the conflicts, and report_status when the tree is clean.",
        },
      ],
    };
  }

  const baseline = await fetchBotArtifacts(gate, pr.number);
  if (baseline instanceof Map === false) return baseline;
  const baselineSections = fixSectionsOf(baseline, fixSectionMarker);

  const trigger = await gh(gate, ["pr", "comment", String(pr.number), "--body", triggerComment]);
  if (trigger.code !== 0) return fail("trigger comment", trigger);
  const triggerAtMs = Date.now();
  const deadline = triggerAtMs + timeoutMinutes * 60_000;

  const complete = (result: GateResult): GateResult => {
    gate.run.gateNote = undefined;
    return result;
  };

  let previousPollHash: string | null = null;
  while (Date.now() < deadline) {
    await sleep(pollIntervalSeconds * 1000);
    if (gate.run.phase !== "gating") {
      return {
        status: "needs_human",
        reason: "review polling interrupted (run paused or disarmed)",
      };
    }
    const elapsedMin = Math.round((Date.now() - triggerAtMs) / 60_000);
    note(
      gate,
      `review round ${round}: waiting on ${gate.config.review.botPattern} (${elapsedMin}m)`,
    );

    const current = await fetchBotArtifacts(gate, pr.number);
    if (current instanceof Map === false) return current;

    const pollHash = snapshotHash(current);
    const stable = pollHash === previousPollHash;
    previousPollHash = pollHash;
    const changedVsBaseline = pollHash !== snapshotHash(baseline);

    // Signal 1: the fix-all-with-AI section changed and the artifacts are
    // stable — the review produced findings. Parsed directly; no LLM.
    if (changedVsBaseline && stable) {
      const sections = changedFixSections(
        baselineSections,
        fixSectionsOf(current, fixSectionMarker),
      );
      if (sections.length > 0) {
        const findings = parseFixSections(sections);
        if (findings.length > 0) return complete({ status: "findings", findings });
      }
    }

    // Signal 2: the bot's check run completed after our trigger — the round
    // is over regardless of comment shape. Normalize whatever the diff
    // holds; nothing actionable (clean review) passes the gate. A changed-
    // but-checkless snapshot is greptile's in-progress placeholder edit:
    // NOT completion, keep waiting.
    if (await botCheckCompleted(gate, triggerAtMs)) {
      const rawText = changesToRawText(diffSnapshots(baseline, current));
      if (!rawText.trim()) return complete({ status: "pass" });
      gate.ctx.ui.notify(
        `Review round ${round}: greptile check completed, normalizing review diff`,
        "info",
      );
      const findings = await normalizeFindings(gate, rawText);
      if (findings.length === 0) return complete({ status: "pass" });
      return complete({ status: "findings", findings });
    }
  }

  return {
    status: "needs_human",
    reason: `review: no completion signal within ${timeoutMinutes}m on PR #${pr.number} (check never finished and no fix-prompt change)`,
  };
}
