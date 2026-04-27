# cmux-diff

A Bun-first Pi extension for reviewing git diffs inside cmux browser panes.

## Overview

`cmux-diff` opens an interactive diff viewer in a cmux browser pane, allowing you to:
- Review uncommitted changes, branch diffs, or specific commits
- Navigate a file tree with diff statistics
- Add overall, file-level, and line-level comments
- Submit comments directly into your Pi session

## Install

```bash
# From the extension directory
bun install

# In Pi, load the extension
/reload
```

## Commands

### `/cmux-diff`

Opens an interactive diff review in cmux.

Flow:
1. Select diff target (`uncommitted`, `branch`, or `commit`)
2. Choose where to open (new pane or existing pane)
3. Review diff in browser, add comments
4. Submit to inject comments into Pi editor

### `/cmux-diff-status`

Shows runtime status including:
- Server state (running/stopped)
- Active review tokens and targets
- Uptime and last access times

### `/cmux-diff-kill`

Force-stop the review server and clear all active review contexts. Use this if:
- The browser page gets stuck
- A review is orphaned after a crash
- You need to reset the extension state

## Development

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Dev mode (loads extension)
bun run dev
```

## Troubleshooting

### "A review is already active"

Only one review can be active per Pi session. Either:
- Finish and submit the current review
- Run `/cmux-diff-kill` to force reset

### Browser shows "Loading review..." forever

The server may be stuck. Run `/cmux-diff-kill` and try again.

### Comments not appearing in Pi

Check `/cmux-diff-status` to confirm:
- Server is running
- Your review token is active

If issues persist, `/cmux-diff-kill` and restart.

### Slow pane listing or startup

Pane discovery runs in parallel. Large repos may still take a moment to compute diffs—the server starts immediately to give feedback while the diff is computed.

## Architecture

See `docs/architecture.md` for implementation details.

## Requirements

- Bun runtime
- cmux (for pane management)
- Git repository

## License

MIT
