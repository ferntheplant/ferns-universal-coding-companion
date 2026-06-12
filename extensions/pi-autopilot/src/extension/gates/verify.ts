import { createHash } from "node:crypto";
import type { Gate } from "../types";

const OUTPUT_TAIL_CHARS = 4000;

/**
 * Tier-1/2 gate: run the configured verify command in the worktree. Failure
 * output is hashed; the same hash twice in a row means the agent is going in
 * circles, so we escalate instead of burning another attempt.
 */
export const verifyGate: Gate = {
  id: "verify",
  async run(gate) {
    const { command, timeoutMinutes } = gate.config.verify;
    const result = await gate.pi.exec("bash", ["-c", command], {
      cwd: gate.cwd,
      timeout: timeoutMinutes * 60 * 1000,
    });

    if (result.killed) {
      return {
        status: "needs_human",
        reason: `verify command timed out after ${timeoutMinutes}m: ${command}`,
      };
    }
    if (result.code === 0) {
      gate.run.lastVerifyFailureHash = undefined;
      return { status: "pass" };
    }

    const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-OUTPUT_TAIL_CHARS);
    const hash = createHash("sha256").update(tail).digest("hex");
    if (gate.run.lastVerifyFailureHash === hash) {
      return {
        status: "needs_human",
        reason: "verify failed twice with identical output — agent appears stuck",
      };
    }
    gate.run.lastVerifyFailureHash = hash;

    return {
      status: "findings",
      findings: [
        {
          source: "verify",
          title: `\`${command}\` failed (exit ${result.code})`,
          body: tail,
        },
      ],
    };
  },
};
