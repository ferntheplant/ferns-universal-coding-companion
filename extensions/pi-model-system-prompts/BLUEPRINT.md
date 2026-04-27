# BLUEPRINT

## Goal

Build Pi extension that appends model-specific system prompt fragments to Pi's normal system prompt chain.

Key requirement:

- never replace Pi default/system/user prompt stack
- only append extra instructions for active model
- keep custom prompt files in this repo
- support install by symlinking repo into `~/.pi/agent/extensions/`

## Research Summary

### Pi hooks and resource model

Findings from Pi docs:

- `before_agent_start` can modify per-turn system prompt by returning `{ systemPrompt }`.
- `event.systemPrompt` already contains Pi-built prompt stack for turn.
- `ctx.model` exposes currently active model.
- extensions auto-discover from `~/.pi/agent/extensions/*/index.ts` and reload with `/reload`.
- project/global `.pi/SYSTEM.md` replaces Pi default prompt, while append sources like `APPEND_SYSTEM.md` and `--append-system-prompt` are already folded into Pi prompt build.

Implication:

- correct hook for this feature = `before_agent_start`
- correct behavior = start from `event.systemPrompt`, append model fragment, return new string
- no need to rebuild system prompt manually
- no need to use prompt templates or `resources_discover` for MVP

### Repo starter status

Current starter scaffold stale against installed Pi API.

`bun run typecheck` currently fails with:

- `Property 'command' does not exist on type 'ExtensionAPI'.`
- `Property 'toast' does not exist on type 'ExtensionUIContext'.`
- command-only notification helpers typed against `ExtensionCommandContext` but used from session events

Implication:

- first implementation step must update scaffold to current Pi API (`registerCommand`, `ctx.ui.notify`, shared `ExtensionContext`-safe notification helpers, etc.) before feature work.

## Product Spec

### User story

As Pi user, I want repo-local prompt files that declare, in YAML frontmatter, which models they apply to so Pi automatically injects extra system instructions for active model without losing Pi defaults, project `SYSTEM.md`, `APPEND_SYSTEM.md`, skills, tools, or other extension changes.

### Non-goals

Not in MVP:

- replacing Pi base system prompt
- provider payload rewriting via `before_provider_request`
- remote prompt fetching
- per-message interactive prompt selection UI
- prompt templates exposed as `/commands`
- cross-repo prompt sharing package workflow beyond current symlink install
- arbitrary glob syntax beyond exact `<provider>/<model-id>`, `*/<model-id>`, and `<provider>/*`

## Proposed UX

### Install

User symlinks repo into Pi extensions dir:

```bash
ln -s /path/to/pi-model-system-prompts ~/.pi/agent/extensions/pi-model-system-prompts
```

Pi discovers `index.ts` in symlinked dir. User runs `/reload`.

### Authoring prompt files

Store prompt fragments in flat repo-local directory:

```text
model-prompts/
  python-editing.md
  claude-family.md
  openai-any.md
  shared-safety.md
```

Each file contains YAML frontmatter followed by markdown body.

Example exact model match:

```md
---
models:
  - anthropic/claude-sonnet-4-5
---

Use concise plans. Prefer anchored edits. Re-read before multi-file refactors.
```

Example provider-wide match:

```md
---
models:
  - anthropic/*
---

Anthropic models in this workflow should prefer explicit progress narration only when task spans multiple files.
```

Example model-id-across-providers match:

```md
---
models:
  - "*/gpt-5"
---

For GPT-5, bias toward direct action over long speculative planning.
```

Example multi-target prompt:

```md
---
models:
  - anthropic/claude-sonnet-4-5
  - openai/gpt-5
  - google/gemini-2.5-pro
---

When editing architecture docs, preserve section order and decision rationale.
```

Rules:

- only `.md` files loaded
- prompt files live directly under `model-prompts/` for MVP
- each file may target one or many model selectors via frontmatter `models`
- markdown body after frontmatter becomes appended prompt content
- files concatenate in lexicographic filename order after filtering to matches
- frontmatter required for matching; file without valid `models` list is skipped with warning

Why flat dir + frontmatter:

- one prompt can target many models
- easier authoring when prompts cut across providers
- avoids exploding filepath hierarchy
- keeps matching logic explicit in file contents

### Runtime behavior

On each user prompt:

1. extension reads active `ctx.model`
2. extension forms active model key as `<provider>/<model-id>`
3. extension scans cached prompt registry
4. extension matches files whose frontmatter selectors apply
5. extension concatenates matched markdown in filename order
6. extension appends single delimited section to `event.systemPrompt`
7. Pi continues with full existing prompt + extra model instructions

If no model or no matching fragments:

- no-op

### Example appended block

Extension should append compact, deterministic wrapper:

```md
## Model-Specific Instructions

Active model: anthropic/claude-sonnet-4-5

[concatenated fragment content]
```

Do not include file path list in prompt by default. Save tokens. Expose file provenance via status command instead.

## Matching Semantics

### Model key

Use exact Pi active model identifier:

- active key = `<provider>/<model-id>`
- source values from `ctx.model.provider` and `ctx.model.id`

Examples:

- `anthropic/claude-sonnet-4-5`
- `openai/gpt-5`
- `google/gemini-2.5-pro`

### Allowed selector syntax

Each selector in frontmatter `models` list may be one of:

- exact model: `<provider>/<model-id>`
- provider wildcard: `<provider>/*`
- model-id wildcard across providers: `*/<model-id>`

Examples:

- `anthropic/claude-sonnet-4-5` = exact only
- `anthropic/*` = every Anthropic model
- `*/gpt-5` = every provider's `gpt-5` model id

Out of scope for MVP:

- `*/*`
- partial wildcards like `claude-*`
- regex/glob matching
- negation rules

### Match evaluation

Prompt file matches active model if any selector in its `models` frontmatter list matches.

Matching rules:

- exact selector matches exact active key
- `<provider>/*` matches same provider, any model id
- `*/<model-id>` matches same model id, any provider

### Precedence and order

Multiple prompt files may match same model. All matches compose.

Ordering rule:

- matched files sort by filename lexicographically
- contents concatenate in that order

Reason:

- deterministic
- simple mental model
- no hidden specificity sorting surprises

Optional future enhancement:

- explicit `priority` field in frontmatter if filename ordering becomes too limiting

## Technical Design

### Hook choice

Use `pi.on("before_agent_start", ...)`.

Reason:

- docs explicitly support system prompt modification here
- happens after Pi builds normal prompt chain
- extension can append safely
- change applies per turn and follows model changes naturally

### File discovery

Resolve extension repo root from module location, not cwd.

Proposed helper:

- `src/extension/paths.ts`
- derive repo root from `import.meta.url`
- base prompt dir = `<repoRoot>/model-prompts`

Reason:

- repo may be symlinked into Pi extension dir
- prompt files live with extension source, not target project cwd

### Frontmatter format

MVP frontmatter schema:

```ts
interface PromptFrontmatter {
  models: string[];
  description?: string;
}
```

Only `models` required for matching. `description` optional for status/debug output.

Need YAML parser strategy.

Preferred options:

- minimal dependency like `gray-matter`
- or tiny custom parser if we want to keep runtime deps near zero

Recommendation:

- use `gray-matter` for correctness and less parser edge-case pain
- list under `dependencies`, not `devDependencies`, since extension runs in Node via Pi

### Prompt registry

Create small registry layer:

```ts
interface PromptFragment {
  path: string;
  description?: string;
  selectors: string[];
  content: string;
}

interface ResolvedPromptSet {
  modelKey: string;
  fragments: PromptFragment[];
  combinedContent: string;
}
```

Responsibilities:

- scan `model-prompts/`
- read `.md` files
- parse YAML frontmatter
- validate selectors
- sort deterministically
- resolve fragments for active model key
- expose provenance for status/debug output

### Selector validation

Need validator for supported selectors.

Valid forms:

- `^[^*/\s]+/[^*/\s]+$` exact
- `^[^*/\s]+/\*$` provider wildcard
- `^\*/[^*/\s]+$` model-id wildcard

Invalid selectors:

- empty strings
- `*/*`
- multiple `*`
- missing `/`
- embedded whitespace

Invalid file behavior:

- skip entire file if `models` missing, empty, or contains only invalid selectors
- record warning for status command and one-time UI notify

### Cache strategy

MVP cache should be simple, safe, low-thrash.

Proposed approach:

- keep in-memory registry with prompt dir fingerprint
- fingerprint = latest `mtimeMs` across loaded `.md` files and prompt dir
- on each `before_agent_start`, call `ensureFresh()`
- if tree changed, rebuild cache

Preferred bias:

- favor correctness and small code over clever watch logic
- no file watcher in MVP
- edits should apply next turn without requiring Pi `/reload` if cheap reload logic feasible

If hot refresh without `/reload` adds too much complexity, acceptable fallback:

- require `/reload` after editing prompt files
- document this clearly

## Commands

Add at least one debug command.

### `/model-system-prompts-status`

Show:

- active model key
- prompt dir base path
- matched fragment files
- selectors for each matched file
- whether cache loaded
- last scan timestamp
- last scan errors/warnings

Reason:

- easy smoke testing
- easy debugging when prompt not applied
- aligns with extension-guide advice: recovery/status commands worth adding early

Optional later:

- `/model-system-prompts-list` to dump all discovered prompt files + selectors
- `/model-system-prompts-reload` to force registry refresh without full Pi `/reload`

## Error Handling

Failure policy:

- never block agent run because prompt fragment missing or unreadable
- on read/parse/frontmatter failure, skip bad file and keep base prompt intact
- surface warning via `ctx.ui.notify(..., "error" | "warning")` once per distinct failure per session
- include latest failure details in status command

Reason:

- extension additive only
- safe failure mode = no extra prompt, not broken Pi session

## Proposed File Layout

```text
index.ts
BLUEPRINT.md
model-prompts/
  *.md
src/
  extension/
    index.ts
    commands.ts
    notifications.ts
    paths.ts
    prompt-registry.ts
    prompt-resolver.ts
    runtime.ts
```

### Module responsibilities

- `src/extension/index.ts`
  - bootstrap extension
  - register commands
  - register `before_agent_start`
  - cleanup on `session_shutdown`

- `src/extension/paths.ts`
  - resolve repo root
  - expose `modelPromptsDir`
  - format active model key as `<provider>/<model-id>`

- `src/extension/prompt-registry.ts`
  - scan flat prompt dir
  - load prompt files
  - parse frontmatter
  - validate selectors
  - maintain cache/fingerprint
  - collect scan errors

- `src/extension/prompt-resolver.ts`
  - resolve applicable fragments for active model key
  - combine content in correct order
  - build appended prompt wrapper

- `src/extension/runtime.ts`
  - hold registry instance
  - hold last applied match info for status command
  - reset on shutdown/reload

- `src/extension/commands.ts`
  - `/model-system-prompts-status`
  - maybe future reload/list commands

- `src/extension/notifications.ts`
  - thin `ctx.ui.notify` helpers typed against generic `ExtensionContext`

## Implementation Plan

### Phase 0: fix scaffold — COMPLETE

1. Replace stale command API usage with current Pi API.
2. Replace `toast` helpers with `ctx.ui.notify` helpers.
3. Make notification helpers accept `ExtensionContext`, not only `ExtensionCommandContext`.
4. Run `bun run typecheck` until clean.
   Status:

- complete
- `registerCommand` now used instead of stale command API
- notifications now use `ctx.ui.notify`
- notification helpers now accept `ExtensionContext`
- `bun run typecheck` passing

Deliverable:

- repo compiles against installed Pi version before feature work starts

### Phase 1: prompt path and model-key helpers — COMPLETE

1. Add repo-root resolution from `import.meta.url`.
2. Add `modelPromptsDir` constant.
3. Add helper to build active model key as `<provider>/<model-id>`.
4. Add selector validation/matching helpers.
5. Document expected frontmatter format in comments and README if needed.
   Status:

- complete
- `src/extension/paths.ts` added
- `repoRoot`, `modelPromptsDir`, `toModelKey()`, `isValidModelSelector()`, and `matchesModelSelector()` implemented

Deliverable:

- deterministic model key + selector matching primitives

### Phase 2: prompt registry — COMPLETE

1. Implement scan for `.md` files directly under `model-prompts/`.
2. Parse frontmatter and markdown body.
3. Validate `models` selectors.
4. Read contents and sort files lexicographically by filename.
5. Record scan metadata and non-fatal errors.
6. Add cache invalidation strategy.
   Status:

- complete
- `gray-matter` added as runtime dependency
- `src/extension/prompt-registry.ts` implemented
- registry scans `model-prompts/*.md`, parses frontmatter, validates selectors, records warnings, caches by fingerprint, and resolves matching fragments by model key
- `/model-system-prompts-status` now surfaces registry state, matches, and warnings

Deliverable:

- `getResolvedPromptSet(modelKey)` returns ordered fragments + combined content

### Phase 3: prompt injection hook

1. Register `before_agent_start` handler.
2. If `ctx.model` missing, no-op.
3. Build active model key.
4. Resolve prompt set for current model.
5. If combined content empty, no-op.
6. Append wrapped section to `event.systemPrompt`.
7. Persist last applied result in runtime state for command/debug use.

Deliverable:

- active model gets additive prompt text each turn

### Phase 4: debug/status command

1. Implement `/model-system-prompts-status`.
2. Show active model, matched files, selectors, last applied summary, prompt dir path, errors.
3. Ensure command works even before first prompt.

Deliverable:

- user can verify extension behavior without guessing

### Phase 5: docs and smoke test checklist

1. Update `README.md` with install steps via symlink.
2. Add frontmatter authoring examples.
3. Add selector syntax reference.
4. Add smoke-test checklist.
5. Add failure/reload notes.

Deliverable:

- extension usable by future agent/user without reverse engineering

## Smoke Test Plan

### Baseline

1. `bun run typecheck`
2. Symlink repo into `~/.pi/agent/extensions/pi-model-system-prompts`
3. Start Pi or run `/reload`
4. Run `/model-system-prompts-status`

### Matching tests

1. Add `model-prompts/10-anthropic.md`:

```md
---
models:
  - anthropic/*
---

Anthropic provider-wide instructions.
```

2. Add `model-prompts/20-gpt5.md`:

```md
---
models:
  - "*/gpt-5"
---

Applies to any provider's gpt-5 model id.
```

3. Add `model-prompts/30-specific.md`:

```md
---
models:
  - anthropic/claude-sonnet-4-5
---

Exact-model instructions.
```

4. Select `anthropic/claude-sonnet-4-5`
5. Send prompt
6. Confirm status command shows matching exact file + provider-wide file, but not `*/gpt-5`

Then:

1. Select `openai/gpt-5`
2. Send prompt again
3. Confirm status shows `20-gpt5.md` and not Anthropic-only files

### Negative tests

1. Add file with invalid frontmatter selector like `anthropic/claude-*`
2. Confirm file skipped with warning
3. Select model with no matching prompt files
4. Confirm no errors and no prompt match
5. Add malformed YAML
6. Confirm extension warns but agent still runs

### Reload/edit tests

1. Edit fragment content
2. Verify next-turn behavior
3. If hot refresh not implemented, verify `/reload` picks up changes

## Design Decisions

### Why additive prompt append, not replacement

User asked for model-specific prompt alongside existing system prompts. Pi already composes default prompt, `.pi/SYSTEM.md`, append prompts, context files, skills, and tool guidance. Extension should preserve all of that.

### Why flat files + frontmatter

Benefits:

- one file can target many models
- cross-provider matching easy
- explicit matching near prompt text
- easier repo maintenance than nested path trees
- future metadata fields fit naturally in frontmatter

Tradeoff:

- requires YAML parser/validation
- matching rules move from filesystem into file metadata

### Why limited wildcard syntax

User need clear:

- exact `<provider>/<model-id>`
- provider family `<provider>/*`
- cross-provider model-id `*/<model-id>`

Keeping syntax narrow avoids ambiguous matching behavior and cuts implementation risk.

### Why no `resources_discover`

`resources_discover` adds prompts/templates/themes/skills to Pi resource loader. This feature is not prompt-template discovery. It is direct system-prompt augmentation keyed to active model. `before_agent_start` is more direct and lower risk.

## Open Questions / Uncertainties

Need user clarification on these before final implementation or during review:

1. **Frontmatter parser dependency**
   - OK to add `gray-matter` runtime dependency?
   - or prefer tiny custom parser to keep deps minimal?

2. **Selector case sensitivity**
   - should matching be exact case-sensitive string compare?
   - or normalize provider/model ids to lowercase before compare?

3. **File ordering**
   - lexicographic filename order good enough?
   - or want explicit `priority` in frontmatter now?

4. **Hot reload expectation**
   - should edits to `model-prompts/` apply next prompt automatically?
   - or is built-in Pi `/reload` acceptable after prompt edits?

5. **Visibility in prompt**
   - should appended wrapper mention active model only?
   - or also include source file paths for transparency?

6. **Future scope**
   - only prompts bundled in this extension repo?
   - or later also allow consuming project to define overlays in `.pi/model-prompts/`?

## Recommended MVP Decision Set

If no further clarification, default to:

- exact string model keys in format `<provider>/<model-id>`
- selector support only for exact, `<provider>/*`, and `*/<model-id>`
- flat `model-prompts/*.md` layout
- YAML frontmatter with required `models: string[]`
- additive append in `before_agent_start`
- single status command
- lightweight cache with auto refresh if easy, else require `/reload`
- file paths shown in status command, not in prompt text

## Success Criteria

Extension done when:

- `bun run typecheck` passes
- Pi loads extension from symlinked repo
- active model gets matching prompt fragments appended to existing system prompt
- exact, provider-wide, and model-id-wide selectors all work
- invalid prompt files degrade safely
- status command explains what matched and why
