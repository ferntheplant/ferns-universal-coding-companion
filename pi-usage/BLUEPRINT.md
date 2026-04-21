# pi-usage Blueprint

## Goal

Build a Pi extension that unifies usage visibility across these providers:

- OpenAI Codex
- Anthropic Claude
- OpenCode Zen
- Google Gemini
- Synthetic.new

The extension should provide:

- a single `/usage` command that shows a compact dashboard across all supported providers that are currently authenticated
- a persistent footer status line under the editor for the currently selected model provider, when that provider is one of the supported five

This repo is a cleaned-up port of the existing `pi-usage-bars` concept, with a narrower provider set and clearer provider abstractions.

## Product Requirements

### Primary UX

- `/usage` opens an interactive TUI overlay
- The overlay shows only providers that are currently authenticated and fetchable
- The currently active provider is marked in the dashboard
- Each provider row shows the provider-specific quota state in a consistent visual format where possible
- The footer automatically updates to reflect the currently selected model provider
- The footer disappears when the active model is not one of the five supported providers

### Provider-Specific UX

#### OpenAI Codex

- Show session percent used
- Show weekly percent used
- Show reset countdowns when available

#### Anthropic Claude

- Show 5-hour percent used
- Show 7-day percent used
- Show reset countdowns when available
- Show extra spend and monthly limit when enabled

#### Google Gemini

- Show the best available request/quota view from the Google quota payload
- Use percent bars similar to existing `pi-usage-bars`

#### Synthetic.new

- Show the current quota system returned by Synthetic
- Prefer newer rolling five-hour and weekly token limits over the legacy subscription bucket
- Also show search and free-tool-call style buckets when present
- Reuse the current `pi-synthetic-provider` interpretation rules where practical

#### OpenCode Zen

- Show exact dollar balance remaining, not a fake subscription percent
- Footer should display a compact balance string such as `Zen balance $17.35`
- `/usage` should show exact balance and auth state
- No percent bar is required for Zen
- If later we can reliably extract auto-reload threshold or wallet target, that can be shown as secondary metadata, but it is not required for v1

### Auth UX

- Providers should appear only when the extension can detect valid auth material
- OAuth-backed providers should reuse Pi auth storage in `~/.pi/agent/auth.json`
- Synthetic should support the same API-key resolution order as `pi-synthetic-provider`
- Zen balance auth may require a dashboard session cookie separate from the Zen API key
- If Zen balance fetch fails with an unauthenticated response, the extension should prompt the user to refresh Zen auth by copying a logged-in dashboard request as `curl` and pasting it into a setup command
- The extension should parse that pasted command, extract the relevant cookie headers, and persist only what it needs

## Architecture

### High-Level Shape

Follow the starter repo pattern and keep the entrypoint thin.

Suggested layout:

- `index.ts`
- `src/extension/index.ts`
- `src/extension/commands.ts`
- `src/extension/runtime.ts`
- `src/extension/providers/`
- `src/extension/providers/types.ts`
- `src/extension/providers/registry.ts`
- `src/extension/ui/dashboard.ts`
- `src/extension/ui/footer.ts`
- `src/extension/auth/`
- `src/extension/storage.ts`
- `src/extension/notifications.ts`

### Core Concepts

#### 1. Provider Adapter Interface

Each provider should implement a shared adapter contract so the command and footer code do not know about provider-specific fetch details.

Suggested shape:

- `id`
- `label`
- `detectActive(model): boolean`
- `isConfigured(context): Promise<boolean>`
- `refreshAuthIfNeeded(context): Promise<void>`
- `fetchUsage(context): Promise<ProviderUsageResult>`
- `renderFooter(result): string`
- `renderDashboardSections(result): DashboardSection[]`

This is the main cleanup over `pi-usage-bars`, which currently mixes UI decisions and provider branching in a single extension file.

#### 2. Normalized Usage Model

Do not force all providers into a single fake percent schema. Use a normalized display model that supports multiple section types:

- `percent_bar`
- `amount_remaining`
- `amount_used_vs_limit`
- `reset_timer`
- `info_line`
- `error`

This is important because Zen is not quota-percent based, and Synthetic has multiple quota system shapes.

#### 3. Runtime Cache

Keep a small in-memory cache per provider:

- last successful fetch timestamp
- last fetched result
- last auth error
- last fetch error

The footer should read from cached state first and refresh on a poll interval or provider-switch event.

### Event Model

Mirror the proven `pi-usage-bars` event approach:

- `session_start`
- `turn_start`
- `model_select`
- `session_shutdown`

Behavior:

- On `session_start`, detect active model, hydrate auth state, fetch active provider usage, and start polling
- On `model_select`, re-detect provider and fetch immediately if provider changed
- On `turn_start`, refresh active provider detection in case model state changed indirectly
- On `session_shutdown`, clear intervals and remove footer status

### Polling Strategy

Default polling interval:

- 2 minutes for quota providers
- Zen can use the same interval for simplicity

Rules:

- Only fetch the active provider aggressively for footer freshness
- `/usage` may fetch all configured providers on demand
- Reuse cached results inside a short freshness window to avoid redundant fetches during rapid UI events
- Deduplicate concurrent polls

## Provider Implementations

### OpenAI Codex

Auth source:

- `~/.pi/agent/auth.json`
- OAuth provider id: `openai-codex`

Fetch source:

- `https://chatgpt.com/backend-api/wham/usage`

Display model:

- session percent
- weekly percent
- reset timers

Implementation note:

- This is already implemented in `pi-usage-bars` and can largely be ported with minimal change.

### Anthropic Claude

Auth source:

- `~/.pi/agent/auth.json`
- OAuth provider id: `anthropic`

Fetch source:

- `https://api.anthropic.com/api/oauth/usage`
- `anthropic-beta: oauth-2025-04-20`

Display model:

- 5-hour usage percent
- 7-day usage percent
- reset timers
- optional extra spend line

Implementation note:

- This is also already implemented in `pi-usage-bars`.

### Google Gemini

Auth source:

- `~/.pi/agent/auth.json`
- OAuth provider id: `google-gemini-cli`

Fetch sources:

- `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`
- fallback project discovery through `loadCodeAssist`

Display model:

- derived session and weekly bars from Google buckets

Implementation note:

- Reuse the bucket parsing and project-id discovery logic from `pi-usage-bars`.

### Synthetic.new

Auth source priority:

1. Pi runtime provider API key
2. `~/.pi/agent/auth.json`
3. environment variable `SYNTHETIC_API_KEY`

Fetch source:

- `https://api.synthetic.new/v2/quotas`

Display model:

- rolling 5h limit when present
- weekly token limit when present
- search hourly bucket when present
- free tool calls or tool-call discounts when present
- hide legacy subscription bucket when newer quota systems are present

Implementation note:

- This should borrow the quota response interpretation from `pi-synthetic-provider`, but fit it into the shared provider adapter contract instead of preserving the existing standalone command UI.

### OpenCode Zen

Auth sources:

- API key for model usage remains outside this extension's usage-fetch path
- dashboard session cookies for balance scraping

Fetch strategy:

1. Perform an authenticated HTML request to the Zen dashboard page
2. Parse server-rendered HTML for `data-slot="balance-value"`
3. Extract exact dollar balance

Implementation detail:

- When using a copied browser request as the source for Zen auth bootstrap, strip or normalize the `Accept-Encoding` header before replaying it
- In local testing, copied browser requests failed with `curl: (56) Unrecognized content encoding type` because the browser-advertised encodings were broader than the local `curl` build supported
- Preferred replay behavior is either:
  - remove `Accept-Encoding` entirely
  - or force `accept-encoding: identity`
  - or limit to `gzip, deflate` with `--compressed`
- The extension should not persist a raw copied `curl` command. It should extract cookies from it, then make its own normalized HTTP request for the Zen dashboard page

Known HTML pattern found during research:

```html
<span data-slot="balance-value">$<!--$-->17.35<!--/--></span>
```

Display model:

- exact dollar balance remaining
- optional info line for auth freshness or scrape source

Auth recovery flow:

- Add a command such as `/usage-zen-auth`
- Prompt the user to open the Zen dashboard, copy a logged-in request as `curl`, and paste it
- Parse the command and extract relevant cookie material
- Store cookies in extension-owned local storage
- On auth failure, surface a message telling the user to rerun the Zen auth flow

Storage note:

- Persist only the minimum cookie values needed for the dashboard request
- Keep Zen scraping auth separate from Pi provider auth

Risk note:

- Zen is the highest-brittleness provider because this relies on HTML scraping rather than a documented usage endpoint

## Commands

### `/usage`

Main command. Requirements:

- interactive overlay
- shows all configured providers
- marks active provider
- supports loading, error, and partial-success states cleanly
- closes on escape or confirm

### `/usage-zen-auth`

Setup and recovery command for Zen dashboard scraping auth.

Requirements:

- explains the copy-as-curl flow
- accepts pasted curl content
- extracts cookies
- validates with a real balance fetch
- stores auth only on successful validation

### Optional Debug Commands

Useful during development, but not required for first user-facing release:

- `/usage-refresh`
- `/usage-status`
- `/usage-reset`

## Storage

### Pi Auth Reuse

Continue reading OAuth/API credentials from:

- `~/.pi/agent/auth.json`

### Extension-Owned Storage

Need a local storage area for:

- Zen dashboard cookies
- optional Zen dashboard URL/path if needed
- extension settings such as poll interval or footer enablement if added later

Store this separately from Pi auth so the extension does not mutate unrelated provider credentials.

## Design Tradeoffs

### Chosen

#### Shared adapter layer

Why:

- keeps provider logic isolated
- makes Zen and Synthetic first-class without forcing them into Codex/Claude assumptions
- reduces the large branching structure seen in `pi-usage-bars`

#### Shared display primitives, not shared quota semantics

Why:

- some providers are true percentage quotas
- Synthetic has multiple quota schema variants
- Zen is balance-based, not quota-percent based

#### Reuse proven network logic where available

Why:

- Codex, Claude, and Gemini fetching in `pi-usage-bars` already solve the hard parsing/auth refresh problems
- Synthetic quota logic in `pi-synthetic-provider` already captures current response-shape decisions

#### Zen exact-balance display

Why:

- percent would be invented and misleading
- exact dollars remaining is the real operational signal

### Rejected

#### Forcing every provider into `session` and `weekly` percentages

Rejected because:

- Zen does not fit
- Synthetic does not always fit
- it would create misleading UI and awkward code

#### Using only documented APIs for all providers

Rejected because:

- Zen currently has no documented balance endpoint
- the dashboard HTML already contains server-rendered balance data
- a cookie-based scrape is acceptable for this personal extension

#### Putting all provider logic directly in `src/extension/index.ts`

Rejected because:

- `pi-usage-bars` already shows the maintenance cost of that structure
- the new provider set is more heterogeneous

## Implementation Plan

### Phase 1

- scaffold provider adapter interfaces and normalized usage types
- port Codex, Claude, and Gemini from `pi-usage-bars`
- implement footer manager and active-provider detection

### Phase 2

- port Synthetic quota fetch and parsing from `pi-synthetic-provider`
- convert Synthetic data into normalized dashboard/footer sections

### Phase 3

- implement Zen cookie storage, curl parsing, HTML fetch, and balance scraping
- add `/usage-zen-auth`

### Phase 4

- build `/usage` overlay
- integrate all providers into dashboard
- add manual smoke-test notes to repo docs

## Verification Strategy

Manual testing matters more than unit-test depth here.

Required checks:

- active footer updates on model switch
- footer disappears for unsupported providers
- `/usage` shows only authenticated providers
- broken auth for one provider does not break the whole dashboard
- Zen auth recovery works after cookie expiration
- Synthetic displays the right quota shape for both legacy and enhanced responses

Recommended automated coverage:

- parsing helpers
- provider detection
- auth extraction for Zen curl parsing
- HTML balance extraction for Zen
- Synthetic quota normalization rules

## Relevant Sources

### Existing local repos

- `pi-usage-bars`
- `pi-usage-bars/extensions/usage-bars/index.ts`
- `pi-usage-bars/extensions/usage-bars/core.ts`
- `pi-usage-bars/tests/usage-bars-core.test.ts`
- `pi-usage`
- `pi-usage/docs/pi-extension-guide.md`

### Existing external implementations and docs

- `pi-usage-bars` inspiration noted in its README:
  - https://github.com/ajarellanod/pi-usage-bars
  - https://github.com/steipete/CodexBar
  - https://github.com/mikeyobrien/rho/tree/main/extensions/usage-bars
- Synthetic provider package:
  - https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-synthetic-provider
- Synthetic provider quota implementation:
  - https://github.com/ben-vargas/pi-packages/blob/main/packages/pi-synthetic-provider/extensions/quota.ts
- Synthetic provider quota command:
  - https://github.com/ben-vargas/pi-packages/blob/main/packages/pi-synthetic-provider/extensions/commands/synthetic-quota.ts
- Synthetic API overview:
  - https://dev.synthetic.new/docs/api/overview
- Synthetic models docs:
  - https://dev.synthetic.new/docs/api/models
- OpenCode Zen docs:
  - https://opencode.ai/docs/zen/

## Final Notes

The core cleanup goal is not aggressive refactoring for its own sake. It is:

- to separate provider fetch/auth logic from UI rendering
- to avoid fake normalization that hides real provider differences
- to keep the extension simple enough that adding or adjusting one provider does not destabilize the others

For v1, the most important product outcome is a reliable `/usage` dashboard and a trustworthy footer for the active provider. Zen is intentionally an exception in presentation and auth flow because the real system is different.
