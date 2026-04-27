# Pi Extension Guide

This document captures the lessons from building `cmux-diff` so future agents can build Pi extensions with less thrash.

## What Actually Mattered

### 1. Optimize for manual smoke tests, not unit tests

The important failures in this project were integration failures:

- the page loaded but rendered nothing
- the diff renderer crashed on unexpected patch shapes
- cached viewer assets masked whether a fix actually worked
- the submit flow and Pi editor injection needed real end-to-end verification

Unit tests and typechecks were still mildly useful as guardrails, but they did not prove the extension worked. For personal Pi extensions, default to:

- `bun run typecheck`
- a short manual smoke-test checklist
- one real terminal/browser verification pass in Pi

Do **not** spend early time building a deep test suite unless the extension has reusable business logic that is actually easy to test in isolation.

### 2. Use Bun for package management and local workflows, but keep runtime code Node-compatible

This project started Bun-first, but the Pi runtime uses Node. That means:

- `bun install` is fine
- `bun run` scripts are fine
- Bun TypeScript/bundler ergonomics are fine
- Bun-only runtime APIs are **not** safe in extension code

Avoid relying on Bun runtime features such as `Bun.http`, `Bun.file`, or unconditional `Bun.serve()` inside code that Pi executes.

Preferred rule:

- use Bun as the package manager and local runner
- write extension runtime code against Node-compatible APIs
- if Bun-specific behavior is useful, gate it behind runtime detection and keep a Node fallback

`cmux-diff` ended up doing exactly that in `src/server/index.ts:1`.

### 3. Start from the Pi extension docs, not from memory

The initial extension setup benefited from using the Pi docs directly, especially for:

- package layout
- entrypoint/module shape
- peer dependencies
- extension API assumptions

Use this doc as the first setup reference:

- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md`

Also check SDK docs when wiring events, commands, or editor interactions.

### 4. Keep the extension entrypoint thin

A recurring design lesson was that the extension entrypoint should not own product logic.

Good split:

- `index.ts`: re-export only
- `src/extension/index.ts`: bootstrap, register commands, cleanup hooks
- `src/extension/commands.ts`: command orchestration
- `src/extension/runtime.ts`: in-memory state
- `src/extension/notifications.ts`: user-facing messages

This pattern is already used here:

- `index.ts:1`
- `src/extension/index.ts:1`
- `src/extension/commands.ts:1`

### 5. Make lifecycle and cleanup explicit from day one

The successful architecture was not a persistent app. It was an ephemeral flow with explicit cleanup.

What worked:

- one active review at a time
- a small in-memory registry
- `session_shutdown` cleanup
- explicit recovery commands like status/kill

This is a good default for Pi extensions that open local UI or manage temporary state.

### 6. Recovery commands are worth more than extra abstraction

The `/cmux-diff-status` and `/cmux-diff-kill` commands were not fluff. They were necessary to recover from:

- stuck browser panes
- stale local server state
- cached viewer assets
- abandoned review sessions

If your extension manages local processes, local servers, or stateful flows, include at least:

- a status command
- a kill/reset command

### 7. The real failures were integration boundaries

The hardest bugs were not in the obvious business logic. They were at the seams:

- Pi runtime <-> extension code
- extension <-> cmux
- server <-> viewer bootstrap
- diff library <-> real-world patch formats
- browser submit flow <-> Pi editor injection

Future agents should assume boundary code is the highest-risk area and validate it first.

### 8. Prefer early end-to-end usability over architectural completeness

A good iteration pattern for Pi extensions is:

1. register commands
2. validate environment
3. make the happy path work once
4. add recovery commands
5. harden the failure cases
6. only then optimize internals

This project improved meaningfully once the server started earlier and the UI opened faster, even before the rest of the implementation was polished.

### 9. Force product decisions early

Agents lost time when product constraints were still implicit.

Make these decisions explicit before implementation:

- one active session or many?
- pane-only or pane + surface?
- auto-timeout or explicit cleanup?
- submit by sending a message or by inserting editor text?
- manual smoke tests only, or real automated tests?

Write those decisions into the blueprint or plan before coding.

### 10. Keep docs and architecture notes in the repo

The final repo is easier to reason about because it contains:

- `README.md:1`
- `docs/architecture.md:1`
- `BLUEPRINT.md:1`
- `PLAN.md:1`

For agent-built projects, this matters. The docs are not secondary; they are how the next agent avoids repeating the same mistakes.

## Recommended Workflow For Future Pi Extensions

### Phase 1: bootstrap

- read the Pi extension docs
- create the minimal package scaffold
- install peer deps exactly as required by the docs
- add only `dev` and `typecheck` scripts initially
- keep the root entrypoint trivial

### Phase 2: prove the real loop

- register one slash command
- validate environment assumptions early
- make the command perform a visible action in Pi
- test it manually in the real Pi runtime

### Phase 3: add stateful behavior carefully

- add runtime state only after the happy path exists
- add explicit cleanup hooks
- add a status/reset path before piling on more features

### Phase 4: harden integration seams

- add defensive parsing for real-world inputs
- isolate third-party UI/library failures so the whole extension does not blank out
- add cache reset instructions when local bundling or viewer assets are involved

## Default Rules For Agents

When building a new Pi extension for this repo/workflow, assume:

- Bun is the package manager, not the runtime contract
- Node compatibility is required for extension execution
- manual smoke tests are the primary verification method
- the extension entrypoint stays thin
- lifecycle cleanup is mandatory
- status/reset commands are worth adding early
- architecture docs should be written as part of delivery

## Starter Template Expectations

A good starter template for this workflow should include:

- Bun-managed `package.json`
- Pi peer dependencies
- Node-compatible runtime code
- thin extension bootstrap
- runtime state module
- notification helpers
- command registration scaffold
- README with install/dev/smoke-test steps
- no default unit test suite

That template lives in `templates/pi-extension-starter/`.
