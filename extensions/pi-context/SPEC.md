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
