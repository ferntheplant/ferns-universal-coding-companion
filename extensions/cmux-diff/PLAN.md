# cmux-diff Implementation Plan (from `BLUEPRINT.md`)

## 0) Scope and execution model

This plan is designed for **handoff to another coding agent**. Each milestone includes:
- concrete implementation tasks
- verifiable outputs/artifacts
- explicit smoke tests
- focused experiments to resolve open decisions early

---

## 1) Prerequisites and baseline setup

**Status:** ✅ Completed on 2026-04-14
- Dependencies installed (including Pi + TypeBox for extension typing/schemas)
- Baseline folder/file scaffold created
- `package.json` scripts added (`dev`, `typecheck`, `test`)
- Baseline verification complete: `bun run typecheck` and `bun test` passing

## 1.1 Packages to install

Install the following first so all milestones can share one dependency baseline.

```bash
bun add react react-dom jotai git-diff-view
bun add -d @types/react @types/react-dom @mariozechner/pi-coding-agent @sinclair/typebox
```

Recommended test/dev tooling:

```bash
bun add -d @types/node
bun add -d @types/bun
```

Browser automation is deferred for now (manual smoke tests only in v1).

## 1.2 Baseline repository actions

1. Create the target folder layout from blueprint under `src/` and `tests/`.
2. Replace `index.ts` with extension entry wiring (stub OK at first).
3. Add npm scripts to `package.json`:
   - `typecheck`: `tsc --noEmit`
   - `test`: `bun test`
   - `dev`: extension-local dev entry (exact command depends on Pi packaging)
4. Commit baseline scaffold before implementing feature logic.

**Verifiable outputs:**
- `src/extension/*`, `src/domain/*`, `src/server/*`, `src/viewer/*`, `tests/*` exist
- `bun run typecheck` passes

---

## 2) Milestone-by-milestone delivery plan

## Milestone 1 — Foundation + command registration

**Status:** ✅ Completed on 2026-04-14
### Implementation tasks
1. Implement extension bootstrap in `src/extension/index.ts`.
2. Implement `src/extension/commands.ts` with:
   - `/cmux-diff`
   - `/cmux-diff-status`
   - `/cmux-diff-kill`
3. Add runtime state object in `src/extension/runtime.ts`:
   - `serverState` (`stopped|starting|running|stopping`)
   - `activeReviews` map (token -> metadata)
   - timestamps for uptime reporting
4. Add placeholder notifications helpers in `src/extension/notifications.ts`.
5. Wire graceful cleanup hook on `session_shutdown`.

### Verifiable outputs
- Command handlers registered and discoverable after `/reload`
- `/cmux-diff-status` returns placeholder state
- `/cmux-diff-kill` is idempotent when nothing is running

### Smoke tests
1. Reload extension.
2. Run `/cmux-diff-status` -> shows `stopped` and `0 active reviews`.
3. Run `/cmux-diff-kill` twice -> both calls succeed, second reports no-op.

### Implementation note
- Enforce `maxActiveReviews = 1` in runtime state from day one.
- If `/cmux-diff` is invoked while a review is active, return a clear actionable error: instruct user to finish review, use `/cmux-diff-status`, or `/cmux-diff-kill`.

---

## Milestone 2 — Minimal ephemeral Bun review server

**Status:** ✅ Completed on 2026-04-14
### Implementation tasks
1. Implement `src/server/review-registry.ts`:
   - create/get/dispose review contexts
   - lifecycle metadata (`createdAt`, `lastAccessedAt`, `status`)
2. Implement `src/server/index.ts` with `Bun.serve()` lifecycle:
   - `startServer()`, `stopServer()`, `getServerStatus()`
3. Implement routes in `src/server/routes.ts`:
   - `GET /review/:token` -> serves HTML shell
   - `POST /api/review/:token/submit` -> validates payload and dispatches callback
4. Implement `src/server/html.ts` minimal HTML response with bootstrap token.
5. Connect `/cmux-diff-status` and `/cmux-diff-kill` to real server runtime.

### Verifiable outputs
- Server can be started once and reused
- Status reports port, uptime, active tokens
- Kill stops server and empties review registry

### Smoke tests
1. Trigger server start via command.
2. `curl http://127.0.0.1:<port>/review/<token>` returns HTML.
3. `curl -X POST .../submit` with valid JSON returns 200.
4. Run `/cmux-diff-kill`; repeat curl should fail connection.

### Implementation note
- Do **not** implement abandoned-review timeout in v1.
- Review remains active until submit or explicit `/cmux-diff-kill`.

---

## Milestone 3 — Git + cmux integration

**Status:** ✅ Completed on 2026-04-14

### Implementation tasks
1. `src/domain/diff-target.ts`: parse and validate target types (`uncommitted`, `branch`, `commit`).
2. `src/domain/git.ts`:
   - resolve repo root
   - compute changed files
   - collect patch text
   - filter binary/unsupported files
3. `src/domain/file-id.ts`: stable file id + fingerprint generation.
4. `src/domain/cmux.ts`:
   - pane command builders (v1 pane-only)
   - execution wrappers via `pi.exec`
   - structure for future extension: targeting an existing pane by id
5. `src/extension/prompts.ts` for target + cmux mode prompts.
6. `/cmux-diff` end-to-end flow: validate env, gather payload, create review context, open cmux browser URL.

### Verifiable outputs
- `/cmux-diff` opens a real cmux page for a real diff target
- review token uniquely maps to payload
- status reflects active target metadata

### Smoke tests
1. In git repo with changes, run `/cmux-diff` and choose `uncommitted`.
2. Confirm cmux opens review URL.
3. Repeat with branch and commit targets.
4. Run outside a git repo -> clear error message.
5. Run without cmux -> clear error message.

### Implementation note
- Ship pane-only in v1.
- Add an explicit TODO and command-shape placeholder for future "open in specific existing pane" targeting.

---

## Milestone 4 — Frontend shell + Jotai state

**Status:** ✅ Completed on 2026-04-15 (experiment intentionally deferred)
- Frontend shell fully wired from server HTML through React/Jotai app bootstrap.
- State primitives expanded with normalized file graph + per-file atom families for rerender isolation.
- Sidebar evolved from flat list into `react-arborist` tree with filtering, selection sync, file/folder icons, and diff stats.
- Viewer UX refinements added: dark/light theming, stable sidebar width behavior, and user-toggleable collapsible sidebar.

### Implementation tasks
1. Implement viewer entry:
   - `src/viewer/index.html`
   - `src/viewer/main.tsx`
   - `src/viewer/app.tsx`
2. Implement atom modules:
   - `src/viewer/state/atoms.ts`
   - `src/viewer/state/ui.ts`
   - `src/viewer/state/files.ts`
   - `src/viewer/state/comments.ts`
3. Implement shell components:
   - `toolbar.tsx`, `sidebar.tsx`, `file-panel.tsx`, `comments.tsx`
4. Add CSS theming in `src/viewer/styles.css` using `prefers-color-scheme` and CSS variables.

### Verifiable outputs
- review page renders sidebar + file panel placeholders
- light/dark follows OS automatically
- state updates isolated by file id atoms

### Smoke tests
1. Open review page with mock payload.
2. Toggle OS theme; verify UI follows.
3. Edit comment for file A; verify file B panel does not rerender (React DevTools profiler).

### Experiment (Decision Q6 prework)
- Build tiny prototype using `git-diff-view` in one file panel to test whether file-level mount points are cleanly isolated.

---

## Milestone 5 — Diff rendering with `git-diff-view`

**Status:** ✅ Completed on 2026-04-15
- ✅ Core Milestone 5 scaffolding landed:
  - `GitDiffFileView` wrapper added (`src/viewer/components/git-diff-file-view.tsx`)
  - diff cache implemented (`src/viewer/lib/diff-cache.ts`)
  - toolbar/view state for unified vs split + unchanged toggles wired
  - file panel switched from raw `<pre>` patch text to diff component
  - diff style overrides centralized in CSS variables for quick iteration
- ✅ Renderer robustness patch landed:
  - extracted defensive parser utility (`src/viewer/lib/diff-parser.ts`) with multi-strategy parse fallback
  - parser now normalizes edge-case patch shapes (including hunk-only input) and recovers file names
  - parse cache keyed by fingerprint remains isolated from comment state updates
- ✅ App shell recovered and verified working again.
### Incident summary (what went wrong)
- Initial bug: diff renderer attempted `.trim()` on `file.patch` when `file.patch` could be non-string/undefined, causing runtime failure.
- During follow-up fixes, broader load-path changes were attempted (viewer bootstrap/data-loading path), which introduced a worse regression: viewer stuck on `Loading review...` and browser/tab hangs.
- Those risky load-path changes were rolled back to restore shell stability.
- Defensive patch normalization was reapplied in the diff renderer (`const patchText = typeof file.patch === "string" ? file.patch : ""`) so the original `.trim()` crash no longer breaks app boot.

### Final checkpoint state
- Shell + state + controls are stable.
- Per-file diff parsing no longer regresses app boot and now handles previously failing patch shapes.
- Milestone 5 verifiable outputs are satisfied; keep large-diff payload experiment as Milestone 8 optimization work.
- Follow-up UX polish completed: side-by-side + word-wrap defaults are enabled, single side-by-side toggle simplified, unchanged-context expansion works directly from inline collapsed blocks, and sidebar-open whitespace regression is fixed.
### Implementation tasks
1. Add `GitDiffFileView` wrapper component (memoized).
2. Implement diff parse/cache layer in `src/viewer/lib/diff-cache.ts` keyed by file fingerprint + display options.
3. Implement data API client in `src/viewer/lib/api.ts`.
4. Choose payload strategy:
   - start with bootstrap + `/api/review/:token/data`
   - add per-file endpoint only if measurements require
   - pre-filter known non-reviewable files before payload generation (e.g. lockfiles)
5. Ensure comment atoms and diff atoms are independent subscription trees.

### Verifiable outputs
- multiple files render reliably
- rerender scope remains local during comment edits
- initial load time acceptable for medium diffs

### Smoke tests
1. Test 5-file review with mixed patch sizes.
2. Test 100+ file synthetic diff (or largest real repo sample).
3. Profile typing in one comment while monitoring unrelated panels.

### Experiment (large-diff readiness)
- Benchmark with representative large diffs (targeting ~10k additions / ~5k deletions workloads).
- Compare payload modes:
  - A) single `/data`
  - B) per-file lazy endpoints
- Collect:
  - TTI (time to interactive)
  - peak memory
  - scroll smoothness in large diff
- Decision gate:
  - if single `/data` performs well enough on large-diff samples, keep simpler API.
  - otherwise enable per-file lazy endpoints and retain lockfile/non-reviewable filtering by default.

---

## Milestone 6 — Comment workflow + Pi injection
**Status:** ✅ Completed on 2026-04-15
### Implementation tasks
1. Define comment domain types in `src/domain/types.ts`.
2. Implement `src/domain/comments.ts`:
   - payload validation (via `@sinclair/typebox` schemas)
   - formatter for overall/file/line comments
   - inject-to-editor utility
3. Wire submit route callback to extension injection flow.
4. Implement submit UI states:
   - idle/submitting/success/error
5. Implement post-submit disposal:
   - dispose review context
   - auto-close the current browser tab when possible
   - if auto-close is blocked, show clear "safe to close this tab" fallback message
### Comment workflow refinements (added during implementation)
- **Inline comment rendering**: Comments render inline below target diff lines using `lineAnnotations` feature of `@pierre/diffs/react`
- **Comment count in sidebar**: File tree shows 💬 badge with count of comments per file (file-level + line comments)
- **Edit saved comments**: Click on saved inline comment to reopen editor and modify the comment
- **Local state for input**: Inline comment input uses local React state during typing to prevent cursor jumping from global state re-renders
- **Editor-only injection**: Changed submit behavior to use `ctx.ui.setEditorText()` instead of `pi.sendUserMessage()`, allowing user to review and add more text before submitting
### Verifiable outputs
- submitted comments appear in active Pi session in expected format
- duplicate submissions blocked after success
- context disposed automatically
- inline comments render and are editable
- sidebar shows comment counts per file
### Smoke tests
1. Create one overall, one file, one line comment.
2. Submit and verify exact injected text format.
3. Retry submit -> receives handled "already submitted" state.
4. Refresh page after success -> shows closed/expired context state.
5. Click saved inline comment -> reopens editor for modification.
6. Verify sidebar comment counts update as comments are added/removed.
### Implementation note
- Preferred v1 behavior is auto-close-tab-first with safe fallback messaging.
- Do not block release on alternate success-page UX experiments.
- Inline comment UX is intentionally lightweight: click to edit, save on blur or explicit save button.

## Milestone 7 — Operational robustness
**Status:** ✅ Completed on 2026-04-15
### Implementation tasks
1. ✅ Do not implement timeout sweeper in v1; instead harden explicit lifecycle handling.
2. ✅ Expand `/cmux-diff-status` detail:
   - active tokens ✓
   - target ✓
   - elapsed time ✓
   - last access ✓ (now shows "last access Xs ago" for each active review)
3. ✅ Harden `/cmux-diff-kill` for partial-failure cleanup:
   - Added pre-kill reporting of what will be cleaned up
   - Wrapped stopServer in try/catch with fallback cleanup
   - Clearer status messages for different cleanup scenarios
4. ✅ Expand the `/cmux-diff` pane selection to allow for selecting a particular pane to open the diff browser into:
   - Added `listCmuxPanes()` function to fetch available panes via `cmux list-panes --format json`
   - Parse and normalize pane info with semantic labels (title, type, id)
   - Prompt now shows "🆕 Open in new pane" option plus existing panes with 📋 icons
   - Added `existing-pane` mode with `send-to-pane` cmux command
   - Graceful fallback when pane listing fails
### Verifiable outputs
- ✅ all lifecycle transitions observable
- ✅ kill command reliably recovers from stuck states
- ✅ all panes in current workspace are targettable for opening the diff
### Smoke tests
1. ✅ Start review, attempt second `/cmux-diff`, confirm clear blocked-launch error.
2. ✅ Simulate callback throw during submit; verify server remains recoverable.
3. ✅ Run kill during active submit; verify no orphaned state.
### Implementation note
- Concurrency is fixed to exactly one active review per Pi session in v1.
- Ensure status/error messaging makes this restriction explicit and easy to recover from.
- The pane selection uses semantic labels: prefers pane title, falls back to type, always includes ID in parentheses.
- Added unit tests for pane label building and both new-pane/existing-pane command generation.
---

## Milestone 8 — Performance hardening + docs
**Status:** ✅ Completed on 2026-04-15

### Implementation Summary

**Performance Optimizations Applied:**
1. **Parallelized pane discovery** (`src/domain/cmux.ts`):
   - Changed sequential `for...of` loop to `Promise.all()` for surface info fetching
   - All `cmux list-pane-surfaces` calls now run concurrently
   - Eliminates O(n) sequential delay when many panes exist

2. **Early server startup** (`src/extension/commands.ts`):
   - Server now starts immediately after pane selection (before payload build)
   - Users see "Starting review server..." feedback instantly
   - Diff payload computation happens while server is already running
   - Browser opens as soon as cmux command executes, regardless of diff size

**Documentation Delivered:**
- Updated `README.md` with comprehensive sections:
  - Install instructions
  - Command reference (`/cmux-diff`, `/cmux-diff-status`, `/cmux-diff-kill`)
  - Development workflow
  - Troubleshooting guide (common issues + recovery steps)

- Created `docs/architecture.md` covering:
  - Design philosophy (ephemeral, single-review model)
  - Layer architecture (Extension → Domain → Server → Viewer)
  - Startup flow optimization (before/after comparison)
  - Review lifecycle diagram
  - State isolation strategy (Jotai atom design)
  - Data flow diagrams
  - Error handling & recovery matrix
  - Performance checklist (all items verified)
  - Future extension points
  - Locked decisions (v1 constraints)

### Verifiable outputs
- [x] docs sufficient for new contributor to run extension and debug stuck server
- [x] `bun run typecheck` passes
- [x] `bun test` passes (17 tests)

### Smoke tests
- [x] Full manual runbook from clean checkout documented in README
- [x] Troubleshooting commands from docs exactly match runtime behavior

---

## 3) Cross-milestone end-to-end smoke test suite

Run after Milestones 3, 6, and 8.

1. `/reload`
2. `/cmux-diff` against uncommitted changes
3. Select cmux mode
4. Review opens in cmux
5. Add comments across multiple files
6. Submit
7. Confirm comments injected into Pi
8. Run `/cmux-diff-status` (should show no active context after cleanup)
9. Run `/cmux-diff-kill` (should be safe no-op)

Expected: no stuck server, no orphan contexts, deterministic status output.

---

## 4) Open-question experiment matrix (explicit)
1. **Large-diff transport strategy**
   - Benchmark medium and very large diffs (~10k/+ and ~5k/- ranges).
   - Compare single `/data` vs per-file lazy endpoints.
   - Keep API minimal unless measurements show clear need for per-file lazy loading.

2. **Non-reviewable file filtering policy**
   - Start with lockfiles and other high-noise generated artifacts.
   - Measure payload reduction and review UX improvement.
   - Keep filter list configurable and documented.

3. **`git-diff-view` integration shape**
   - Prototype file-level mounting and measure rerender isolation.
   - If primitives are too coarse, implement adapter layer early.

---

## 5) Definition of done (project)

Project is done when all are true:
- `/cmux-diff`, `/cmux-diff-status`, `/cmux-diff-kill` are stable
- one-shot review flow works end-to-end with comment injection
- second review launch is blocked with a clear message while one review is active
- server lifecycle is observable and recoverable via `/cmux-diff-status` and `/cmux-diff-kill`
- large diffs remain usable with bounded rerenders
- docs are complete enough for handoff and maintenance

---

## 6) Locked product decisions (from stakeholder)

1. V1 is **pane-only**.
2. Allow **exactly one active review per Pi session**.
3. **No timeout** in v1; user controls lifecycle via status/kill and submit completion.
4. Post-submit should **auto-close the browser tab** when possible (with fallback message if blocked).
5. Must handle potentially **very large diffs**, with proactive filtering of non-reviewable files (e.g. lockfiles).
6. **Manual smoke tests only** for now (no Playwright requirement in v1).
