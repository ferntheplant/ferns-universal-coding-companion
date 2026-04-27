# MONOREPO_MIGRATION.md

Migration plan for converting `pi-extensions` into a coherent personal monorepo (`ferns-universal-coder` / `fuc`).

This is a planning document. No code changes yet. Open questions are called out at the bottom — resolve those first, then sequence the migration steps.

---

## Goals (restated)

1. Fold the `pi-extension-starter` template into this repo as a first-class scaffold.
2. Centralize "how to write a Pi extension" docs at the repo root.
3. Hoist JS dependencies to a single root install instead of one `node_modules` per extension.
4. Make the folder taxonomy obvious (extensions vs skills vs prompts vs themes) — possibly via the manifest and installer.
5. Rename the project to `ferns-universal-coder` / `fuc`.
6. Apply a single formatter (oxfmt) + linter (oxlint) and shared dev deps across all packages.

---

## Current state (inventory)

**Code-bearing extensions** (`bun` packages, each with own `node_modules` + `bun.lock`):

| Folder | Notable shape | Notable deps |
|---|---|---|
| `cmux-diff/` | React 19 viewer + Node http server + Bun bundling | `react`, `git-diff-view`, `jotai`, `react-arborist` |
| `pi-context/` | Hono sidecar + collector + scripts | `hono`, `valibot`, `js-tiktoken`, `@contextio/core` |
| `pi-usage/` | small status reporter | (only peer/dev deps) |
| `pi-model-system-prompts/` | markdown selector + loader | `gray-matter` |

**Non-code first-class data**:
- `slide-presentation/` — a skill (`SKILL.md` + `templates/`), no JS.
- `themes/rose-pine.json`, `themes/rose-pine-dawn.json` — plain JSON.
- `pi-model-system-prompts/model-prompts/*.md` — markdown prompt fragments consumed by the extension that wraps them.

**Glue at the root**:
- `manifest.json` — declares settings, themes, extensions, skills, npm/git packages.
- `install.sh` — bash + `python3` JSON parsing; symlinks entries into `~/.pi/agent/` and runs `pi install` for external packages.
- `settings.json` — Pi runtime settings.
- `TRACKER.md`, `named-sessions-spec.md` — scratch planning docs.

**Important sub-observations**:
- The same `docs/pi-extension-guide.md` is byte-identical in `pi-context`, `pi-usage`, and `pi-model-system-prompts` (it was forked into each from the starter).
- All extensions use the same `tsconfig`-shape and the same `peerDependencies` block (`@mariozechner/pi-coding-agent`, `typescript`). `cmux-diff` adds DOM/JSX/`@sinclair/typebox`.
- Runtime code already uses `node:` imports throughout — no Bun-only runtime APIs in extension code paths. Bun is only the package manager + dev runner.
- `install.sh` shells out to `python3` purely to read JSON. We can drop both bash and python by rewriting in Bun TS.
- Untracked file `pi-model-system-prompts/model-prompts/00-global.md` exists in the working tree. Decide whether to commit before migrating (orthogonal, but note it).

---

## Tooling decisions

### Package manager: **stay on bun**

- Already in use, with `bun.lock` in every extension and `bun run` scripts everywhere.
- Bun 1.3 has stable `workspaces` (with glob), `workspace:*` deps, and a `catalog` field for shared dep version pinning — covers everything we need for a 4-package private repo.
- Switching to pnpm would buy stricter symlink isolation and a slightly more mature workspaces story, but for an unpublished personal monorepo that benefit is small and the churn (replacing every lockfile + reteaching install scripts) is real.
- `pnpm` is also installed locally (8.6.3) so we keep the option open, but there's no reason to take it. **Recommendation: bun workspaces + bun catalog. Single root `bun.lock`.**

Caveat: **Pi loads extensions via symlinks into `~/.pi/agent/extensions/<name>/`**. Hoisted node_modules only works if Pi's Node process resolves modules through the symlink's *real* path (the default). If Pi runs with `--preserve-symlinks` we'd need per-package `node_modules`. See open question Q1 — verify before flipping the switch.

### Task running: **none, just bun scripts**

Four packages doesn't justify Turborepo/Nx. Use bun's built-in filter:
- `bun install` (root) — installs everything.
- `bun run --filter '*' typecheck` — typecheck all.
- `bun run --filter '*' test` — test all.
- `bun --filter './extensions/cmux-diff' run dev` — single package.

If we ever hit cache/perf issues we can layer Turbo on top without re-architecting.

### Lint + format: **oxlint + oxfmt at the root, defaults only**

- Single `oxlint.json` and oxfmt config at the repo root applies to all packages.
- Add to root `package.json` scripts: `lint`, `format`, `check` (lint + format-check + typecheck).
- **Risk**: oxfmt is newer and less battle-tested than Prettier/Biome. If it stumbles on TSX or `react-jsx` files in `cmux-diff`, we should be willing to fall back to Biome (also Rust, also fast, more mature formatter) without treating it as a setback. (Open question Q2.)

### TypeScript: **one base, per-package overrides**

- Root `tsconfig.base.json` with the shared bun-bundler block.
- Each extension's `tsconfig.json` extends the base and only overrides what's truly local (e.g., `cmux-diff` adds `lib: ["DOM"]` and `jsx: "react-jsx"`).
- Optional: `tsconfig.references.json` at root using project references for fast `tsc -b`. Not required at our scale.

### Dependency sharing: **bun catalog**

Root `package.json`:
```json
{
  "workspaces": {
    "packages": ["extensions/*", "skills/*", "templates/*"],
    "catalog": {
      "@mariozechner/pi-coding-agent": "^0.67.2",
      "typescript": "^5.9.3",
      "@types/bun": "latest"
    }
  }
}
```
Per-package: `"@mariozechner/pi-coding-agent": "catalog:"`. Anything truly local (e.g., `react`, `hono`) stays in that package's `dependencies`.

---

## Target layout

```
ferns-universal-coder/                # (or fuc/)
├── README.md                         # repo overview + table of contents
├── MONOREPO_MIGRATION.md             # this file (delete after migration)
├── package.json                      # workspace root, catalog, scripts
├── bun.lock                          # single lockfile
├── tsconfig.base.json
├── oxlint.json
├── oxfmt.toml                        # (or biome.json if we fall back)
├── .gitignore
├── pi.json                           # renamed manifest.json
├── settings.json                     # Pi runtime settings (linked into ~/.pi/agent)
│
├── docs/                             # CENTRALIZED Pi extension knowledge
│   ├── pi-extension-guide.md         # the dedup'd guide (was copied 3x)
│   ├── architecture-notes.md         # (move cmux-diff/docs/architecture.md or similar)
│   ├── named-sessions-spec.md        # moved from root
│   └── tracker.md                    # moved from root TRACKER.md
│
├── extensions/                       # JS/TS Pi extensions (workspace pkgs)
│   ├── cmux-diff/
│   ├── pi-context/
│   ├── pi-usage/
│   └── pi-model-system-prompts/
│
├── skills/                           # Pi skills (markdown + assets, may be workspace pkgs if they grow JS)
│   └── slide-presentation/
│
├── prompts/                          # OPEN QUESTION (Q3): top-level prompts vs in-extension
│   └── (TBD — see Q3)
│
├── themes/                           # plain JSON themes
│   ├── rose-pine.json
│   └── rose-pine-dawn.json
│
├── templates/                        # scaffolds (was external pi-extension-starter)
│   └── extension/                    # copied target for `bun scripts/new-extension.ts`
│
└── scripts/                          # bun-run TS replacements for install.sh, etc.
    ├── install.ts                    # symlinks pi.json entries into ~/.pi/agent
    ├── new-extension.ts              # scaffolds extensions/<name> from templates/extension
    └── doctor.ts                     # optional: sanity-check that links + deps are healthy
```

The folder *taxonomy* is what disambiguates "extension vs skill vs prompt vs theme" — far clearer than a flat layout with a manifest as the only signal. The manifest can then shrink to listing what to install + external packages.

---

## Manifest changes (`manifest.json` → `pi.json`)

Today it's a flat list. Proposal: keep the schema mostly the same but lean on conventions so most fields can be globs.

```json
{
  "settings": "settings.json",
  "themes": ["themes/*.json"],
  "extensions": ["extensions/*"],
  "skills": ["skills/*"],
  "packages": [
    "npm:pi-mcp-adapter",
    "npm:pi-terminal-signals",
    "npm:pi-answer",
    "npm:pi-hashline-readmap",
    "npm:@sherif-fanous/pi-rtk",
    "npm:pi-cursor-provider",
    "npm:@tmustier/pi-raw-paste",
    "git:github.com/jonjonrankin/pi-caveman"
  ]
}
```

`scripts/install.ts` then does what `install.sh` does today, but in TS:
1. Read `pi.json`.
2. For each glob, resolve to absolute paths and symlink into the right `~/.pi/agent/<bucket>/` directory.
3. For each `packages` entry, shell out to `pi install <spec>`.

Drops the `python3` dependency. Easier to extend (e.g., add `subagents`, `hooks`, `mcp_servers` buckets if Pi grows them).

**Optional simplification**: drop `extensions`/`skills`/`themes` from the manifest entirely and let `install.ts` glob them by folder convention (`extensions/*`, etc.). Manifest becomes only `settings` + `packages`. This is cleaner but requires opting *out* of installing a folder be done by deleting/moving it. (Open question Q4.)

---

## Migration steps

Sequence matters. Each step should leave the repo in a working state — i.e., `bun install && bun run --filter '*' typecheck` passes, and the existing extensions still load in Pi after re-running install.

### Phase 0: Prep (no structural changes)

1. Resolve open questions Q1–Q5 below.
2. Decide on the rename: directory `pi-extensions` → `ferns-universal-coder`. Decide whether package names get an `@fuc/` scope (private packages don't strictly need scopes; useful only if we ever want internal `@fuc/foo` deps).
3. Commit or stash the untracked `pi-model-system-prompts/model-prompts/00-global.md`.
4. Snapshot `~/.pi/agent/` so we can compare before/after.

### Phase 1: Workspace skeleton

1. Add root `package.json` with `"private": true`, `"workspaces"`, and an empty `"catalog"`.
2. Add root `tsconfig.base.json` derived from the current per-extension shape.
3. Add root `.gitignore` for `node_modules/`, `dist/`, `.DS_Store`. Keep the existing extra entries (`references/`, `auth.json`).
4. Move `cmux-diff/`, `pi-context/`, `pi-usage/`, `pi-model-system-prompts/` into `extensions/`.
5. Move `slide-presentation/` into `skills/`.
6. Leave `themes/` and `templates/` location for next phase.
7. Delete each per-package `bun.lock` and `node_modules/`.
8. Run `bun install` from the root. Confirm `bun run --filter '*' typecheck` passes.

### Phase 2: Catalog + tsconfig consolidation

1. Replace per-package `@mariozechner/pi-coding-agent`, `typescript`, `@types/bun` with `catalog:` references.
2. Each extension's `tsconfig.json` becomes:
   ```json
   { "extends": "../../tsconfig.base.json", "compilerOptions": { /* only local overrides */ } }
   ```
3. Re-run `bun install` and typecheck.

### Phase 3: Lint + format

1. Install `oxlint` and `oxfmt` as root dev deps.
2. Add `oxlint.json` (defaults) and oxfmt config.
3. Add root scripts: `lint`, `format`, `format:check`, `check` (= typecheck + lint + format:check).
4. Run `bun run format` once across the repo (single sweeping reformat commit).
5. Run `bun run check`. Fix or `// oxlint-disable` anything contentious.
6. If oxfmt struggles on TSX (cmux-diff), fall back to Biome — entirely a root-level swap, no per-package change.

### Phase 4: Centralize docs

1. Delete `extensions/pi-context/docs/pi-extension-guide.md`, same in `pi-usage` and `pi-model-system-prompts`.
2. Move one canonical copy to `docs/pi-extension-guide.md`.
3. Move `cmux-diff/docs/architecture.md` to `docs/cmux-diff-architecture.md` (or keep in-package since it's tightly coupled to that extension — your call).
4. Move root-level `TRACKER.md`, `named-sessions-spec.md` into `docs/`.
5. Update README.md at the repo root with a hub layout: what each folder is, where to go for what, link to `docs/pi-extension-guide.md` as the canonical reference.

### Phase 5: Inline the starter template

1. Create `templates/extension/` with the same files the GitHub starter provides today (`package.json`, `tsconfig.json`, `index.ts`, `src/extension/{index,commands,runtime,notifications}.ts`).
2. Replace its `package.json` with one that uses `catalog:` for shared deps so scaffolded extensions immediately fit the workspace.
3. Add `scripts/new-extension.ts`:
   - Takes a name argument (e.g. `bun run new-extension my-thing`).
   - Copies `templates/extension/` into `extensions/<name>/`.
   - Replaces placeholder names in `package.json`, `commands.ts`.
   - Does **not** init a git repo (resolves the open TODO in `TRACKER.md`).
4. Once mirrored locally, archive the standalone `ferntheplant/pi-extension-starter` GitHub repo (or leave it as a thin stub pointing to this monorepo).

### Phase 6: Replace `install.sh` with `scripts/install.ts`

1. Rewrite `install.sh` logic in Bun TS, reading `pi.json`.
2. Keep `install.sh` for one cycle as a shim that just calls `bun run scripts/install.ts`, so muscle-memory keeps working.
3. Verify by reinstalling into a clean `~/.pi/agent/` snapshot and diffing against the pre-migration snapshot.

### Phase 7: Rename

1. Rename the directory: `mv pi-extensions ferns-universal-coder` (or `fuc`).
2. Update root `package.json` `name` field, README, any internal absolute-path references (none expected — `install.sh` is `SCRIPT_DIR`-relative, which is good).
3. Update any external references (your shell aliases, the GitHub remote name, `~/.pi/agent` snapshots).

### Phase 8: Cleanup

1. Delete `MONOREPO_MIGRATION.md`.
2. Delete `install.sh` shim if you're confident the TS version is sticky.
3. `git log --stat` review to make sure nothing important was orphaned.

---

## Open questions

### Q1. Does Pi resolve modules through symlinks via realpath, or with `--preserve-symlinks`?

This is the load-bearing question for hoisting `node_modules`. Quick test:
- After Phase 1, load any extension into `~/.pi/agent/extensions/` and confirm `require`/`import` resolves deps from the monorepo root.
- If it fails, fall back to bun workspaces *without* hoisting (`"nohoist"` per-package, or pnpm's symlinked-node_modules layout) so each linked extension folder still has a populated `node_modules`.

%% sounds like a good plan

### Q2. oxfmt vs Biome

oxfmt is the explicit ask, but it's the newest tool in the chain. If it can't format TSX in `cmux-diff` cleanly with default settings, are we OK falling back to Biome (also Rust, also defaults-only) — or do you want to commit to oxfmt regardless and live with caveats?

%% commit to oxfmt + oxlint - it can do jsx since I use it in a separate react project

### Q3. Where do prompts live?

`pi-model-system-prompts/model-prompts/*.md` are *data consumed by* the extension that wraps them. Two options:
- **(a) Keep inside the extension.** Simpler — the extension reads them with a relative path, which already works. Match `slide-presentation/templates/` precedent.
- **(b) Promote to top-level `prompts/`** as first-class data. Better discoverability, but requires the extension to know an out-of-package path, which is awkward for symlinked Pi loading.

Recommendation: **(a)**, unless you plan to share these prompts with other extensions or external tooling. The "first-class citizens" goal is satisfied by the folder taxonomy + having them tracked in git, not by location.

%% Ok let's keep option (a) then

### Q4. Manifest: explicit list, glob list, or convention-only?

Three flavors, each progressively more implicit:
- **(a)** keep `extensions: ["extensions/cmux-diff", ...]` listing each (current style, just relocated).
- **(b)** glob `extensions: ["extensions/*"]` (proposed above).
- **(c)** drop those keys entirely and let `install.ts` discover by folder convention.

(b) is the sweet spot: opts-out are still possible by deleting/moving a folder, but you don't restate the obvious.

%% yes option b sounds good

### Q5. Per-package `README.md` and inline docs

Each extension currently has a `README.md` plus `BLUEPRINT.md` and often `PLAN.md`. Are those still useful, or should they be archived to `docs/archive/<extension>/` after the migration? `BLUEPRINT.md` and `PLAN.md` look like one-shot planning docs that have aged out — happy to consolidate, but flagging since you may want to keep them as a record.

%% BLUEPRINT and PLAN are useful artifacts outlining why the extension exists. The READMEs don't have useful content. We should consolodidate the BLUEPRINT and PLAN into a single SPEC.md per extension that is a pure goal-oriented document outlining the desired behaviors of the extension without diving into implementation details

### Q6. Scoping inter-package deps

If we ever want to share TypeScript code between extensions (e.g., a shared `@fuc/pi-utils` for notifications/runtime helpers), we'll want package names like `@fuc/cmux-diff`. Cheap to add now (just rename `name` fields); harder to add retroactively if you start importing across packages first. Want to do this preemptively, or wait?

%% do it now. One related question though: right now each extension lists the Pi npm package as a peer depencency; wll this create issues with the bun workspace catalog feature?

### Q7. `bun create` flow into the monorepo

The TRACKER notes "TODO: make starter NOT init a git repo". Once the starter lives at `templates/extension/`, the natural creation flow becomes `bun run new-extension <name>` — which already won't init git. Is keeping the standalone GitHub starter repo (for `bun create`-from-template ergonomics outside this monorepo) still desired, or are you willing to retire it once this lands?

%% Retire it. All my extensions should be in this repo from now on

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pi runtime breaks on hoisted node_modules (Q1) | Medium | Test before Phase 1 finalize; fall back to `nohoist` |
| oxfmt churns on TSX (Q2) | Medium | Be ready to swap to Biome — root-only change |
| `bun run --filter` mismatches per-package script names | Low | Standardize: every package exposes `dev`, `typecheck`, `test` |
| Symlink farm in `~/.pi/agent` goes stale post-rename | Low | Re-run `scripts/install.ts` once after each phase |
| Catalog-pinned versions diverge from external `pi install`'d packages | Low | These are unrelated install paths; don't share versions |
| Lost work in `BLUEPRINT.md` / `PLAN.md` files | Low | Archive rather than delete; only purge after Phase 8 review |

---

## What I'd do first if you said "go"

1. Answer Q1 (10 min: drop a fake hoisted dep, link an extension, confirm Pi resolves it).
2. Answer Q2 (15 min: run `npx oxfmt` against `cmux-diff/src/viewer/app.tsx` and skim the result).
3. Decide Q4 + Q6 — both are 1-line config calls that lock in style.
4. Then execute Phases 1–3 in a single sitting; that's where most of the visible cleanup payoff lands.
