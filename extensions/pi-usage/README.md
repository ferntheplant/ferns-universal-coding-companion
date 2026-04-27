# pi-usage

A Pi extension that provides unified usage visibility for supported providers.

## v1 Scope

Current providers:
- OpenAI Codex
- Cursor
- OpenCode Zen

Commands:
- `/usage` — show usage dashboard across configured providers
- `/usage-zen-login` — bootstrap Zen dashboard auth by pasting a logged-in request copied as `curl`

## Install

1. Install dependencies:

```bash
bun install
```

2. Typecheck:

```bash
bun run typecheck
```

3. Load/reload in Pi:

```text
/reload
```

## Zen Login Flow

Run:

```text
/usage-zen-login
```

Then:
1. Open Zen dashboard while logged in.
2. In browser DevTools → Network, copy the dashboard document request as `curl`.
3. Paste the full command.

Behavior:
- The extension parses cookies from the pasted command.
- It validates auth with a real dashboard fetch before saving.
- It stores only normalized auth material (URL + cookie key/values), not the raw curl command.
- If validation fails, nothing is saved.

## Manual Smoke Test Checklist

### Codex
1. Authenticate Codex in Pi.
2. Select a Codex model.
3. Confirm footer appears.
4. Run `/usage` and confirm Codex appears with matching values.

### Cursor
1. Authenticate Cursor in Pi.
2. Select a Cursor model.
3. Confirm footer appears.
4. Run `/usage` and confirm Cursor appears with matching values.

### Zen
1. Run `/usage-zen-login` with malformed text and confirm actionable error.
2. Run `/usage-zen-login` with a valid copied request.
3. Confirm success only after live validation.
4. Select a Zen model and confirm footer shows `Zen balance $...`.
5. Run `/usage` and confirm Zen balance appears.

### Provider switching
1. Switch between Codex, Cursor, Zen, and an unsupported model.
2. Confirm footer updates for supported providers and clears for unsupported providers.

## Known Limitations (v1)

- Zen balance is scraped from dashboard HTML and depends on current markup.
- Dashboard UI is currently text/notification based (not a custom rich overlay component yet).
- Claude, Gemini, and Synthetic are intentionally deferred until post-v1 milestones.
