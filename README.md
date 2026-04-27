# pi-extensions

Personal monorepo of Pi coding agent extensions, skills, themes, and prompts. One repo, one root install, one `manifest.json` declaring everything Pi should pick up.

## Layout

```text
extensions/   Pi extensions, one per directory
skills/       Pi skills
themes/       Pi color themes
docs/         Cross-cutting docs (extension authoring guide, trackers, etc.)
manifest.json Settings + globs Pi reads to find this repo's contents
install.sh    Symlinks repo contents into ~/.pi/agent/
```

Each extension is a workspace package under `extensions/<name>/` with its own `SPEC.md`, `index.ts`, and `package.json`. Shared dependency versions are pinned in the root `package.json` `workspaces.catalog` and referenced as `"catalog:"` from the workspaces.

## Extensions

- [`cmux-diff`](extensions/cmux-diff/SPEC.md) — interactive git-diff review inside cmux that submits comments back to the active Pi session
- [`pi-context`](extensions/pi-context/SPEC.md) — Pi-native Context Lens dashboard (sidecar + LHAR), unified across Pi terminals
- [`pi-usage`](extensions/pi-usage/SPEC.md) — provider quota / balance footer + `/usage` overlay across Codex, Claude, Gemini, Synthetic, Zen
- [`pi-model-system-prompts`](extensions/pi-model-system-prompts/SPEC.md) — appends model-specific system prompt fragments to Pi's existing prompt chain

## Authoring docs

- [`docs/pi-extension-guide.md`](docs/pi-extension-guide.md) — what actually mattered when building Pi extensions in this repo
- [`docs/tracker.md`](docs/tracker.md) — third-party extensions / skills tracking
- [`docs/named-sessions-spec.md`](docs/named-sessions-spec.md) — Pi-session-ID + session-name unification spec

## Install

```bash
bun install
./install.sh
```

`install.sh` reads `manifest.json` and symlinks every extension, skill, theme, and the `settings.json` file into `~/.pi/agent/`. Run `/reload` in Pi afterward.

## Development

```bash
bun run typecheck    # tsc --noEmit across all workspaces
bun run lint         # oxlint (defaults)
bun run format       # oxfmt --write
bun run check        # typecheck + lint + format:check
```
