# pi-context

Pi-native Context Lens extension for Pi.

## Status

Milestones 0-6 are complete.

The extension captures Pi turn events, posts normalized Pi-native ingest payloads to a shared local sidecar, and reuses the Context Lens analysis/UI/LHAR stack.

## Architecture

- Extension-side collector hooks Pi events (`turn_start`, `before_provider_request`, `message_end`, `tool_result`, `turn_end`, etc.).
- Collector emits one finalized payload per semantic turn/model-control cycle.
- Sidecar runs as a shared singleton on `127.0.0.1:4041` across Pi terminals.
- Sidecar ingests via `POST /api/ingest/pi`, reconstructs rolling history, writes store state, serves UI/API, and exports LHAR.

Validated providers:

- `openai-codex`
- `opencode-zen`

## Commands

- `/pi-context`
  - ensure sidecar running
  - show summary (`sidecar`, `port`, `privacy`, active sessions, ingest counters)
- `/pi-context-open`
  - ensure sidecar running
  - open dashboard in browser
- `/pi-context-status`
  - show detailed runtime state (`pid`, `port`, `privacy`, counters, data dir)
- `/pi-context-stop`
  - stop sidecar (idempotent)

## Sidecar Endpoints

- `GET /health`
- `GET /api/status`
- `POST /api/ingest/pi`
- `GET /api/requests?summary=true`
- `GET /api/export/lhar`
- `GET /api/export/lhar.json`

## Storage Paths

Under `~/.pi-context/`:

- `data/state.jsonl` (persistent compact session state)
- `data/details/` (per-entry detail files)
- `logs/sidecar.log`
- `run/sidecar.lock.json`
- `exports/` (recommended location for LHAR exports)

Collector debug fixtures are still written under:

- `~/.pi/agent/state/pi-context/spike/`

This is a parity/audit fallback, not the primary ingest path.

## Privacy Controls

Sidecar default privacy for LHAR exports is configurable via env var:

- `PI_CONTEXT_PRIVACY=minimal|standard|full`

Behavior:

- `minimal`: strips headers and raw bodies from export records
- `standard` (default): keeps redacted headers and derived metadata
- `full`: includes raw request/response bodies when available

You can also override per export using query params or script flags.

## Development

```bash
bun run typecheck
bun run sidecar
```

Spike parity tools:

```bash
bun run spike:ingest-pi --input ~/.pi/agent/state/pi-context/spike/<session-id> --reset-first
bun run spike:to-context-lens --input ~/.pi/agent/state/pi-context/spike/<session-id>
```

LHAR export helper:

```bash
bun run export:lhar --format lhar.json --privacy standard
# optional:
# --conversation <conversation-id>
# --output ~/.pi-context/exports/custom-name.lhar.json
```

## Known Approximations

Pi-native ingest is not wire-level proxy capture. The following are expected approximations:

- synthetic response bodies assembled from Pi message events
- best-effort transfer byte estimates (exact provider wire bytes unavailable)
- single main-agent attribution (no full span/subagent reconstruction)

These approximations are intentional for v1 and still preserve useful composition, growth, tool usage, and cost-oriented analysis.

## Multi-Instance and Restart Behavior

- multiple Pi terminals share one sidecar process
- extension reuses active sidecar via health checks
- lock-file awareness reduces duplicate-start races across concurrent terminals
- if sidecar is down, collector path auto-starts it before posting
- persisted state reloads on sidecar restart, so prior sessions remain visible

## Manual Verification (Milestone 6)

1. Run two Pi terminals against the same machine and send sessions from both.
2. Confirm both conversations appear in one dashboard.
3. Run `bun run export:lhar --format lhar` and verify file output under `~/.pi-context/exports`.
4. Restart Pi and/or sidecar, then confirm prior sessions are still present.
5. Run `/pi-context-stop`, then `/pi-context`, and confirm clean stop/restart cycle.
