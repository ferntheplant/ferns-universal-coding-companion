import type { Gate } from "../types";

/**
 * QA "walker" gate — NOT IMPLEMENTED YET (build phase 4).
 *
 * The factory.md walker scoped down: spawn a headless Pi
 * (`pi -p --session-id <branch>-qa`) in the worktree with an agent-browser
 * profile, prompted with the PR summary + dev server URL. The frontend port is
 * read from the worktree's env files (written by init-worktree-env.mjs) — no
 * new config. The walker explores the changed surface, posts
 * screenshots/evidence to the PR as a comment, and returns findings as JSON in
 * the canonical Finding shape. Spawning counts as spend: the controller runs
 * checkSpendAllowed() before this gate.
 */
export const qaGate: Gate = {
  id: "qa",
  async run(_gate) {
    return {
      status: "needs_human",
      reason: 'qa gate not implemented yet (phase 4) — remove "qa" from gates config',
    };
  },
};
