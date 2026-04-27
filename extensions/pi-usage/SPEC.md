# pi-usage SPEC

## Purpose

Give the user a single, trustworthy view of remaining quota / balance across the AI providers they pay for, both as an at-a-glance footer and as an on-demand dashboard.

## Supported providers

- OpenAI Codex
- Anthropic Claude
- Google Gemini
- Synthetic.new
- OpenCode Zen

A provider only appears once it is authenticated and its data can actually be fetched. A broken provider must not break the others.

## Behaviors

### `/usage` dashboard

- Interactive overlay showing every authenticated provider in one place.
- The active provider for the current model is highlighted.
- Each provider renders in the format that matches its real underlying system — not a forced shared schema. Some are quota-percentages, some are dollar balances, some are multi-bucket.
- Loading, error, and partial-success states display cleanly.
- Closes on escape or confirm.

### Footer status line

- Persistent under-the-editor line summarizing usage for the currently selected model's provider.
- Updates automatically when the user changes models.
- Disappears when the active model is not one of the supported providers (rather than showing stale data or a fake row).
- Reads from a short-lived cache so model switches feel instant; refreshes are deduplicated when triggered by rapid UI events.

### Per-provider display intent

- **OpenAI Codex**: session % used, weekly % used, reset countdowns when known.
- **Anthropic Claude**: 5-hour % used, 7-day % used, reset countdowns, optional extra-spend / monthly limit when surfaced by the API.
- **Google Gemini**: best available request/quota view derived from the Google quota payload, presented as percent bars.
- **Synthetic.new**: rolling 5-hour and weekly token limits when present (preferred over the legacy subscription bucket); also search and free-tool-call style buckets when present.
- **OpenCode Zen**: exact dollar balance remaining (e.g. `Zen balance $17.35`). No invented percent bar — Zen is not quota-shaped.

### Zen auth recovery

Zen has no documented balance endpoint, so the extension scrapes the dashboard. When that auth expires:

- A setup/recovery command walks the user through copying a logged-in dashboard request (as `curl`) and pasting it.
- The extension extracts only the cookies it needs from the paste, validates them against a real balance fetch, and stores them only on success.
- Zen scrape auth lives separately from `~/.pi/agent/auth.json` so it can never mutate other providers' credentials.
- On future auth failure, the user is told to rerun the recovery flow rather than being silently zeroed out.

## Non-goals

- Forcing every provider into a single `session % / weekly %` schema.
- Showing inferred or invented metrics (Zen wallet target, fake percent bars, etc.) as if they were first-class data.
- Mutating Pi's shared `auth.json` for provider-specific scraping needs.
- Using only documented APIs — for Zen specifically, the documented surface doesn't expose balance, and a cookie-based scrape is acceptable for a personal extension.
