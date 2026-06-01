# ferns-universal-coding-companion

`fucc` — personal monorepo of Pi coding agent extensions, skills, themes, prompts, and the bootstrap scaffolding that ties them together.

One repo. One root install. One `manifest.json` declaring everything Pi should pick up.

## Layout

```text
ferns-universal-coding-companion/
├── extensions/             # @fucc/* Pi extensions (one workspace per dir)
│   ├── cmux-diff/
│   ├── pi-context/
│   ├── pi-model-system-prompts/
│   └── pi-usage/
├── skills/                 # Pi skills
├── themes/                 # Pi color themes (loose .json files)
├── templates/
│   └── extension/          # Scaffold for new extensions
├── docs/                   # Cross-cutting docs (authoring guide, trackers)
├── scripts/
│   ├── install.ts          # manifest → symlinks + `pi install`
│   └── new-extension.ts    # Scaffold from templates/extension/
├── manifest.json           # What install.ts links + installs
├── settings.json           # Pi settings (linked to ~/.pi/agent/settings.json)
├── tsconfig.base.json      # Root tsconfig every workspace extends
├── package.json            # Workspaces + catalog + dev tooling
├── .oxlintrc.json          # oxlint config (defaults)
├── .oxfmtrc.json           # oxfmt config (defaults)
└── install.sh              # Thin shim → bun scripts/install.ts (forwards argv)
```

## Architecture

### Bun workspaces with a shared catalog

The root `package.json` declares workspaces and pins shared dep versions in a single catalog:

```json
{
  "workspaces": {
    "packages": ["extensions/*", "skills/*", "templates/*"],
    "catalog": {
      "@earendil-works/pi-coding-agent": "^0.67.2",
      "@earendil-works/pi-ai": "^0.70.2",
      "@earendil-works/pi-tui": "^0.70.2",
      "@types/bun": "latest",
      "typescript": "^5.9.3"
    }
  }
}
```

Each workspace references catalog versions with the `"catalog:"` protocol, so Pi-API upgrades happen in exactly one place:

```json
"devDependencies": {
  "@earendil-works/pi-coding-agent": "catalog:",
  "@types/bun": "catalog:",
  "typescript": "catalog:"
}
```

Every workspace extends `tsconfig.base.json` and only declares the overrides it actually needs. `node_modules` is hoisted to the repo root.

### `manifest.json` drives install

`manifest.json` is the single source of truth for what gets wired into Pi:

```json
{
  "settings": "settings.json",
  "themes": ["themes/*.json"],
  "extensions": ["extensions/*"],
  "skills": ["skills/*"],
  "packages": ["npm:pi-mcp-adapter", "git:github.com/jonjonrankin/pi-caveman"]
}
```

`scripts/install.ts` reads it and:

1. Symlinks `settings.json` into `~/.pi/agent/settings.json`.
2. Expands each glob in `extensions` / `skills` / `themes` and creates one symlink per match under `~/.pi/agent/<key>/` (skips work when an existing symlink already resolves to the same path).
3. Runs `pi install <pkg>` for each `packages[]` entry **unless** that entry already appears in `pi list` output (full manifest string, or the `npm:` / `git:` payload).

Symlink targets under `~/.pi/agent/{extensions,skills,themes}` and `settings.json` (when set in the manifest) are **owned by this installer**: by default it refuses to delete or replace a non-symlink path or a symlink pointing elsewhere; pass `--force` to recover the previous overwrite behavior. It remains `lstat`-aware so it never recurses through an existing dir-symlink when removing a stale symlink. Pi discovers extensions by reading `~/.pi/agent/extensions/<name>/index.ts` — symlinked back into this repo.

Flags (also accepted by `./install.sh`, which forwards argv):

- `--skip-packages` — only create symlinks; do not run `pi install` (does not require `pi` on `PATH`).
- `--force` — allow replacing blocking files, directories, or mismatched symlinks at install destinations.

### Extension shape

Every extension is a workspace package with the same minimal skeleton:

```text
extensions/<name>/
├── package.json            # @fucc/<name>, catalog: deps
├── tsconfig.json           # extends ../../tsconfig.base.json
├── index.ts                # re-exports default from src/extension/index
├── src/extension/index.ts  # registers commands + Pi event handlers
└── SPEC.md                 # behavior-only spec (no implementation detail)
```

The `templates/extension/` workspace is a working copy of this skeleton; `bun run new-extension <name>` clones it into place.

### Lint + format

`oxlint` and `oxfmt` run at the repo root with their defaults. `bun run check` is the canonical pre-commit gate (typecheck + lint + format check).

## Observability

All coding agents — Pi, Codex, OpenCode, and Claude Code — send traces to a single Langfuse project so runs can be compared across harnesses, models, and repos.

### Shared trace schema

Every trace carries the same base metadata regardless of harness:

| Field | Description |
| --- | --- |
| `harness` | `"pi"` \| `"codex"` \| `"opencode"` \| `"claude-code"` |
| `sessionId` | Harness-native session identifier |
| `cwd` | Working directory at run start |
| `repo` | Git repo name (extracted from remote URL) |
| `repoRemote` | Full git remote URL |
| `gitBranch` | Branch at run start |
| `gitCommit` | Short HEAD SHA at run start |
| `model` | LLM model identifier |

Tags follow the format `harness:{name}`, `model:{name}`, `repo:{name}` so you can filter and compare across all four harnesses in the Langfuse trace list view.

Every harness also emits these evaluation scores (where the harness supports hook-level events):

| Score | Type | Description |
| --- | --- | --- |
| `tool_call_count` | Numeric | Total tool calls in the run |
| `turn_count` | Numeric | Agentic turns |
| `tool_success_rate` | Numeric | (calls − errors) / calls |
| `session_had_errors` | Boolean | Whether any tool returned an error |

### Plugins

| Harness | Plugin | Architecture |
| --- | --- | --- |
| Pi | [`extensions/pi-langfuse/`](extensions/pi-langfuse/README.md) | Pi SDK extension, event-driven, richest hierarchy |
| Codex | [`plugins/codex-langfuse/`](plugins/codex-langfuse/README.md) | Hook script (Node.js), git context stored at SessionStart |
| OpenCode | [`plugins/opencode-langfuse/`](plugins/opencode-langfuse/README.md) | OTEL passthrough via `HarnessAttributesProcessor` |
| Claude Code | [`plugins/claude-code-langfuse/`](plugins/claude-code-langfuse/README.md) | Python hook, reads transcript JSONL on Stop |

### Quick setup

Set these env vars (or equivalent config per harness) and point each plugin at the same Langfuse project:

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"   # or your self-hosted URL
```

See each plugin's README for harness-specific installation steps.

## Extensions

- [`cmux-diff`](extensions/cmux-diff/SPEC.md) — interactive git-diff review inside cmux that submits comments back to the active Pi session
- [`pi-context`](extensions/pi-context/SPEC.md) — Pi-native Context Lens dashboard (sidecar + LHAR), unified across Pi terminals
- [`pi-usage`](extensions/pi-usage/SPEC.md) — provider quota / balance footer + `/usage` overlay across Codex, Claude, Gemini, Synthetic, Zen
- [`pi-model-system-prompts`](extensions/pi-model-system-prompts/SPEC.md) — appends model-specific system prompt fragments to Pi's existing prompt chain

## Install

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (`pi`) on `PATH`, unless you run `./install.sh --skip-packages` (symlinks only)

### Steps

```bash
git clone <repo> ferns-universal-coder
cd ferns-universal-coder
bun install
./install.sh
```

Then in Pi:

```text
/reload
```

`./install.sh` is a thin bash shim that exec's `bun scripts/install.ts` and forwards flags (for example `./install.sh --force` or `./install.sh --skip-packages`) — running the TS installer directly works too.

### What install does

- Symlinks `settings.json` → `~/.pi/agent/settings.json`
- Symlinks each extension dir → `~/.pi/agent/extensions/<name>/`
- Symlinks each theme `.json` → `~/.pi/agent/themes/<name>.json` (or symlinks a single themes tree when `themes` is a string path in the manifest)
- Symlinks each skill dir → `~/.pi/agent/skills/<name>/`
- Runs `pi install <pkg>` for each `packages[]` entry that is **not** already mentioned in `pi list` (skipped entirely with `--skip-packages`)

Re-run any time `manifest.json` changes. Repeat runs are safe: correct symlinks are left as-is, and third-party installs are skipped when `pi list` already shows the package. Use `--force` when you intentionally need to replace paths this script manages.

## Development

```bash
bun run typecheck    # tsc --noEmit across all workspaces
bun run lint         # oxlint (defaults)
bun run format       # oxfmt --write
bun run format:check # oxfmt --check
bun run check        # typecheck + lint + format:check
```

Per-workspace scripts run with `bun run --cwd extensions/<name> <script>` or directly inside the workspace dir.

## Scaffolding a new extension

```bash
bun run new-extension my-thing
bun install            # picks up the new workspace
./install.sh           # symlinks it into ~/.pi/agent/extensions/
```

Then `/reload` in Pi. The script copies `templates/extension/` to `extensions/my-thing/` and rewrites the `example-extension` placeholders. Because `manifest.json` already globs `extensions/*`, no manifest edit is needed.

## Authoring docs

- [`docs/pi-extension-guide.md`](docs/pi-extension-guide.md) — what actually mattered when building Pi extensions in this repo
- [`docs/tracker.md`](docs/tracker.md) — third-party extensions / skills the user has shopped or shipped
