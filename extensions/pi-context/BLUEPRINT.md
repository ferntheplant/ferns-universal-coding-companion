# pi-context Blueprint

## Goal

Turn `references/context-lens` into a Pi extension project at `pi-context` that:

- captures Pi context usage without any reverse proxy or MITM layer
- runs a single shared local analysis/frontend server across all Pi instances
- preserves the existing Context Lens frontend and analysis experience as much as possible
- emits data that is compatible with the existing LHAR-based analysis pipeline

## Feasibility Summary

This is feasible, but not as a pure drop-in replacement for the current proxy capture path.

The good news:

- Pi exposes extension hooks for `context`, `before_provider_request`, `after_provider_response`, `message_end`, `tool_result`, `turn_end`, `session_start`, and `session_shutdown`
- `before_provider_request` appears to expose the actual provider payload Pi is about to send
- Pi exposes model metadata (`provider`, `api`, `baseUrl`, `contextWindow`)
- Pi session state is readable through `ctx.sessionManager`
- Context Lens’s frontend, store, LHAR generation, and most analysis code are not proxy-specific

The main constraint:

- Pi’s extension API does not appear to expose the raw provider response body/stream
- `after_provider_response` only gives status + headers
- because of that, we likely cannot reproduce the exact proxy `CaptureData` object for every request

Additional findings from inspecting existing Pi LHAR traces:

- `~/.context-lens/data/pi-21afa7a6ecbe92ad.lhar`
- `~/.context-lens/data/pi-ff117d670704aaf1.lhar`

Both traces strongly suggest that Pi sessions already derive most analytical value from request-side and session-structure data rather than raw response preservation.

Observed patterns in those traces:

- `raw.request_body` is `null`
- `raw.response_body` is `null`
- `parent_span_id` is always `null`
- `gen_ai.response.model` is often `null`
- `finish_reasons` are often empty
- `response_headers` are often empty

Despite that, the traces still retain the important data for the frontend:

- request model/provider/url/api format
- usage and cost
- tool definitions
- tool calls
- context composition
- growth/utilization
- security findings

That materially lowers the fidelity bar we need to hit. We do not need perfect wire-level reconstruction to reproduce the useful Pi analysis experience.

So the right plan is:

- keep the Context Lens analysis/UI stack
- replace the proxy capture layer with a Pi-native collector
- synthesize equivalent analyzed records from Pi events
- write LHAR from those analyzed records

That preserves the product while avoiding proxy management.

Current recommendation:

- proceed with Pi-native capture first
- treat transport-level raw fidelity as non-blocking for v1
- keep a Pi-specific reverse-proxy fallback in reserve only if the spike shows a concrete analysis regression

## Recommended Architecture

### 1. Shared analysis sidecar

We should still run a single local server process shared across Pi instances.

Reason:

- one Pi process cannot directly own state for all other Pi processes
- the shared frontend/API needs a singleton owner
- this is much simpler than a proxy and still gives one unified dashboard

Recommended behavior:

- server binds to a fixed localhost port, ideally `4041` to match Context Lens
- first Pi instance that needs it launches it
- later Pi instances health-check the port and reuse it
- server persists data under a shared app dir, e.g. `~/.pi-context/`

The extension should manage:

- health check
- spawn-if-missing
- optional `/pi-context-open`, `/pi-context-status`, `/pi-context-stop`

### 2. Pi-native collector inside the extension

Each Pi instance captures its own turns and POSTs them to the shared sidecar.

Collector responsibilities:

- observe provider request payloads
- observe response metadata and completed assistant messages
- correlate the data into one “captured turn”
- send normalized records to the analysis server

### 3. Reused Context Lens analysis/UI

The sidecar should reuse Context Lens code for:

- in-memory/session store
- LHAR export
- session analysis
- frontend API routes
- web UI

The only substantial replacement is the ingestion path.

### 4. Reverse-proxy fallback, only if needed

If Pi-native capture proves insufficient for a specific provider, Pi still gives us a cleaner proxy fallback than historical MITM approaches.

Reason:

- Pi provider base URLs can be sourced from `~/.pi/agent/models.json`
- current relevant mappings include:
  - `openai-codex` → `https://chatgpt.com/backend-api`
  - `opencode` → `https://opencode.ai/zen`
- Pi extensions can inspect and modify provider request payloads, and Pi supports provider registration/override

That means a fallback proxy path would likely be:

- local reverse proxy
- provider `baseUrl` rewritten to localhost
- no `https_proxy` MITM requirement

This is still less desirable than in-process capture, but significantly simpler than the old Codex MITM path.

## What We Can Lift From Context Lens

These parts should be reusable with little or no behavioral change:

- `references/context-lens/ui/**`
- `references/context-lens/src/server/api.ts`
- `references/context-lens/src/server/webui.ts`
- `references/context-lens/src/server/store.ts`
- `references/context-lens/src/server/projection.ts`
- `references/context-lens/src/server/tags-store.ts`
- `references/context-lens/src/core/**`
- `references/context-lens/src/lhar/**`
- `references/context-lens/src/http/headers.ts`
- `references/context-lens/src/types.ts`
- `references/context-lens/src/schemas.ts`
- `references/context-lens/schema/lhar.schema.json`

These parts are useful but may need light adaptation:

- `references/context-lens/src/analysis/server.ts`
  - keep the server bootstrap shape
  - remove capture-directory watcher assumptions
- `references/context-lens/src/analysis/ingest.ts`
  - reuse parsing ideas, but likely replace it with Pi-native ingest
- `references/context-lens/src/core/source.ts`
  - source detection becomes simpler because source is always Pi

These parts are proxy-specific and should not be ported:

- `references/context-lens/src/proxy/**`
- `references/context-lens/src/analysis/watcher.ts`
- CLI wrapper code for launching tools through the proxy
- `mitm_addon.py`

Fallback-only reuse, if Pi-native capture fails for a provider:

- `references/context-lens/src/proxy/server.ts`
- `references/context-lens/src/proxy/config.ts`
- `references/context-lens/src/proxy/capture.ts`
- `references/context-lens/src/core/routing.ts`

These would only matter for a Pi-specific reverse-proxy mode, not for the preferred architecture.

## What We Need To Write Ourselves

### Extension-side code

- singleton sidecar manager
- Pi event collector
- turn correlation state machine
- Pi-to-analysis ingest client
- Pi commands for open/status/reset/stop
- runtime state and cleanup

Suggested layout:

- `src/extension/index.ts`
- `src/extension/commands.ts`
- `src/extension/runtime.ts`
- `src/extension/collector.ts`
- `src/extension/capture-session.ts`
- `src/extension/server-manager.ts`
- `src/extension/notifications.ts`

### Sidecar/server code

- sidecar entrypoint
- new ingest endpoint for Pi-native captures
- adapter that converts Pi-native capture records into `CapturedEntry` / store writes
- process locking / port ownership logic

Suggested layout:

- `src/sidecar/index.ts`
- `src/sidecar/app.ts`
- `src/sidecar/pi-ingest.ts`
- `src/sidecar/paths.ts`
- `src/sidecar/lock.ts`

## Preferred Ingestion Strategy

We should not force Pi into the old proxy `CaptureData` shape if doing so requires inventing fake raw HTTP bodies.

Instead, add a new ingest path:

- `POST /api/ingest/pi`

Payload should contain:

- session identifiers
- model/provider/api metadata
- outbound provider payload captured from `before_provider_request`
- response status/headers from `after_provider_response`
- final assistant message from `message_end`
- tool results from `turn_end`
- timing/byte estimates where available

Then the sidecar can build `ContextInfo`, `ResponseData`, `CapturedEntry`, and LHAR records directly.

This keeps the analysis/UI stable while acknowledging that Pi capture is not wire capture.

Important note from real Pi LHAR traces:

- existing Pi LHAR output already tolerates `null` raw bodies and sparse response metadata
- therefore, parity should be judged by frontend usefulness and derived analysis fields, not by exact HTTP replay fidelity

## How To Capture Pi Data

### Core event mapping

Recommended hooks:

- `session_start`
  - initialize per-session capture state
  - register the Pi session id / session file / cwd
- `turn_start`
  - open a pending turn record
  - record timestamp and turn index
- `context`
  - optional fallback snapshot of resolved prompt messages
  - useful if we need debugging or sanity checks
- `before_provider_request`
  - primary request capture point
  - store the exact outbound payload
  - record provider/api/model/baseUrl from `ctx.model`
  - start timing
- `after_provider_response`
  - capture HTTP status and response headers
  - record first-response timing if available from local timers
- `message_end`
  - when role is `assistant`, finalize response usage/content/stop reason
- `tool_result`
  - collect tool results associated with the turn
- `turn_end`
  - finalize the normalized capture and send it to the sidecar
- `session_shutdown`
  - flush pending state and clear runtime structures

### Request capture

The request side looks solid.

From Pi we should be able to capture:

- `ctx.model.provider`
- `ctx.model.api`
- `ctx.model.id`
- `ctx.model.baseUrl`
- `ctx.model.contextWindow`
- `event.payload` from `before_provider_request`

That is enough to:

- classify provider/api format
- build `ContextInfo` via Context Lens parsing code
- compute composition and utilization

### Response capture

The response side is the main approximation layer.

What Pi clearly exposes:

- assistant message content
- assistant usage
- assistant stop reason
- provider/model on the assistant message
- tool results
- response status and headers

What Pi does not appear to expose:

- raw JSON response body
- raw SSE stream body
- exact transfer byte counts from the provider

So for v1 we should synthesize `ResponseData` from Pi’s final assistant message.

Examples:

- Anthropic-like synthetic response:
  - `role`
  - `content`
  - `usage`
  - `model`
  - `stop_reason`
- OpenAI-like synthetic response:
  - `model`
  - `usage`
  - `choices` or `output`
  - finish reason

The purpose is not network replay. The purpose is preserving:

- usage extraction
- model attribution
- stop reason attribution
- assistant content visibility
- LHAR export fidelity for analysis

For long Pi sessions, the most important derived fields appear to be:

- thinking blocks
- tool calls
- tool results
- accumulated message growth
- tool definitions

Those are much more important than raw provider bytes for the frontend we want to preserve.

Additional spike finding:

- a single user-visible Pi interaction can span multiple Pi `turn_start`/`turn_end` cycles
- in practice, tool-heavy flows often break down as:
  - assistant thinking + tool call
  - tool result
  - assistant thinking + next tool call
  - tool result
  - assistant thinking + final response
- later cycles may not expose a fresh `before_provider_request.payload`
- therefore, the ingest/conversion layer must maintain rolling per-session message history and synthesize missing request context for follow-on cycles

This is the main Pi-specific behavior we need to account for.
It is not a blocker, but it means a naive “one spike file = one independent request” mapping is incorrect for tool loops.

### Session and trace identity

Recommended identifiers:

- Pi session id: `ctx.sessionManager.getSessionId()`
- working session file: `ctx.sessionManager.getSessionFile()`
- cwd: `ctx.cwd`
- turn index: `turn_start.turnIndex`

For LHAR:

- use the Pi session id as the canonical conversation id
- hash it the same way Context Lens already hashes conversation ids into `trace_id`

### Agent / subagent attribution

This is currently the weakest area.

I do not see an obvious extension hook that exposes:

- stable subagent ids
- parent/child agent relationships
- nested spans for delegated work

Recommendation:

- v1: emit all entries with a single `agentKey` / main-agent role
- keep the data model ready for richer agent attribution later

This means the main frontend should work, but subagent breakdowns may be incomplete until Pi exposes more metadata.

### Timings and transfer sizes

Likely available in v1:

- turn start timestamp
- provider request timestamp
- provider response header arrival timestamp
- assistant completion timestamp

Likely unavailable in v1:

- exact network send/receive split
- exact request/response bytes on the wire

Recommendation:

- store best-effort timings
- set bytes to estimated serialized size of the request and synthetic response
- clearly mark these as approximations in code/comments

That is acceptable for the analysis UI, but it should be documented.

## LHAR Compatibility Plan

We should preserve the current LHAR schema and export routes.

That is achievable if we populate:

- `source`
- `gen_ai`
- `usage_ext`
- `http`
- `timings`
- `transfer`
- `context_lens`
- `raw`

Expected fidelity by field:

- `source`: high fidelity
- `gen_ai`: high fidelity
- `usage_ext`: high fidelity
- `http.status_code` and response headers: high fidelity
- `http.url`: medium fidelity unless Pi exposes the exact endpoint per model
- `timings`: medium fidelity
- `transfer`: low-to-medium fidelity
- `raw.request_body`: high fidelity if we store `before_provider_request` payload
- `raw.response_body`: medium fidelity because it will be synthesized, not raw provider output

So the analysis tools should continue to work, but “raw transport replay” semantics should not be promised.

For Pi sessions specifically, based on the inspected LHAR traces, this appears acceptable because those raw fields were already absent while the analysis remained useful.

## Single Shared Frontend Server Plan

The sidecar should behave like a normal local app service:

- listen on `127.0.0.1:4041`
- own the Context Lens frontend and API
- persist state under `~/.pi-context/data`
- optionally store logs under `~/.pi-context/logs`

Server ownership options:

1. Detached child process started by the extension
2. Reuse an already-running process if health check succeeds

Recommended:

- detached child process with health check and a pid/lock file

That gives:

- one UI for all Pi sessions
- persistence across Pi restarts
- minimal coupling to a single terminal instance

## Implementation Phases

### Phase 1: Prove capture feasibility

- add a debug extension that logs:
  - `before_provider_request.payload`
  - `after_provider_response.status`
  - `after_provider_response.headers`
  - assistant `message_end`
  - `message_update.assistantMessageEvent`
  - `turn_end.toolResults`
- verify provider shapes for:
  - `openai-codex`
  - `opencode-zen`
- confirm that Pi has no subagent support and treat all entries as main-agent only

Deliverable:

- sample captured JSON fixtures for each provider

Success criteria:

- we can reconstruct tool definitions from the outgoing request
- we can reconstruct tool calls from assistant message / stream events
- we can reconstruct tool results from turn-end data
- we can reconstruct thinking blocks closely enough to match LHAR composition trends
- we can derive usage, cost basis, context window, and growth

Failure criteria:

- Pi strips too much assistant/tool/thinking structure to reproduce composition meaningfully
- provider payloads differ from the actual sent request in ways that break parsing

If this phase fails for a provider, consider enabling reverse-proxy fallback for that provider only.

### Phase 2: Stand up the sidecar with lifted Context Lens UI

- port the UI and server/store/LHAR/core modules
- remove proxy watcher assumptions
- boot the frontend on a fixed local port
- make manual `/api/ingest/pi` calls write sessions visible in the UI

Deliverable:

- sidecar serves the original frontend with synthetic sample sessions

### Phase 3: Build the Pi-native collector

- implement event correlation
- send normalized Pi captures to the sidecar
- verify that real Pi turns appear in the UI

Deliverable:

- live Pi session data visible in the reused frontend

Validation target:

- compare a real Pi-native captured long session against a representative old Context Lens Pi LHAR
- especially compare:
  - composition categories
  - cumulative growth
  - tool definition counts
  - tool call counts
  - tool result volume
  - security findings

### Phase 4: Harden singleton/orchestration behavior

- port health/status routes
- add status/open/stop commands
- add cleanup and restart behavior
- test multiple concurrent Pi instances

Deliverable:

- one shared stable local analysis server across terminals

### Phase 5: Privacy/export polish

- add privacy settings mirroring Context Lens where practical
- verify LHAR export paths
- add MIT attribution and third-party notices

## Licensing / Reuse Notes

Context Lens is MIT licensed, so we can lift substantial code directly as long as we preserve the license and attribution.

We should include:

- copied MIT license text from Context Lens
- a `THIRD_PARTY_NOTICES.md` or equivalent
- comments/docstrings marking substantially imported modules

## Open Questions

1. Are `before_provider_request` payloads always final, provider-native payloads for `openai-codex` and `opencode-zen`?
2. Does Pi expose the exact target URL per request anywhere beyond model `baseUrl`, or should we derive endpoint URLs ourselves?
3. Can we access exact request/response byte counts anywhere in Pi internals, or should we treat them as estimates permanently?
4. Do we want a provider-specific reverse-proxy fallback if only one provider fails the Pi-native spike, or should the architecture stay single-mode?

Resolved by spike:

- `message_update.assistantMessageEvent` does preserve enough structure to reconstruct thinking, tool-call, tool-result, and final-response flows credibly for the tested `opencode` sessions
- the more important implementation detail is multi-cycle turn reconstruction, not missing assistant structure

## Bottom-Line Recommendation

Proceed as:

- a Pi-native collector
- plus a shared local analysis sidecar
- plus a largely lifted Context Lens frontend/analysis stack

Do not try to recreate the proxy layer internally.

The frontend/server reuse story is strong.
Main spike result:

- Pi-native capture is acceptable for the intended Context Lens analysis experience
- missing transport fidelity did not prevent useful reconstruction
- the main implementation requirement is reconstructing rolling history across multiple Pi turn cycles within one user-visible task

So the recommended path is now Pi-native-only by default, with reverse-proxy fallback kept only as contingency.

## Concrete Spike Plan

### Objective

Validate that Pi-native extension events can reproduce the analytically important fields from real Pi Context Lens LHAR sessions without any proxy.

### Providers

- `openai-codex`
- `opencode-zen`

### Spike artifact

Build a temporary debug-only extension mode that writes structured JSON fixtures under:

- `~/.pi/agent/state/pi-context/spike/`

Per turn, store:

- session metadata
- turn index and timestamps
- active model/provider/api/baseUrl/contextWindow
- `before_provider_request.payload`
- `after_provider_response.status`
- `after_provider_response.headers`
- every assistant `message_update.assistantMessageEvent`
- final assistant `message_end`
- `turn_end.toolResults`
- optional `context` snapshot for diffing/debugging

### Test scenarios

1. Short Codex session with one tool call
2. Longer Codex session with many tool calls and edits
3. Long Codex session near high context utilization
4. Short OpenCode Zen session
5. Longer OpenCode Zen session with multiple tool interactions

### Evaluation method

For each captured session:

- synthesize a provisional `CapturedEntry` stream
- compute:
  - composition
  - growth
  - tool definition extraction
  - tool call extraction
  - usage totals
  - security findings
- compare those results against:
  - old Pi LHAR traces where available
  - the visible behavior in the Context Lens frontend

Observed spike result:

- generated `.lhar.json` output loaded credibly in Context Lens after reconstructing rolling message history across split Pi turns
- system prompt, tool definitions, tool calls, tool results, thinking blocks, and final assistant responses were all recoverable from the captured Pi events
- the main conversion requirement was to treat later tool/edit/final cycles as continuations of the same rolling request history rather than isolated requests

### Acceptance bar

Accept Pi-native capture if:

- the frontend remains useful and credible
- composition buckets are directionally correct
- long-session growth behavior matches reality
- tool/result-heavy sessions look materially the same as old Pi LHAR sessions
- missing transport fidelity does not obscure session analysis

Spike outcome:

- acceptable
- output is credible enough to proceed
- tool-heavy edit workflows render well once rolling history reconstruction is applied

Reject Pi-native capture for a provider if:

- thinking/tool-call/tool-result composition is badly wrong
- growth becomes misleading
- important session structure disappears from the analysis UI

### Outcome decision

Current decision:

- spike passed for the tested `opencode` sessions
- proceed with Pi-native-only implementation
- preserve reverse-proxy fallback only as contingency, not as planned primary path
