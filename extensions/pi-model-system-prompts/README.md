# pi-model-system-prompts

Pi extension that appends model-specific system prompt fragments to Pi's existing system prompt chain.

It does not replace Pi defaults. It reads repo-local markdown files from `model-prompts/`, matches them against the active model, concatenates the matches in filename order, and appends one deterministic section during `before_agent_start`.

## Install

Symlink the repo into your Pi extensions directory:

```bash
ln -s /path/to/pi-model-system-prompts ~/.pi/agent/extensions/pi-model-system-prompts
```

Then reload Pi resources:

```text
/reload
```

## Usage

Store prompt fragments as markdown files directly under `model-prompts/`.

Example exact match:

```md
---
models:
  - anthropic/claude-sonnet-4-5
---

Use concise plans. Prefer anchored edits. Re-read before multi-file refactors.
```

Example provider wildcard:

```md
---
models:
  - anthropic/*
---

Prefer explicit progress narration only when a task spans multiple files.
```

Example model-id wildcard across providers:

```md
---
models:
  - "*/gpt-5"
---

Bias toward direct action over long speculative planning.
```

## Selector Syntax

Supported selectors:

- exact model: `<provider>/<model-id>`
- provider wildcard: `<provider>/*`
- model-id wildcard: `*/<model-id>`

Not supported in this MVP:

- `*/*`
- partial wildcards like `claude-*`
- regex or glob patterns

## Commands

- `/model-system-prompts-status`: show registry status, active model, matches, warnings, and the last injection result
- `/model-system-prompts-reset`: clear in-memory runtime state and rescan on the next use

## Runtime Behavior

On each prompt:

1. Pi builds its normal system prompt stack.
2. The extension reads the current active model from `ctx.model`.
3. Matching prompt fragments are resolved from `model-prompts/*.md`.
4. Matches are concatenated in lexicographic filename order.
5. The extension appends this block to the existing prompt:

```md
## Model-Specific Instructions

Active model: <provider>/<model-id>

<concatenated fragment content>
```

If there is no active model or no matching fragments, the extension is a no-op.

## Validation Rules

- only `.md` files are scanned
- `models` frontmatter is required and must be a string list
- files with no valid selectors are skipped
- files with empty prompt bodies are skipped
- invalid files never block Pi; they only produce warnings

Warnings are surfaced in `/model-system-prompts-status` and notified once per session.

## Development

```bash
bun run typecheck
```

## Smoke Test

1. Run `bun run typecheck`.
2. Symlink the extension into `~/.pi/agent/extensions/`.
3. Run `/reload` in Pi.
4. Run `/model-system-prompts-status`.
5. Select a model that matches one of the example files in `model-prompts/`.
6. Send a prompt.
7. Run `/model-system-prompts-status` again and confirm `lastAppliedOutcome: applied`.
