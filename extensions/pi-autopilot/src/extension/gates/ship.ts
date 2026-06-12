import type { ExecResult } from "@earendil-works/pi-coding-agent";
import type { Gate, GateContext, GateResult } from "../types";

/**
 * Commit → push → ensure PR. Conservative by design:
 * - refuses to operate on main/master
 * - refuses to commit when paths that were dirty BEFORE the run was armed are
 *   still dirty (pre-existing dirt is the operator's, not the agent's)
 * - never force-pushes, never touches other branches
 *
 * `git add -A` is safe here only because of the baseline check: everything
 * dirty at this point appeared during the armed run.
 */

const FALLBACK_COMMIT_MESSAGE = "chore: autopilot checkpoint";

async function git(gate: GateContext, args: string[]): Promise<ExecResult> {
  return gate.pi.exec("git", args, { cwd: gate.cwd, timeout: 60_000 });
}

async function gh(gate: GateContext, args: string[]): Promise<ExecResult> {
  return gate.pi.exec("gh", args, { cwd: gate.cwd, timeout: 120_000 });
}

function fail(step: string, result: ExecResult): GateResult {
  const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-1500);
  return { status: "needs_human", reason: `ship: ${step} failed (exit ${result.code}): ${tail}` };
}

function commitMessage(gate: GateContext): string {
  return gate.run.lastReport?.summary ?? gate.run.firstSummary ?? FALLBACK_COMMIT_MESSAGE;
}

export const shipGate: Gate = {
  id: "ship",
  async run(gate) {
    const branchResult = await git(gate, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branchResult.code !== 0) return fail("rev-parse", branchResult);
    const branch = branchResult.stdout.trim();
    if (branch === "main" || branch === "master" || branch === "HEAD") {
      return { status: "needs_human", reason: `ship: refusing to commit on '${branch}'` };
    }

    const statusResult = await git(gate, ["status", "--porcelain"]);
    if (statusResult.code !== 0) return fail("status", statusResult);
    const dirtyPaths = statusResult.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim());

    const staleBaseline = dirtyPaths.filter((path) => gate.run.baselineDirtyPaths.includes(path));
    if (staleBaseline.length > 0) {
      return {
        status: "needs_human",
        reason: `ship: tree had pre-existing changes not made by this run: ${staleBaseline.slice(0, 5).join(", ")}`,
      };
    }

    if (dirtyPaths.length > 0) {
      const addResult = await git(gate, ["add", "-A"]);
      if (addResult.code !== 0) return fail("add", addResult);
      const commitResult = await git(gate, ["commit", "-m", commitMessage(gate)]);
      if (commitResult.code !== 0) return fail("commit", commitResult);
    }

    const pushResult = await git(gate, ["push", "-u", "origin", "HEAD"]);
    if (pushResult.code !== 0) return fail("push", pushResult);

    const prView = await gh(gate, ["pr", "view", "--json", "number"]);
    if (prView.code !== 0) {
      const summary = commitMessage(gate);
      const [title, ...rest] = summary.split("\n");
      const body = `${rest.join("\n").trim()}\n\n---\nOpened by pi-autopilot.`;
      const prCreate = await gh(gate, [
        "pr",
        "create",
        "--title",
        title ?? FALLBACK_COMMIT_MESSAGE,
        "--body",
        body,
      ]);
      if (prCreate.code !== 0) return fail("pr create", prCreate);
    }

    return { status: "pass" };
  },
};
