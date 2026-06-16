import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateSidebar, updateWidget } from "../status";
import type { GateContext, GateResult } from "../types";
import { normalizeFindings } from "./review-normalize";

/**
 * Local CLI reviewer adapter: run codex or claude headless in the worktree,
 * capture the review text, LLM-normalize it into Finding[]. Cheaper and
 * faster than greptile (no GitHub round-trip, no polling) but leaves no PR
 * audit trail.
 *
 * Invocations (verified against codex-cli 0.139.0 / claude 2.1.175):
 * - codex:  `codex exec review --base <branch> -m <model>
 *            -c model_reasoning_effort="<effort>" -o <file>`
 *           `--base` makes it review the branch diff as a PR against main;
 *           `-o` writes the final review message to a file so we don't have
 *           to scrape it out of the progress output.
 * - claude: `claude -p --model <model> --effort <effort>
 *            --allowedTools <gh pr ...> "/review <pr#>"`
 *           The built-in /review prompt runs `gh pr list` interactively when
 *           no PR number is given — which stalls headless — so the PR number
 *           is required, and the gh commands it runs must be pre-allowed
 *           because print mode cannot answer permission prompts. Reviewing
 *           the PR is reviewing against main: main is the PR's base.
 */

function note(gate: GateContext, text: string): void {
  gate.run.gateNote = text;
  updateWidget(gate.ctx, gate.run, gate.config.gates);
  void updateSidebar(gate.pi, "gating", text);
}

async function prNumber(gate: GateContext): Promise<number | null> {
  const result = await gate.pi.exec("gh", ["pr", "view", "--json", "number"], {
    cwd: gate.cwd,
    timeout: 60_000,
  });
  if (result.code !== 0) return null;
  return (JSON.parse(result.stdout) as { number: number }).number;
}

export async function runCliReview(
  gate: GateContext,
  adapter: "codex" | "claude",
): Promise<GateResult> {
  const { baseBranch, cliTimeoutMinutes } = gate.config.review;
  const reviewer = gate.config.review[adapter];
  const round = (gate.run.attempts["review"] ?? 0) + 1;
  const timeout = cliTimeoutMinutes * 60_000;

  note(gate, `review round ${round}: running ${adapter} (${reviewer.model}, ${reviewer.effort})`);

  let reviewText: string;
  if (adapter === "codex") {
    const outFile = join(tmpdir(), `pi-autopilot-review-${randomBytes(6).toString("hex")}.md`);
    try {
      const result = await gate.pi.exec(
        "codex",
        [
          "exec",
          "review",
          "--base",
          baseBranch,
          "-m",
          reviewer.model,
          "-c",
          `model_reasoning_effort="${reviewer.effort}"`,
          "-o",
          outFile,
        ],
        { cwd: gate.cwd, timeout },
      );
      if (result.killed) {
        return {
          status: "needs_human",
          reason: `review: codex timed out after ${cliTimeoutMinutes}m`,
        };
      }
      if (result.code !== 0) {
        const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-1000);
        return {
          status: "needs_human",
          reason: `review: codex failed (exit ${result.code}): ${tail}`,
        };
      }
      try {
        reviewText = readFileSync(outFile, "utf8");
      } catch {
        // -o file missing: fall back to stdout (format drift, not fatal).
        reviewText = result.stdout;
      }
    } finally {
      rmSync(outFile, { force: true });
    }
  } else {
    const pr = await prNumber(gate);
    if (pr === null) {
      return {
        status: "needs_human",
        reason:
          "review: no PR for this branch — claude's /review needs a PR number (did ship run?)",
      };
    }
    const result = await gate.pi.exec(
      "claude",
      [
        "-p",
        "--model",
        reviewer.model,
        "--effort",
        reviewer.effort,
        "--allowedTools",
        "Bash(gh pr view:*),Bash(gh pr diff:*),Bash(gh pr list:*)",
        `/review ${pr}`,
      ],
      { cwd: gate.cwd, timeout },
    );
    if (result.killed) {
      return {
        status: "needs_human",
        reason: `review: claude timed out after ${cliTimeoutMinutes}m`,
      };
    }
    if (result.code !== 0) {
      const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-1000);
      return {
        status: "needs_human",
        reason: `review: claude failed (exit ${result.code}): ${tail}`,
      };
    }
    reviewText = result.stdout;
  }

  if (!reviewText.trim()) {
    return { status: "needs_human", reason: `review: ${adapter} produced empty output` };
  }

  note(gate, `review round ${round}: normalizing ${adapter} findings`);
  gate.ctx.ui.notify(
    `Review round ${round} (${adapter}):\n${reviewText.slice(0, 500)}`,
    "info",
  );
  const findings = await normalizeFindings(gate, reviewText);
  if (findings.length === 0) return { status: "pass" };
  return { status: "findings", findings };
}
