# pi-autopilot SPEC

> **Status:** build phases 1–3 implemented and validated end-to-end on real tycho PRs
> (verify + ship gates; greptile, codex, and claude review adapters; classifier,
> budget/quota, pause, and restore guards). Phase 4 finishers (QA walker gate,
> auto-merge-when-green, `/auto-cleanup`) are stubs — see Build phases at the bottom.

## Purpose

Automate the babysitting loop for ticket work in cmux worktree workspaces: once the
operator arms it, the extension owns **verify → commit/push/PR → review → fix →
re-verify** until the branch is ready to merge or a human is genuinely needed. Every
exit from the happy path lands in a single `NEEDS_HUMAN` state that lights up the cmux
sidebar — the loop never silently dies and never silently does something destructive.

This is the "executor inner loop" from `docs/factory.md` (builder ↔ reviewer ↔ QA),
scoped to run inside one interactive Pi session rather than a remote orchestrator. It
is a stepping stone toward that architecture, not a detour.

## Vocabulary

- **run** — one armed autopilot lifecycle, from `/auto` to `READY`/`NEEDS_HUMAN`/`/auto-off`.
- **gate** — a quality check between "agent says done" and "ready to merge". Verify,
  ship, review, and QA are all gates behind one interface.
- **finding** — a canonical actionable item produced by a gate
  (`{ source, file?, line?, title, body, severity? }`). The fix-injection path does not
  know or care which gate produced a finding.
- **tick** — one evaluation of the state machine, triggered by `agent_end` or by a
  gate's poll timer.

## State machine

```
IDLE ──/auto──▶ WORKING
                  │ agent_end
                  ▼
              CLASSIFY ── question / blocked ──▶ NEEDS_HUMAN
                  │ complete
                  ▼
              GATES[i] (i = 0..n, in configured order)
                  │ pass            → i+1 (or READY after last gate)
                  │ findings (≤cap) → inject findings ──▶ WORKING (restart at gate 0)
                  │ needs_human     → NEEDS_HUMAN
                  ▼
               READY  (optional: gh pr merge --auto -s -d, /auto-cleanup)
```

Rules:

- Findings from any gate restart the pipeline from gate 0 after the agent's fix pass.
  Verify is cheap to re-run; review only re-triggers when new commits exist.
- Each gate has its own attempt cap. Exceeding a cap → `NEEDS_HUMAN` with reason.
- The budget monitor is consulted before every point where autopilot _initiates_ spend
  (injecting a prompt, spawning a QA agent). Breach → `PAUSED_QUOTA` (a flavor of
  `NEEDS_HUMAN`). If the agent is mid-stream when a threshold trips, the turn finishes
  and the pause happens at the next tick.
- Any manual user input while armed auto-pauses the run (the operator took the wheel).
- One armed run per Pi session. cmux already gives one session per worktree.

## Done-vs-question detection (CLASSIFY)

Two layers:

1. **Explicit signal (primary):** while armed, `before_agent_start` appends autopilot
   instructions to the system prompt and a `report_status` tool is registered:
   `report_status({ status: "complete" | "need_input" | "blocked", summary })`.
   The agent is instructed to call it as its final action. The `summary` doubles as
   the commit message / PR body material in the ship gate.
2. **Fallback classifier:** if `agent_end` fires without a `report_status` call in the
   final messages, classify the last assistant message with a cheap model
   (COMPLETE / QUESTION / BLOCKED). QUESTION and BLOCKED → `NEEDS_HUMAN`.

## Gates

```ts
interface Gate {
  id: string;
  run(
    ctx: GateContext,
  ): Promise<
    | { status: "pass" }
    | { status: "findings"; findings: Finding[] }
    | { status: "needs_human"; reason: string }
  >;
}
```

Attempt caps are resolved by the controller from config (`verify.maxAttempts`,
`review.maxRounds`, ...), not stored on the gate.

Configured per repo as an ordered list, e.g. `["verify", "ship", "review", "qa"]`.
Adding a stage is config + one module, not a state-machine rewrite. The gates map onto
the tier-1..4 verification ladder in `docs/tracker.md`.

### verify

Runs the configured verify command (tycho: `pnpm run llm:verify`) via `pi.exec` in the
worktree. Failure → one finding containing the truncated tail of output. The failure
output is hashed; the **same hash twice in a row** means the agent is going in circles
→ `needs_human` instead of another attempt.

### ship

- Dirty-tree safety is **baseline-based**: `/auto` snapshots `git status` at arm time;
  ship refuses to commit while pre-existing dirty paths are still present (that dirt is
  the operator's, not the agent's). Everything that appeared during the armed run is
  attributed to the agent — which is what justifies `git add -A`.
- Refuses to operate on `main`/`master`/detached HEAD.
- Commit with a message from the latest `report_status` summary (or the classifier's),
  push, ensure a PR exists (created on first pass with summary-derived title/body;
  later passes just push).
- Never force-pushes; never touches branches other than the worktree's.

### review (greptile adapter)

Never parses greptile's comment layout structurally, and never treats "something
changed and went quiet" as completion — greptile edits an "in progress" placeholder
into its summary right after triggering, which a settle heuristic misreads as a
finished clean review. A round completes only on an **explicit signal**:

1. **Mergeable pre-check:** a `CONFLICTING` PR short-circuits before triggering — no
   checks or review will ever run on it, so the conflict itself is returned as an
   agent-fixable finding (merge base branch, resolve, never rebase/force-push).
2. **Snapshot before triggering:** all greptile-authored artifacts (issue comments,
   inline review comments, reviews) plus the **"prompt to fix all with AI" section**
   of each summary comment (located by `fixSectionMarker`).
3. **Trigger:** `gh pr comment --body "@greptile review"`.
4. **FINDINGS signal:** the fix-prompt section changed vs baseline (greptile updates
   it in place) AND the bot artifacts are identical across two consecutive polls.
   The section is ready-made fix content: parsed directly into one finding per issue
   paragraph — no LLM call needed.
5. **CLEAN/OTHER signal:** the greptile CI check run completed after our trigger
   (`gh pr checks --json` — exit codes are unreliable there, only parsed stdout
   counts; `completedAt > triggerTime` so a previous round's check doesn't count).
   Whatever artifact diff exists is LLM-normalized into `Finding[]`; an empty or
   unactionable diff passes the gate. Checks lag and never run on conflicted PRs,
   which is why they are only the clean-complete signal, never the findings path.
6. **Fingerprint dedup across rounds:** findings already injected in a previous round
   are never re-injected even when greptile repeats them in an edited summary.

Neither signal within `timeoutMinutes` (default 15) → `needs_human`. Review only
re-triggers when HEAD moved since the last completed round (enforced in the
dispatcher, shared by all adapters). Poll progress is shown in the widget and cmux
sidebar (`review round 2: waiting on greptile (3m)`).

### review (codex / claude CLI adapters)

`adapter: "codex"` or `"claude"` runs a local CLI reviewer headless in the worktree —
one shot, no polling, no GitHub round-trip, but also no PR audit trail (greptile stays
the default). Output is LLM-normalized into `Finding[]` like everything else.
Invocations verified against codex-cli 0.139.0 / claude 2.1.175:

- **codex:** `codex exec review --base <baseBranch> -m <model>
-c model_reasoning_effort="<effort>" -o <tmpfile>` — `--base` reviews the branch
  diff as a PR against main; `-o` captures the final review message without scraping
  progress output.
- **claude:** `claude -p --model <model> --effort <effort> --allowedTools
"Bash(gh pr view:*),Bash(gh pr diff:*),Bash(gh pr list:*)" "/review <pr#>"` — the
  built-in `/review` prompt runs `gh pr list` interactively when no PR number is
  given (stalls headless), so the PR number is required; the gh commands it runs must
  be pre-allowed because print mode cannot answer permission prompts. Reviewing the
  PR is reviewing against main: main is the PR's base.

Per-adapter model/effort live in config (`review.codex`, `review.claude`); one CLI run
is capped at `cliTimeoutMinutes` (default 20).

### qa (walker)

The factory.md "walker" scoped down: spawn a headless Pi
(`pi -p --session-id <branch>-qa`) in the worktree with an agent-browser profile,
prompted with the PR summary + dev server URL. The port is read from the worktree's
env (written by `init-worktree-env.mjs`) — no new config. It explores the changed
surface, posts screenshots/evidence to the PR, and returns findings as JSON in the
same canonical shape.

### Finding triage

All findings are piped to the main agent with a framing prompt: _"For each: fix it if
it's a genuine issue, or reject it with one line of reasoning. Then call
report_status."_ The main agent has the most context of anything in the system; no
separate triage model. The rejections live in the conversation; _future:_ post them
back to the PR as a reply (audit trail) and surface them in the widget for override.

## Budget & quota monitoring

- **Run budgets:** tokens/cost summed from finalized assistant messages
  (`message_end`), checked against `maxTokensPerRun` + `maxWallClockMinutes` at
  spend-initiation points; context percent via `ctx.getContextUsage()` at the
  agent_end tick. Over the context threshold → one auto-`compact()` per run; a second
  breach → `NEEDS_HUMAN`.
- **Subscription quota:** reuse pi-usage's provider adapters over the shared `pi.events`
  bus. pi-usage answers `usage:query` (request carries a `respond` callback) with its
  cached `ProviderUsageResult`s, always through its fetch cache so the dashboard
  scrapers aren't hammered. Thresholds are keyed by pi-usage provider id and
  label-agnostic: `maxPercent` trips on any percent bar the provider reports (5h,
  weekly, ...), `minDollars` on any dollar balance.
- **Unknown quota = assume near limit:** a failed quota check pauses the loop, it is
  not treated as "fine, proceed" — but only when thresholds are configured; an empty
  `quota: {}` skips the check entirely (no pi-usage dependency).
- On breach: `needs_human` + cmux sidebar status + macOS notification (every
  `needs_human` fires one, best-effort osascript).
- _Future:_ opt-in auto-resume scheduled at the provider's reset countdown, re-checking
  quota on wake rather than trusting the (possibly stale, scraped) countdown.

## cmux integration

Sidebar status via `cmux set-status` per phase (pattern from pi-cmux):

| state           | icon/color          | meaning                      |
| --------------- | ------------------- | ---------------------------- |
| WORKING         | spinner, default    | agent or fixes in flight     |
| gate running    | gear, default       | verify/review/qa in progress |
| AWAITING_REVIEW | clock, low priority | safe to ignore               |
| NEEDS_HUMAN     | orange, priority 90 | **come back**                |
| READY           | green               | mergeable                    |

While armed, autopilot owns the status key; pi-cmux listens on the `pi-autopilot:armed`
bus channel and suppresses its per-`agent_end` "needs attention" ping until disarm.
Fix rounds and gate polling push distinct sidebar details
(`working — fixing review findings (round 2/3)`, `review round 2: waiting on greptile
(3m)`). In-session, a `setWidget` line shows: state, gate cursor + attempt, the live
gate note, and the needs-human reason. Every `needs_human` also fires a best-effort
macOS notification via `osascript`.

## Commands

- `/auto [extra instructions]` — arm for the current task.
- `/auto-status` — dump state, gate cursor, counters, budget.
- `/auto-pause` / `/auto-resume` — freeze/unfreeze without losing state.
- `/auto-off` — disarm and clean up.
- `/auto-cleanup` — post-merge finisher: `git worktree remove` + close the cmux
  workspace (sidesteps the `gh pr merge -sd` "main is checked out elsewhere" failure).

## Config

`~/.pi/agent/pi-autopilot/config.json`, with per-repo overrides keyed by repo root.
Nothing tycho-specific is hardcoded.

```jsonc
{
  "gates": ["verify", "ship", "review"],
  "verify": { "command": "pnpm run llm:verify", "maxAttempts": 3 },
  "review": {
    "adapter": "greptile", // or "codex" / "claude" for local CLI reviewers
    "maxRounds": 3,
    "baseBranch": "main",
    "botPattern": "greptile", // matched against comment author logins + check names
    "triggerComment": "@greptile review",
    "fixSectionMarker": "prompt to fix", // locates the fix-all section in summaries
    "pollIntervalSeconds": 20,
    "timeoutMinutes": 15,
    "codex": { "model": "gpt-5.4", "effort": "medium" },
    "claude": { "model": "opus", "effort": "medium" },
    "cliTimeoutMinutes": 20,
  },
  "qa": { "enabled": false },
  "budget": { "maxTokensPerRun": 2000000, "maxWallClockMinutes": 90, "contextPercentCompact": 80 },
  // keyed by pi-usage provider id; empty = no quota checks
  "quota": { "codex": { "maxPercent": 85 }, "zen": { "minDollars": 5 } },
  "merge": { "autoMergeWhenGreen": false },
}
```

## State persistence

Every transition appends a full JSON-safe run snapshot via `pi.appendEntry` (audit +
crash recovery). On `session_start` the last snapshot is rebuilt — **always paused**: a
reloaded session must never start committing or polling on its own; the operator
inspects `/auto-status` and decides with `/auto-resume` (or `/auto-off` to drop it).
Snapshots in `ready`/`idle` phases are not restored. The PR and its comments remain
the durable source of truth (per factory.md: human-visible state lives in PRs).

## Edge cases

| case                                  | handling                                                        |
| ------------------------------------- | --------------------------------------------------------------- |
| agent asks a question mid-run         | CLASSIFY → NEEDS_HUMAN; answering + next agent_end resumes      |
| verify fails the same way twice       | NEEDS_HUMAN ("stuck on identical failure")                      |
| context blowing up                    | one auto-compact, then NEEDS_HUMAN                              |
| reviewer never responds               | poll timeout → NEEDS_HUMAN                                      |
| operator types while armed            | auto-pause; banner reminds the loop is paused                   |
| dirty tree the agent didn't create    | NEEDS_HUMAN before commit                                       |
| quota check fails (scrape auth, etc.) | pause; unknown quota = assume near limit                        |
| `gh pr merge -sd` checkout failure    | merge `--auto -s -d` remote-only; `/auto-cleanup` does the rest |

## Non-goals

- **No daemon/watcher outside Pi.** The extension process is alive exactly when the
  loop matters; a separate monitor is the remote-orchestrator problem (later tier).
- **No auto-answering of agent questions.** Highest-regret failure mode; questions are
  precisely where operator intent is needed.
- **No multi-loop concurrency.** One armed run per session.
- **No structural parsing of reviewer output formats.** Diff + LLM-normalize only.

## Build phases

1. **Happy path, no polling:** `/auto`, agent_end → verify → inject-on-fail →
   ship. Already kills most of the babysitting. ✅ implemented
2. **Greptile round-trip:** snapshot/trigger/settle/diff/normalize/dedup + round cap.
   ✅ implemented (normalizer uses the session's current model; pi-cmux suppression
   wired over `pi.events` channel `pi-autopilot:armed`)
3. **Guards:** fallback classifier, stuck-detection, budgets, quota via `usage:query`,
   pause-on-input, state restore from entries. ✅ implemented (pi-usage gained the
   `usage:query` responder; restored runs always come back paused)
4. **Finishers:** auto-merge-when-green, `/auto-cleanup`, QA gate. ← _next_
   (the local-CLI reviewer adapter landed early, with phase 2)
