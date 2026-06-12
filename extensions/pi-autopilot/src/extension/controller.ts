import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkSpendAllowed } from "./budget";
import { classifyFinalMessage } from "./classify";
import { attemptCapFor, loadConfig } from "./config";
import { emitArmedState } from "./events";
import { resolveGates } from "./gates/registry";
import { endRun, getConfig, getRun, restoreRun, startRun } from "./runtime";
import { clearSidebar, updateSidebar, updateWidget } from "./status";
import type { AutopilotPhase, Finding, GateResult, RunSnapshot, RunState } from "./types";

const ENTRY_TYPE = "pi-autopilot";

function toSnapshot(run: RunState): RunSnapshot {
  return { ...run, injectedFindingFingerprints: [...run.injectedFindingFingerprints] };
}

function fromSnapshot(snapshot: RunSnapshot): RunState {
  return {
    ...snapshot,
    injectedFindingFingerprints: new Set(snapshot.injectedFindingFingerprints),
  };
}

/**
 * Fingerprint for dedup across rounds. Verify failures share one title across
 * attempts, so body content distinguishes genuinely new failures; review/qa
 * titles are LLM-normalized to be stable, so title-only dedup absorbs
 * reviewers repeating themselves in edited summaries.
 */
function fingerprint(finding: Finding): string {
  const bodyPart =
    finding.source === "verify"
      ? createHash("sha256").update(finding.body).digest("hex").slice(0, 16)
      : "";
  return [finding.source, finding.file ?? "", finding.title, bodyPart].join("|");
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

async function transition(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  run: RunState,
  phase: AutopilotPhase,
  reason?: string,
): Promise<void> {
  run.phase = phase;
  if (phase === "needs_human") run.needsHumanReason = reason;
  // Full snapshot per transition: session entries are the crash-recovery
  // record that restoreFromSession() rebuilds the run from.
  pi.appendEntry(ENTRY_TYPE, { at: Date.now(), reason, snapshot: toSnapshot(run) });
  await updateSidebar(pi, phase, reason ? firstLine(reason) : undefined);
  updateWidget(ctx, run, getConfig()?.gates ?? []);
}

async function needsHuman(pi: ExtensionAPI, ctx: ExtensionContext, reason: string): Promise<void> {
  const run = getRun();
  if (!run) return;
  await transition(pi, ctx, run, "needs_human", reason);
  ctx.ui.notify(`Autopilot needs you: ${reason}`, "warning");
  if (process.platform === "darwin") {
    void pi
      .exec(
        "osascript",
        [
          "-e",
          `display notification ${JSON.stringify(firstLine(reason).slice(0, 120))} with title "pi-autopilot needs you"`,
        ],
        { timeout: 5000 },
      )
      .catch(() => {});
  }
}

function findingsPrompt(gateId: string, findings: Finding[]): string {
  const items = findings
    .map((finding, index) => {
      const location = finding.file
        ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})`
        : "";
      return `${index + 1}. [${finding.source}] ${finding.title}${location}\n${finding.body}`;
    })
    .join("\n\n");
  return [
    `Autopilot: the "${gateId}" gate returned ${findings.length} finding(s):`,
    "",
    items,
    "",
    "For each finding: fix it if it's a genuine issue, or explicitly reject it with one",
    "line of reasoning. When done, call report_status.",
  ].join("\n");
}

export async function arm(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  extraInstructions?: string,
): Promise<void> {
  if (getRun()) {
    ctx.ui.notify("Autopilot is already armed (/auto-status, /auto-off).", "warning");
    return;
  }

  let config;
  try {
    config = loadConfig(ctx.cwd);
    resolveGates(config.gates);
  } catch (error) {
    ctx.ui.notify(
      `Autopilot config error: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }

  const statusResult = await pi.exec("git", ["status", "--porcelain"], {
    cwd: ctx.cwd,
    timeout: 30_000,
  });
  if (statusResult.code !== 0) {
    ctx.ui.notify(
      `Autopilot: not a git repo? git status failed: ${statusResult.stderr.trim()}`,
      "error",
    );
    return;
  }
  const baselineDirtyPaths = statusResult.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());

  const run = startRun({
    config,
    baselineDirtyPaths,
    extraInstructions: extraInstructions || undefined,
  });
  emitArmedState(pi, true);
  await transition(pi, ctx, run, "working");

  const dirtyNote =
    baselineDirtyPaths.length > 0
      ? ` Note: ${baselineDirtyPaths.length} pre-existing dirty path(s) — ship will refuse to commit them.`
      : "";
  ctx.ui.notify(`Autopilot armed (gates: ${config.gates.join(" → ")}).${dirtyNote}`, "info");
}

export async function disarm(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!getRun()) {
    ctx.ui.notify("Autopilot is not armed.", "info");
    return;
  }
  endRun();
  emitArmedState(pi, false);
  await clearSidebar(pi);
  updateWidget(ctx, null, []);
  ctx.ui.notify("Autopilot disarmed.", "info");
}

export async function pause(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const run = getRun();
  if (!run || run.phase === "paused") {
    ctx.ui.notify(run ? "Autopilot is already paused." : "Autopilot is not armed.", "info");
    return;
  }
  run.pausedFromPhase = run.phase;
  await transition(pi, ctx, run, "paused");
  ctx.ui.notify("Autopilot paused (/auto-resume to continue).", "info");
}

export async function resume(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const run = getRun();
  if (!run) {
    ctx.ui.notify("Autopilot is not armed.", "info");
    return;
  }
  if (run.phase === "paused") {
    const target = run.pausedFromPhase ?? "working";
    run.pausedFromPhase = undefined;
    await transition(pi, ctx, run, target);
    if (target === "gating") {
      void runGatesGuarded(pi, ctx);
      return;
    }
    ctx.ui.notify("Autopilot resumed — waiting for the agent's next stop.", "info");
    return;
  }
  if (run.phase === "needs_human") {
    await transition(pi, ctx, run, "working");
    ctx.ui.notify("Autopilot resumed — waiting for the agent's next stop.", "info");
    return;
  }
  ctx.ui.notify(`Autopilot is ${run.phase}; nothing to resume.`, "info");
}

export function statusLines(): string[] {
  const run = getRun();
  const config = getConfig();
  if (!run || !config) return ["Autopilot: idle (arm with /auto)"];
  const attempts = Object.entries(run.attempts)
    .map(([gate, used]) => `${gate} ${used}/${attemptCapFor(gate, config)}`)
    .join(", ");
  return [
    `Autopilot: ${run.phase}${run.needsHumanReason ? ` — ${run.needsHumanReason}` : ""}`,
    `gates: ${config.gates.join(" → ")} (cursor ${run.gateCursor})`,
    `attempts: ${attempts || "none"}`,
    `armed: ${new Date(run.armedAt).toLocaleTimeString()}, findings injected: ${run.injectedFindingFingerprints.size}`,
    `spend: ${Math.round(run.tokensSpent / 1000)}k tokens ($${run.costSpent.toFixed(2)}), compacted: ${run.compactedOnce ? "yes" : "no"}`,
  ];
}

/**
 * Rebuild a run from the last persisted snapshot in the session (crash /
 * restart recovery). Restored runs always come back PAUSED — a reloaded
 * session should never start committing or polling on its own; the operator
 * reviews /auto-status and decides with /auto-resume.
 */
export async function restoreFromSession(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (getRun()) return;

  let lastSnapshot: RunSnapshot | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    const data = (entry as { data?: { snapshot?: RunSnapshot } }).data;
    if (data?.snapshot) lastSnapshot = data.snapshot;
  }
  if (!lastSnapshot) return;
  if (lastSnapshot.phase === "ready" || lastSnapshot.phase === "idle") return;

  let config;
  try {
    config = loadConfig(ctx.cwd);
    resolveGates(config.gates);
  } catch {
    return; // config broke since the snapshot; arming fresh will surface the error
  }

  const run = fromSnapshot(lastSnapshot);
  run.pausedFromPhase =
    run.phase === "paused"
      ? run.pausedFromPhase
      : run.phase === "needs_human"
        ? "working"
        : run.phase;
  run.phase = "paused";
  restoreRun(run, config);
  emitArmedState(pi, true);
  await updateSidebar(pi, "paused", "restored from session");
  updateWidget(ctx, run, config.gates);
  ctx.ui.notify(
    "Autopilot: restored a previous run (paused). /auto-status to inspect, /auto-resume to continue, /auto-off to drop it.",
    "info",
  );
}

/**
 * Tick: called on every agent_end. Only "working" (normal flow) and
 * "needs_human" (operator answered in-chat; the agent's next stop re-enters
 * the loop) phases react.
 */
export async function onAgentEnd(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  messages: unknown[],
): Promise<void> {
  const run = getRun();
  if (!run) return;
  if (run.phase !== "working" && run.phase !== "needs_human") return;

  let report = run.lastReport;

  if (!report) {
    // Fallback classifier: the agent forgot report_status; classify its final
    // message instead of parking immediately. Unclassifiable → needs_human.
    const classification = await classifyFinalMessage(ctx, messages);
    if (!classification) {
      await needsHuman(pi, ctx, "agent stopped without report_status (and classifier failed)");
      return;
    }
    report = {
      status:
        classification.kind === "complete"
          ? "complete"
          : classification.kind === "question"
            ? "need_input"
            : "blocked",
      summary: classification.summary,
      reportedAt: Date.now(),
    };
  }

  if (report.status !== "complete") {
    run.lastReport = undefined;
    const label = report.status === "need_input" ? "agent has a question" : "agent is blocked";
    await needsHuman(pi, ctx, `${label}: ${firstLine(report.summary)}`);
    return;
  }

  // Keep the complete report visible to the ship gate (latest summary = this
  // round's commit message); agent_start clears it at the next loop anyway.
  run.lastReport = report;
  run.firstSummary ??= report.summary;

  // Context guard: one auto-compaction per run, then escalate. Done here (not
  // in checkSpendAllowed) because compaction needs the agent idle.
  const usage = ctx.getContextUsage();
  if (usage?.percent != null && usage.percent >= getConfig()!.budget.contextPercentCompact) {
    if (run.compactedOnce) {
      await needsHuman(
        pi,
        ctx,
        `context at ${Math.round(usage.percent)}% again after the run's one auto-compaction`,
      );
      return;
    }
    run.compactedOnce = true;
    ctx.ui.notify(
      `Autopilot: context at ${Math.round(usage.percent)}% — compacting before continuing.`,
      "info",
    );
    await new Promise<void>((resolve) => {
      ctx.compact({ onComplete: () => resolve(), onError: () => resolve() });
    });
  }

  // Detached on purpose: gates can run for minutes (verify, review polling)
  // and must not block the agent_end event chain.
  void runGatesGuarded(pi, ctx);
}

async function runGatesGuarded(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  try {
    await runGates(pi, ctx);
  } catch (error) {
    await needsHuman(
      pi,
      ctx,
      `gate pipeline threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runGates(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const run = getRun();
  const config = getConfig();
  if (!run || !config) return;

  const gates = resolveGates(config.gates);
  await transition(pi, ctx, run, "gating");

  while (run.gateCursor < gates.length) {
    const currentRun = getRun();
    if (currentRun !== run || run.phase !== "gating") return; // disarmed or paused mid-pipeline

    const gate = gates[run.gateCursor]!;
    updateWidget(ctx, run, config.gates);
    await updateSidebar(pi, "gating", gate.id);
    const result: GateResult = await gate.run({ pi, ctx, cwd: ctx.cwd, config, run });
    run.gateNote = undefined;
    // A pause/disarm that landed while the gate was running wins over the
    // gate's result (e.g. the review poller returns needs_human when
    // interrupted — that must not clobber "paused").
    if (getRun() !== run || run.phase !== "gating") return;

    if (result.status === "pass") {
      run.gateCursor += 1;
      continue;
    }
    if (result.status === "needs_human") {
      await needsHuman(pi, ctx, result.reason);
      return;
    }

    const cap = attemptCapFor(gate.id, config);
    const used = (run.attempts[gate.id] = (run.attempts[gate.id] ?? 0) + 1);
    if (used > cap) {
      await needsHuman(pi, ctx, `gate "${gate.id}" exceeded ${cap} attempts`);
      return;
    }

    const fresh = result.findings.filter((finding) => {
      const print = fingerprint(finding);
      if (run.injectedFindingFingerprints.has(print)) return false;
      run.injectedFindingFingerprints.add(print);
      return true;
    });
    if (fresh.length === 0) {
      await needsHuman(pi, ctx, `gate "${gate.id}" keeps failing with already-reported findings`);
      return;
    }

    const spend = await checkSpendAllowed(pi, ctx, config, run);
    if (!spend.ok) {
      await needsHuman(pi, ctx, `paused on budget/quota: ${spend.reason}`);
      return;
    }

    // Findings restart the pipeline from gate 0 after the agent's fix pass.
    run.gateCursor = 0;
    await transition(pi, ctx, run, "working", `fixing ${gate.id} findings (round ${used}/${cap})`);
    pi.sendUserMessage(findingsPrompt(gate.id, fresh));
    return;
  }

  await transition(pi, ctx, run, "ready");
  ctx.ui.notify("Autopilot: all gates passed — ready to merge.", "info");
  // TODO(phase 4): config.merge.autoMergeWhenGreen → `gh pr merge --auto -s -d`
  // (remote-only; /auto-cleanup handles the local worktree + cmux workspace).
}
