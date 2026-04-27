# pi-context SPEC

## Purpose

Give Pi sessions the same Context Lens dashboard experience that proxy-based capture used to provide — without running a reverse proxy or MITM. One unified view across every Pi terminal on the machine, derived purely from Pi's own extension events.

## Behaviors

### What gets observed

For each Pi turn, the extension records:

- the model, provider, and API shape Pi is about to talk to
- the request payload Pi assembles
- the response metadata + completed assistant message Pi receives
- the tool definitions, tool calls, and tool results
- usage and cost data
- session-level structure (conversation grouping, ordering)

Wire-level fidelity is explicitly _not_ a goal. Pi does not expose raw provider response streams, so the captured record is best-effort: synthetic response bodies reassembled from message events, best-effort transfer-byte estimates, single-agent attribution. That is acceptable — analysis value comes from request shape, session structure, and usage, not from byte-for-byte reconstruction.

### Single shared dashboard across Pi terminals

- Every Pi instance posts captured turns to a shared local sidecar.
- The sidecar runs as a singleton on a fixed localhost port; the first Pi instance launches it, every subsequent instance health-checks and reuses it.
- A user with three Pi windows open should see all three conversations in one dashboard.
- Sidecar persists data so prior sessions remain visible across Pi restarts.

### Commands

- `/pi-context` — ensure sidecar is up, show a compact runtime summary.
- `/pi-context-open` — ensure sidecar is up, open the dashboard in a browser.
- `/pi-context-status` — show detailed runtime state for debugging.
- `/pi-context-stop` — stop the sidecar idempotently.
- `/pi-context-name <label>` — give the current session a human-readable name that shows up in the dashboard _and_ in Pi's footer status line. Names persist across restarts and are keyed off Pi's canonical session ID.

### Named sessions

Goals:

1. **Command** — Users can set a human-readable label for the current session from Pi using `/pi-context-name <label>` (registered as `pi-context-name` to avoid colliding with Pi’s reserved `/name`).

2. **Status line** — The active name appears in Pi’s footer via `ctx.ui.setStatus("pi-context-name", …)`.

3. **Canonical identity** — For Pi-sourced capture, the sidecar uses Pi’s session UUID from the extension (`ctx.sessionManager.getSessionId()`) as the conversation id instead of synthetic fingerprint-based ids.

4. **Dashboard** — Conversations carry an optional `name` field; the UI prefers it over the auto-extracted label when present, search matches both `name` and `label`, and explicitly named sessions rank higher in results.

5. **Persistence & sidecar sync** — Names are applied through Pi’s session APIs, persisted as a custom JSONL entry (`pi-context:session-name`), restored on `session_start`, and posted to the sidecar (`POST /api/session/name`) with pending-name support when naming happens before the first captured turn.

6. **LHAR export** — Session lines in JSONL exports and `sessions[]` entries in the bundled JSON export include `metadata.name` when a user-given name is present.

**Deferred:** Modeling Pi’s per-file conversation tree (`/tree`, branch switches, shared prefixes across branches) as distinct pi-context conversations — intentionally out of scope for the initial naming work.

**Deferred (auto-suggested names):** When no explicit session name is set, optionally run a small, **separately configured “naming” model** (cheaper tier, fixed provider/model/base URL from env or config) over the **first user-visible message** (or first compact turn summary) to propose a short, filesystem-friendly label. This would be **best-effort** only: bounded tokens, clear **opt-out**, no override of user `/pi-context-name` values, and a **visible distinction** in the dashboard between user names and machine suggestions. Implementation would need a sidecar or extension job, failure isolation (never block the main agent), and privacy review if content leaves the machine.

### Compatibility with existing Context Lens analysis

The captured records must be writable as LHAR so Context Lens's existing store, projection, analysis, and UI code keeps working unchanged. The "ingestion path" is the only thing that's swapped relative to the original Context Lens — everything downstream (frontend, analysis, LHAR export, storage layout under `~/.pi-context/`) is preserved.

### Privacy controls for export

When exporting LHAR for sharing or archival, the user picks a privacy mode:

- `minimal` — headers and raw bodies stripped.
- `standard` (default) — redacted headers + derived metadata only.
- `full` — raw request/response bodies included where available.

Configurable via env var (`PI_CONTEXT_PRIVACY`) and overridable per export.

### Multi-instance hygiene

- Concurrent Pi launches must not duplicate-start the sidecar (lock-file awareness).
- If the sidecar dies, the next collector POST should bring it back rather than dropping data silently.
- Extension lifecycle hooks must clean up cleanly on `session_shutdown`.

## Non-goals

- Reverse-proxy or MITM-based capture. Kept in reserve only as a fallback if a future provider proves uncapturable through Pi events; not part of the default install.
- Reproducing the original proxy's exact `CaptureData` object byte-for-byte. The Pi-native record is a deliberate approximation.
- Per-Pi-instance data silos. The dashboard must be unified.
- Mutating Pi's own session storage or auth files; sidecar state lives entirely under `~/.pi-context/`.
