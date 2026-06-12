import type { Gate, GateResult } from "../types";
import { runCliReview } from "./review-cli";
import { runGreptileReview } from "./review-greptile";

/**
 * Review gate dispatcher. The adapter does the round (greptile: trigger +
 * poll the PR; codex/claude: one headless CLI run); this wrapper owns the
 * shared semantics:
 * - review only re-triggers when HEAD moved since the last completed round
 *   (no new commits = the agent rejected the remaining findings; they stand)
 * - a completed round (pass or findings) marks HEAD as reviewed; interrupted
 *   or failed rounds do not
 */
export const reviewGate: Gate = {
  id: "review",
  async run(gate) {
    const headResult = await gate.pi.exec("git", ["rev-parse", "HEAD"], {
      cwd: gate.cwd,
      timeout: 30_000,
    });
    if (headResult.code !== 0) {
      return {
        status: "needs_human",
        reason: `review: rev-parse failed: ${headResult.stderr.trim().slice(-500)}`,
      };
    }
    const headSha = headResult.stdout.trim();
    if (gate.run.lastReviewSha === headSha) {
      return { status: "pass" };
    }

    const adapter = gate.config.review.adapter;
    let result: GateResult;
    switch (adapter) {
      case "greptile":
        result = await runGreptileReview(gate, headSha);
        break;
      case "codex":
      case "claude":
        result = await runCliReview(gate, adapter);
        break;
      default:
        return {
          status: "needs_human",
          reason: `review: unknown adapter "${adapter as string}" (known: greptile, codex, claude)`,
        };
    }

    if (result.status === "pass" || result.status === "findings") {
      gate.run.lastReviewSha = headSha;
    }
    return result;
  },
};
