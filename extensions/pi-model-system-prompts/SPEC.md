# pi-model-system-prompts SPEC

## Purpose

Append model-specific system prompt fragments to Pi's existing system prompt chain — additively, never replacing Pi's defaults, project `SYSTEM.md`, `APPEND_SYSTEM.md`, skills, or other extensions' contributions.

## Behaviors

### Authoring prompt fragments

- Fragments live in flat repo-local directory `model-prompts/*.md`.
- Each file is YAML frontmatter followed by markdown body.
- Frontmatter requires a `models: string[]` selector list; an optional `description` may be included for status output.
- The markdown body is the prompt text that gets appended when a selector matches the active model.
- A single file can target many models by listing multiple selectors.

### Selector syntax

Three selector forms are supported:

- exact model — `<provider>/<model-id>` (e.g. `anthropic/claude-sonnet-4-5`)
- provider wildcard — `<provider>/*` (e.g. `anthropic/*`)
- model-id wildcard across providers — `*/<model-id>` (e.g. `*/gpt-5`)

Anything else (`*/*`, `claude-*`, regex, negation) is invalid and the file is skipped with a warning.

### Runtime injection

On every turn, before Pi sends a request:

1. Read the active model from `ctx.model` and form the key `<provider>/<model-id>`.
2. Resolve all matching fragments from the registry.
3. If there are no matches (or no active model), do nothing.
4. Otherwise concatenate matches in lexicographic filename order and append a single delimited block to `event.systemPrompt`:

   ```md
   ## Model-Specific Instructions

   Active model: <provider>/<model-id>

   <concatenated fragment content>
   ```

5. Pi continues with its full normal prompt stack plus the appended block.

### Failure mode

- A broken prompt file (missing frontmatter, invalid selectors, malformed YAML, empty body) must never block Pi from running.
- Bad files are skipped, recorded, and surfaced as warnings — once per distinct failure per session via `ctx.ui.notify`, and persistently in the status command.
- The base Pi prompt remains intact whether or not the extension contributes anything.

### Cache + refresh

- Registry is cached in memory, keyed by a fingerprint of `model-prompts/` (latest `mtimeMs` across `.md` files and the directory).
- `ensureFresh()` runs each turn; if the fingerprint changed, the registry rebuilds before resolving matches.
- No file watcher. Edits apply on the next turn without `/reload` when cheap; `/reload` is an acceptable fallback for anything more complex.

### Commands

- `/model-system-prompts-status` — show the active model key, prompt directory path, matched fragment files with their selectors, last applied outcome, last scan timestamp, and any warnings/errors.
- `/model-system-prompts-reset` — clear in-memory runtime state and force a rescan on next use.

## Non-goals

- Replacing Pi's base system prompt or any of its existing prompt sources.
- Provider-payload rewriting (`before_provider_request`) — this extension only appends to `systemPrompt` in `before_agent_start`.
- Remote prompt fetching, prompt-template `/commands`, or per-message interactive prompt selection.
- Cross-repo prompt-package sharing beyond the symlink-install model.
- Wildcard syntax beyond the three documented forms.
- Including source file paths in the appended prompt block (kept out to save tokens; provenance lives in the status command).
