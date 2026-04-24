# pi-usage v1 Plan

## Scope

This plan supersedes the broad provider list in `BLUEPRINT.md` for the first autonomous implementation pass.

v1 includes only:
- OpenAI Codex
- OpenCode Zen

Post-v1 additions:
- Cursor (OAuth + DashboardService usage endpoint)

v1 commands:
- `/usage`
- `/usage-zen-login`

v1 UX decisions:
- `/usage` is a read-only overlay/dashboard
- the dashboard shows all fetchable configured providers at once
- the footer reflects only the currently active supported provider
- unsupported active providers show no footer

Deferred after v1:
- Anthropic Claude
- Google Gemini
- Synthetic.new
- optional debug commands such as `/usage-status` or `/usage-reset`

## Objectives

Ship a Pi extension that proves the two main provider patterns cleanly:
- OAuth-backed quota usage via Codex
- extension-owned cookie auth plus HTML scraping via Zen

The implementation should optimize for:
- thin extension bootstrap
- provider-specific logic isolated behind adapters
- Node-compatible runtime behavior
- manual smoke-testability in the real Pi runtime

## Target File Layout

Expected end-state layout:
- `index.ts`
- `src/extension/index.ts`
- `src/extension/commands.ts`
- `src/extension/runtime.ts`
- `src/extension/providers/types.ts`
- `src/extension/providers/registry.ts`
- `src/extension/providers/codex.ts`
- `src/extension/providers/zen.ts`
- `src/extension/auth/pi-auth.ts`
- `src/extension/auth/zen-auth.ts`
- `src/extension/storage.ts`
- `src/extension/ui/dashboard.ts`
- `src/extension/ui/footer.ts`
- `src/extension/notifications.ts`
- `README.md`

## Architecture Decisions

### 1. Provider adapter boundary

Use one adapter contract per provider. The command and footer layers must not know provider-specific auth or fetch details.

Minimum adapter surface:
- `id`
- `label`
- `detectActive(model): boolean`
- `isConfigured(context): Promise<boolean>`
- `fetchUsage(context, options?): Promise<ProviderUsageResult>`
- `renderFooter(result): string | null`
- `renderDashboardSections(result): DashboardSection[]`

Zen may also expose setup helpers through `zen-auth.ts`, but setup should stay outside the generic adapter interface.

### 2. Shared display primitives, not fake normalization

Use a normalized display model that supports both Codex and Zen without inventing percentages for Zen.

Required section types for v1:
- `percent_bar`
- `amount_remaining`
- `reset_timer`
- `info_line`
- `error`

### 3. Runtime cache and polling

Maintain in-memory state per provider:
- last successful fetch time
- last result
- last auth error
- last fetch error
- in-flight fetch promise for deduplication

Polling rules:
- footer refresh interval: 2 minutes
- refresh active provider immediately on `session_start`, `model_select`, and `turn_start`
- `/usage` may fetch all configured providers on demand
- allow a short freshness window to reuse cached results during rapid UI events

### 4. Storage split

Read Pi-managed auth from `~/.pi/agent/auth.json`.

Persist extension-owned Zen auth separately. Store only the minimum cookie fields required to fetch the Zen dashboard successfully. Do not persist raw copied `curl` commands.

## Milestones

### Milestone 0: Repo and runtime scaffold ✅ Complete (2026-04-16)

Goal:
- replace starter naming and starter command flow with `usage`-specific bootstrap

Tasks:
- update `src/extension/index.ts` to bootstrap the real extension lifecycle
- replace starter commands in `src/extension/commands.ts` with `/usage` and `/usage-zen-login`
- expand `src/extension/runtime.ts` from simple counters to extension runtime state
- keep `index.ts` as a thin re-export
- preserve `notifications.ts` as the shared user-facing notification layer

Verification:
- `bun run typecheck`
- confirm the extension still loads in Pi with `/reload`
- confirm `/usage` and `/usage-zen-login` are registered and callable, even if still stubbed

Exit criteria:
- no starter command names remain
- the extension can load without runtime errors in Pi

### Milestone 1: Core provider framework ✅ Complete (2026-04-16)

Goal:
- establish the adapter system and runtime state before implementing provider details

Tasks:
- add `src/extension/providers/types.ts` for normalized result and section types
- add `src/extension/providers/registry.ts` for provider registration and active-provider lookup
- add runtime helpers for:
  - active provider id
  - provider cache map
  - poll timer lifecycle
  - in-flight fetch deduplication
- add `src/extension/ui/footer.ts` for footer rendering and clear/hide behavior
- add `src/extension/ui/dashboard.ts` for overlay view model assembly and loading/error states
- wire session events in `src/extension/index.ts`:
  - `session_start`
  - `turn_start`
  - `model_select`
  - `session_shutdown`

Verification:
- `bun run typecheck`
- manually trigger lifecycle events in Pi and confirm no crashes
- confirm footer hide/show logic can be invoked with stub provider data

Smoke test:
1. Load the extension in Pi.
2. Select an unsupported model.
3. Confirm no footer remains visible.
4. Switch to a stubbed supported provider path and confirm the footer can be set and cleared cleanly.

Exit criteria:
- provider-independent runtime and UI plumbing exist
- event lifecycle and cleanup are explicit

### Milestone 2: Codex provider ✅ Complete (2026-04-16)

Goal:
- implement the OAuth-backed quota pattern cleanly for one supported provider

Tasks:
- add `src/extension/auth/pi-auth.ts` to read Pi auth material from `~/.pi/agent/auth.json`
- add `src/extension/providers/codex.ts`
- implement Codex auth detection using Pi OAuth storage for `openai-codex`
- fetch `https://chatgpt.com/backend-api/wham/usage`
- normalize the response into:
  - session percent
  - weekly percent
  - reset timers when present
- implement footer rendering for active Codex usage
- add defensive handling for missing auth, expired auth, and partial payloads

Verification:
- `bun run typecheck`
- run `/usage` while authenticated to Codex and confirm Codex appears
- run `/usage` while not authenticated to Codex and confirm Codex is omitted rather than shown as broken
- switch to a Codex model and confirm footer appears and updates

Smoke tests:
1. Authenticate to Codex in Pi.
2. Reload the extension.
3. Select a Codex model.
4. Confirm the footer shows Codex quota data.
5. Run `/usage`.
6. Confirm Codex appears as the active provider with consistent values.
7. Wait past the freshness window or trigger a model reselect.
8. Confirm the footer refreshes without duplicate toasts or visible flicker.

Exit criteria:
- Codex works end to end in both footer and dashboard flows
- missing Codex auth does not break `/usage`

### Milestone 3: Zen auth bootstrap and storage ✅ Complete (2026-04-16)

Goal:
- implement the extension-owned auth path needed for Zen balance scraping

Tasks:
- add `src/extension/auth/zen-auth.ts`
- add `src/extension/storage.ts` for persistent extension-owned storage
- implement `/usage-zen-login` flow:
  - show instructions to open the Zen dashboard and copy a logged-in request as `curl`
  - accept pasted curl text
  - parse headers robustly enough to extract cookie material
  - discard irrelevant headers
  - normalize `Accept-Encoding` away from browser-specific values
  - persist only required cookies after successful validation
- validate saved auth by performing a real authenticated fetch before storing success
- provide clear user-facing failure reasons for malformed curl input or unauthenticated balance fetches

Verification:
- `bun run typecheck`
- run `/usage-zen-login` with invalid text and confirm the error is actionable
- run `/usage-zen-login` with a valid copied request and confirm storage occurs only after validation
- restart or reload the extension and confirm persisted Zen auth is still usable

Smoke tests:
1. Run `/usage-zen-login`.
2. Paste malformed text and confirm validation fails without saving auth.
3. Run `/usage-zen-login` again with a real copied dashboard request.
4. Confirm success only after a live balance fetch passes.
5. Reload the extension.
6. Confirm Zen remains configured without re-pasting credentials.

Exit criteria:
- Zen login flow is reliable enough for repeated setup and recovery
- extension-owned storage is separate from Pi auth

### Milestone 4: Zen provider ✅ Complete (2026-04-16)

Goal:
- implement the HTML-scrape balance pattern and integrate it into footer/dashboard flows

Tasks:
- add `src/extension/providers/zen.ts`
- fetch the Zen dashboard page using stored cookies
- parse server-rendered HTML for `data-slot="balance-value"`
- extract the exact dollar balance
- normalize Zen output into:
  - amount remaining
  - optional auth freshness/info line
  - error section when scraping fails
- render the compact footer string as `Zen balance $17.35` style output
- on unauthenticated responses, surface guidance to rerun `/usage-zen-login`

Verification:
- `bun run typecheck`
- run `/usage` with valid Zen auth and confirm Zen appears with exact balance
- activate a Zen model and confirm footer shows compact balance text
- intentionally invalidate cookies and confirm `/usage` handles the auth failure without crashing

Smoke tests:
1. Complete `/usage-zen-login`.
2. Select a Zen-backed model.
3. Confirm the footer shows `Zen balance $...`.
4. Run `/usage`.
5. Confirm Zen appears, and the dashboard value matches the footer.
6. Remove or corrupt stored Zen cookies.
7. Run `/usage` again.
8. Confirm the dashboard shows a Zen-specific auth recovery message and the rest of the extension still works.

Exit criteria:
- Zen works end to end with setup, persistence, fetch, parse, and recovery messaging

### Milestone 5: `/usage` dashboard integration and release hardening ✅ Complete (2026-04-16)

Goal:
- make the two-provider dashboard the real user-facing surface and harden failure cases

Tasks:
- finish dashboard rendering for:
  - loading state
  - partial success
  - per-provider errors
  - active-provider indicator
- ensure the dashboard shows only providers that are configured and fetchable
- ensure values shown in `/usage` align with footer values for the active provider
- finalize cleanup on `session_shutdown`
- replace the default footer with a custom two-line footer that preserves core model/context stats while integrating quota status:
  - line 1: cwd/branch on the left, provider/model/thinking level on the right
  - line 2: context bar + context percent first, then dimmed token/cost stats, with quota usage bars right-aligned
  - apply dimmed theme-aware styling to non-quota/non-context segments for visual balance
- update `README.md` with:
  - install steps
  - command list
  - Zen login flow
  - manual smoke-test checklist
  - known limitations and deferred providers

Verification:
- `bun run typecheck`
- do one full Pi verification pass covering both providers and unsupported models

Smoke test:
1. Configure Codex auth only.
2. Run `/usage` and confirm only Codex appears.
3. Configure Zen auth as well.
4. Run `/usage` and confirm both providers appear.
5. Switch active models between Codex, Zen, and an unsupported provider.
6. Confirm the active marker and footer behavior follow the selected model correctly.
7. Shut down the Pi session.
8. Confirm polling stops and the footer is cleared.

Exit criteria:
- `/usage` is usable as the primary dashboard
- footer behavior is trustworthy
- README contains enough setup and smoke-test guidance for future agents

## Implementation Order Inside Each Milestone

Agents should follow this order unless blocked:
1. add or reshape types
2. add provider/auth/storage internals
3. wire runtime lifecycle
4. wire command surfaces
5. run `bun run typecheck`
6. run the milestone smoke test in Pi
7. document any behavior or caveat immediately

## Verification Strategy

Primary verification:
- `bun run typecheck`
- real Pi smoke tests

Do not spend early time building a broad automated test suite. If isolated helpers are created and trivially testable, the best candidates are:
- Zen curl parsing
- Zen balance HTML extraction
- provider active-model detection
- small normalization helpers for Codex usage payloads

Even if helper tests are added later, they do not replace the required Pi smoke pass.

## Risks And Guardrails

### Highest-risk areas

- Pi runtime event wiring
- footer update/cleanup behavior
- Zen copied-curl parsing
- Zen cookie persistence and replay
- Zen HTML shape brittleness

### Guardrails

- do not couple UI rendering to provider-specific network logic
- do not mutate `~/.pi/agent/auth.json`
- do not persist raw copied curl commands
- do not invent percent-based Zen semantics
- treat one provider failing as a partial-success state, not a global failure

## Done Definition For v1

v1 is done when all of the following are true:
- `/usage` works as a read-only dashboard in Pi
- Codex appears only when Pi auth is available and fetch succeeds
- Zen appears only when extension-owned auth is present and fetch succeeds
- switching between Codex, Zen, and unsupported models updates or clears the footer correctly
- `/usage-zen-login` can recover Zen auth after expiration
- `bun run typecheck` passes
- `README.md` documents setup and manual smoke tests

## Post-v1 Follow-On Work

Once v1 is stable, future milestones can add:
- Anthropic Claude adapter
- Google Gemini adapter
- Synthetic.new adapter
- optional debug commands
- optional targeted parser tests for provider helpers
