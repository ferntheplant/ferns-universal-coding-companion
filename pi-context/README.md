# pi-context

Pi-native Context Lens extension for Pi.

The extension is being built in milestones. Milestone 0 converts the accepted spike into a production-facing scaffold:
- production command names
- runtime state shaped for sidecar management
- Pi event capture still present behind the scenes for ongoing implementation work

## v1 Architecture

The intended v1 architecture is:
- Pi-native event capture inside the extension
- one shared local sidecar on `127.0.0.1:4041`
- lifted Context Lens analysis, storage, LHAR export, and web UI modules
- no proxy or MITM layer in the normal path

The first validated Pi-native providers remain:
- `openai-codex`
- `opencode-zen`

## Commands

- `/pi-context` shows the current runtime summary
- `/pi-context-open` is the dashboard entrypoint
- `/pi-context-status` shows detailed runtime state
- `/pi-context-stop` stops the shared sidecar once sidecar management is implemented

At Milestone 0, the command surface is in place but sidecar lifecycle and browser-open behavior are still placeholders.

## Development

```bash
bun run typecheck
```

Planned sidecar entry:

```bash
bun run sidecar
```

Current spike conversion utility remains available during implementation:

```bash
bun run spike:to-context-lens
```

## Manual Smoke Flow For Milestone 0

1. Load or reload the extension in Pi.
2. Confirm `/pi-context`, `/pi-context-open`, `/pi-context-status`, and `/pi-context-stop` are registered.
3. Run `/pi-context-status`.
4. Confirm the runtime reports `sidecar=stopped` and does not reference the old spike-only command flow.

## Current Limitations

- the shared sidecar process is not implemented yet
- `/pi-context-open` does not launch the browser yet
- `/pi-context-stop` is currently a no-op when the sidecar is stopped
- fixture-writing capture is still present internally until the production ingest path replaces it
