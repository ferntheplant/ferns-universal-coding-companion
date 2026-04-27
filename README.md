# ferns-universal-coder

`fuc` — personal monorepo of Pi coding agent extensions, skills, themes, prompts, and the bootstrap scaffolding that ties them together.

One repo. One root install. One `manifest.json` declaring everything Pi should pick up.

## Layout

```text
ferns-universal-coder/
├── extensions/             # @fuc/* Pi extensions (one workspace per dir)
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
└── install.sh              # Thin shim → bun scripts/install.ts
```

## Architecture

### Bun workspaces with a shared catalog

The root `package.json` declares workspaces and pins shared dep versions in a single catalog:

```json
{
  "workspaces": {
    "packages": ["extensions/*", "skills/*", "templates/*"],
    "catalog": {
      "@mariozechner/pi-coding-agent": "^0.67.2",
      "@mariozechner/pi-ai": "^0.70.2",
      "@mariozechner/pi-tui": "^0.70.2",
      "@types/bun": "latest",
      "typescript": "^5.9.3"
    }
  }
}
```

Each workspace references catalog versions with the `"catalog:"` protocol, so Pi-API upgrades happen in exactly one place:

```json
"devDependencies": {
  "@mariozechner/pi-coding-agent": "catalog:",
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
2. Expands each glob in `extensions` / `skills` / `themes` and creates one symlink per match under `~/.pi/agent/<key>/`.
3. Runs `pi install <pkg>` for every third-party `packages` entry.

The installer is idempotent and `lstat`-aware, so re-running never recurses through an existing dir-symlink. Pi discovers extensions by reading `~/.pi/agent/extensions/<name>/index.ts` — symlinked back into this repo.

### Extension shape

Every extension is a workspace package with the same minimal skeleton:

```text
extensions/<name>/
├── package.json            # @fuc/<name>, catalog: deps
├── tsconfig.json           # extends ../../tsconfig.base.json
├── index.ts                # re-exports default from src/extension/index
├── src/extension/index.ts  # registers commands + Pi event handlers
└── SPEC.md                 # behavior-only spec (no implementation detail)
```

The `templates/extension/` workspace is a working copy of this skeleton; `bun run new-extension <name>` clones it into place.

### Lint + format

`oxlint` and `oxfmt` run at the repo root with their defaults. `bun run check` is the canonical pre-commit gate (typecheck + lint + format check).

## Extensions

- [`cmux-diff`](extensions/cmux-diff/SPEC.md) — interactive git-diff review inside cmux that submits comments back to the active Pi session
- [`pi-context`](extensions/pi-context/SPEC.md) — Pi-native Context Lens dashboard (sidecar + LHAR), unified across Pi terminals
- [`pi-usage`](extensions/pi-usage/SPEC.md) — provider quota / balance footer + `/usage` overlay across Codex, Claude, Gemini, Synthetic, Zen
- [`pi-model-system-prompts`](extensions/pi-model-system-prompts/SPEC.md) — appends model-specific system prompt fragments to Pi's existing prompt chain

## Install

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Pi coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) (`pi`) on `PATH`

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

`./install.sh` is a 5-line bash shim that exec's `bun scripts/install.ts` — running the TS installer directly works too.

### What install does

- Symlinks `settings.json` → `~/.pi/agent/settings.json`
- Symlinks each extension dir → `~/.pi/agent/extensions/<name>/`
- Symlinks each theme `.json` → `~/.pi/agent/themes/<name>.json`
- Symlinks each skill dir → `~/.pi/agent/skills/<name>/`
- Runs `pi install <pkg>` for each `packages[]` entry

Re-run any time `manifest.json` changes; the installer is idempotent.

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
- [`docs/named-sessions-spec.md`](docs/named-sessions-spec.md) — Pi-session-ID + session-name unification spec
