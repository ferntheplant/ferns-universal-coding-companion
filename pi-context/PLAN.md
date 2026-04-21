# pi-context Implementation Plan

This plan turns `BLUEPRINT.md` and the accepted spike into an implementation-ready delivery plan for the full extension.

It is written for handoff to other coding agents. Each milestone is intended to be owned by one agent, has a focused write scope, and includes explicit verification steps. Full smoke testing remains manual; automated coverage is optional for pure conversion utilities but is not required for milestone completion.

## Scope

v1 scope:
- Pi-native capture only
- one shared local sidecar on `127.0.0.1:4041`
- reuse the Context Lens analysis/UI stack where practical
- support the spike-validated Pi flows first:
  - `openai-codex`
  - `opencode-zen`
- preserve LHAR export and the existing analysis experience as closely as Pi-native capture allows

Explicitly out of scope for v1:
- MITM or `https_proxy` capture
- exact raw response replay fidelity
- subagent/span reconstruction beyond a single main-agent attribution
- broad automated test investment for Pi runtime behavior

## Delivery Rules

- Treat the current code in `src/extension/*` and `scripts/spike-to-context-lens.ts` as spike/reference material, not final architecture.
- Prefer disjoint file ownership per milestone. If a later milestone must edit an earlier file, keep those edits minimal and integration-focused.
- Do not start provider-specific fallback proxy work unless the user explicitly approves it after a concrete Pi-native failure.
- If an implementer finds a provider payload shape that materially breaks conversion for `openai-codex` or `opencode-zen`, stop and ask for clarification before expanding scope.

## Target End State

Expected end-state layout:
- `index.ts`
- `src/extension/index.ts`
- `src/extension/commands.ts`
- `src/extension/runtime.ts`
- `src/extension/notifications.ts`
- `src/extension/collector.ts`
- `src/extension/capture-session.ts`
- `src/extension/server-manager.ts`
- `src/sidecar/index.ts`
- `src/sidecar/app.ts`
- `src/sidecar/pi-ingest.ts`
- `src/sidecar/paths.ts`
- `src/sidecar/lock.ts`
- `src/sidecar/context-lens/**` or equivalent lifted server/UI/core modules
- `README.md`
- `THIRD_PARTY_NOTICES.md`

## Milestones

## Milestone 0 - Production Scaffold and Scope Lock

Status: Completed on 2026-04-21

Primary write scope:
- `package.json`
- `README.md`
- `index.ts`
- `src/extension/index.ts`
- `src/extension/runtime.ts`
- `src/extension/commands.ts`
- `src/extension/notifications.ts`

Goal:
- replace the spike framing with a production extension scaffold and lock the v1 command surface

Tasks:
- add any missing package scripts needed for implementation and verification:
  - `typecheck`
  - `dev`
  - `sidecar` or equivalent sidecar entry
- rename the extension bootstrap from spike-specific behavior to production behavior
- define production runtime state for:
  - sidecar lifecycle
  - per-session capture state registry
  - health/status metadata
- replace spike commands with production commands:
  - `/pi-context`
  - `/pi-context-open`
  - `/pi-context-status`
  - `/pi-context-stop`
- keep any spike-reset/debug behavior out of the primary command set unless clearly marked as debug-only
- update `README.md` to describe the v1 architecture and manual smoke flow at a high level

Verification:
- `bun run typecheck`
- reload the extension in Pi
- confirm all production commands register successfully
- run `/pi-context-status` before the sidecar exists and confirm it reports a clean idle/stopped state

Exit criteria:
- no spike-only wording remains in the main command UX
- runtime state is ready for sidecar + collector integration

## Milestone 1 - Sidecar Skeleton and Singleton Ownership

Status: Completed on 2026-04-21

Primary write scope:
- `src/sidecar/index.ts`
- `src/sidecar/app.ts`
- `src/sidecar/paths.ts`
- `src/sidecar/lock.ts`
- `src/extension/server-manager.ts`

Goal:
- stand up a reusable sidecar process with explicit ownership and health checks

Tasks:
- create shared paths under `~/.pi-context/`:
  - `data/`
  - `logs/`
  - lock/pid metadata as needed
- implement sidecar boot on `127.0.0.1:4041`
- add health/status endpoints at minimum:
  - `GET /health`
  - `GET /api/status`
- implement single-owner process coordination using a lock file and pid metadata
- implement extension-side server manager helpers:
  - health-check existing sidecar
  - spawn detached sidecar if missing
  - stop sidecar cleanly
  - avoid double-start races across Pi instances

Verification:
- `bun run typecheck`
- start the sidecar via the extension or direct dev entry
- `curl http://127.0.0.1:4041/health` returns success
- start a second Pi instance and confirm it reuses the running sidecar instead of spawning another
- stop the sidecar and confirm `/health` fails afterwards

Exit criteria:
- one stable shared local sidecar process can be started, reused, and stopped

## Milestone 2 - Lift Context Lens Server, Store, UI, and LHAR Stack

Status: Completed on 2026-04-21

Primary write scope:
- lifted Context Lens modules under `src/sidecar/context-lens/**` or equivalent
- any import adapters needed in `src/sidecar/app.ts`
- `THIRD_PARTY_NOTICES.md`

Goal:
- bring over the reusable analysis/UI stack without proxy-era assumptions

Tasks:
- copy the reusable Context Lens modules identified in `BLUEPRINT.md`
- remove capture-directory watcher and proxy-specific bootstrap assumptions
- wire the lifted frontend, API routes, store, projection, and LHAR export into the new sidecar app
- ensure the sidecar can serve the UI shell and session data API even before Pi ingestion is connected
- add MIT attribution and third-party notices for lifted code
- mark substantially imported modules with short provenance comments where appropriate

Verification:
- `bun run typecheck`
- load `http://127.0.0.1:4041` in a browser and confirm the UI shell renders
- confirm the sidecar serves the API routes expected by the lifted frontend without runtime errors
- verify license and notice files exist and reference Context Lens reuse clearly

Exit criteria:
- the sidecar can serve the reused analysis/UI stack independently of proxy capture

## Milestone 3 - Pi-Native Ingest Contract and Conversion Pipeline

Status: Completed on 2026-04-21

Primary write scope:
- `src/sidecar/pi-ingest.ts`
- conversion helpers under `src/sidecar/**`
- optional refactor or partial reuse of `scripts/spike-to-context-lens.ts`

Goal:
- define the production `POST /api/ingest/pi` path and convert Pi-native captures into store writes and LHAR-compatible records

Tasks:
- define the Pi ingest payload shape for:
  - session identity
  - model/provider metadata
  - captured request payload
  - response status/headers
  - assistant message output
  - tool results
  - best-effort timings and byte estimates
- build the rolling per-session history reconstructor discovered in the spike
- synthesize `ContextInfo`, `ResponseData`, `CapturedEntry`, and LHAR-compatible records directly from Pi-native data
- preserve the spike’s accepted behavior for:
  - tool definition extraction
  - tool call extraction
  - tool result extraction
  - thinking blocks
  - cumulative growth/composition
- support ingesting sample spike fixtures into the live sidecar for parity checks

Verification:
- `bun run typecheck`
- start the sidecar and ingest existing spike-derived sample data
- confirm sessions appear in the UI
- compare a converted long spike session against the accepted `.lhar.json` samples in `tmp/`
- verify these fields are directionally correct in the UI:
  - composition buckets
  - context growth/utilization
  - tool definition counts
  - tool call counts
  - tool result volume

Exit criteria:
- manual ingest of Pi-native captures produces useful sessions in the reused frontend
- rolling-history reconstruction works for split tool loops

## Milestone 4 - Extension Collector and Turn Correlation

Status: Completed on 2026-04-21

Primary write scope:
- `src/extension/collector.ts`
- `src/extension/capture-session.ts`
- `src/extension/runtime.ts`
- `src/extension/index.ts`

Goal:
- replace fixture-writing spike behavior with production event correlation and normalized capture assembly
- use Pi-native turn semantics where each model-control cycle is a first-class turn; tool-loop continuation turns that begin with `tool_results` are expected and correct

Tasks:
- move per-session and per-turn capture logic into explicit capture-session structures
- capture and correlate:
  - `session_start`
  - `turn_start`
  - `context`
  - `before_provider_request`
  - `after_provider_response`
  - `message_update`
  - `message_end`
  - `tool_result`
  - `turn_end`
  - `session_shutdown`
- preserve enough rolling state to handle multi-cycle Pi tool loops where later cycles do not include a fresh provider payload
- preserve semantic turn boundaries for tool loops:
  - each defer/return cycle is captured as its own turn
  - turns may begin with `tool_results` rather than `user_text` after tool execution
- normalize best-effort timing fields
- stop writing spike fixtures as the primary output path
- emit one normalized Pi-native capture payload per finalized turn/user-visible step to the sidecar client layer

Verification:
- `bun run typecheck`
- run a real Pi session with a short tool loop
- confirm finalized captures are posted instead of written only to the spike directory
- verify no event-hook crashes across:
  - a simple prompt-only turn
  - a tool-heavy turn
  - session shutdown with an in-flight pending turn

Exit criteria:
- the extension produces production ingest payloads reliably from real Pi events
- UI turn timelines reflect the intended semantics for tool-loop turns without collapsing them into a single synthetic user turn

## Milestone 5 - Commands, Open Flow, and Runtime Integration

Status: Completed on 2026-04-21

Primary write scope:
- `src/extension/commands.ts`
- `src/extension/server-manager.ts`
- `src/extension/notifications.ts`
- small integration edits in `src/extension/index.ts`

Goal:
- make the extension usable day to day from Pi without manual sidecar management

Tasks:
- implement `/pi-context` as the primary “ensure sidecar running and summarize status” command
- implement `/pi-context-open` to open the browser UI
- implement `/pi-context-status` to report:
  - sidecar state
  - port
  - active session count if available
  - recent ingest/error counts if available
- implement `/pi-context-stop` as an idempotent stop command
- add clear user-facing notifications for:
  - sidecar startup
  - sidecar reuse
  - ingest failures
  - stop/restart behavior

Verification:
- `bun run typecheck`
- reload the extension in Pi
- run `/pi-context` from a clean state and confirm it starts or reuses the sidecar
- run `/pi-context-open` and confirm the UI opens
- run `/pi-context-stop` twice and confirm the second call is a no-op, not an error

Exit criteria:
- the extension has a production-ready command flow for starting, opening, checking, and stopping the shared service

## Milestone 6 - Privacy, Export, Persistence, and Multi-Instance Hardening

Primary write scope:
- sidecar persistence/export modules
- `README.md`
- any privacy/config surfaces added in `src/extension/**` or `src/sidecar/**`

Goal:
- finish the production edges that make the extension safe and usable across real Pi terminals

Tasks:
- persist session data under `~/.pi-context/data`
- verify LHAR export routes and file outputs in the new sidecar architecture
- add privacy controls mirroring Context Lens where practical for v1
- document what is approximate in Pi-native capture:
  - synthetic response bodies
  - estimated transfer sizes
  - single-agent attribution
- harden restart behavior after:
  - sidecar crash
  - Pi restart
  - multiple concurrent Pi sessions
- update `README.md` with operator-facing setup, commands, storage paths, and limitations

Verification:
- `bun run typecheck`
- capture sessions from two separate Pi terminals against one shared sidecar
- confirm both sessions appear in one UI
- export LHAR from the sidecar and confirm the output file is written successfully
- restart Pi, reuse the sidecar or restart it cleanly, and confirm persisted data remains available

Exit criteria:
- the extension is ready for normal use across multiple Pi terminals
- export, privacy notes, and persistence behavior are documented

## Manual Smoke Test Matrix

These smoke tests are the final acceptance bar after Milestone 6:

1. Start with no running sidecar.
2. Run `/pi-context`.
3. Confirm the sidecar starts and the UI becomes reachable on `127.0.0.1:4041`.
4. Run a short `openai-codex` session with one tool call.
5. Confirm the session appears in the UI with sensible composition and tool/result data.
6. Run a longer `opencode-zen` session with multiple tool cycles.
7. Confirm rolling history is reconstructed and the UI shows cumulative growth correctly.
8. Open a second Pi terminal and run another session.
9. Confirm both terminals feed the same shared dashboard.
10. Export LHAR and confirm the file writes successfully.
11. Stop the sidecar with `/pi-context-stop`.
12. Confirm the UI becomes unreachable and the next `/pi-context` invocation starts it again cleanly.

## Implementation Notes

- Milestones 3 and 4 were completed on 2026-04-21. Keep spike fixtures and `scripts/spike-to-context-lens.ts` as regression/parity oracles for future ingest changes.
- If an implementer discovers that `openai-codex` or `opencode-zen` no longer provide provider-native payloads in `before_provider_request`, stop and escalate before introducing fallback transport work.
- Automated tests may be added for pure conversion helpers, but milestone completion should not depend on broad Pi-runtime test coverage.
