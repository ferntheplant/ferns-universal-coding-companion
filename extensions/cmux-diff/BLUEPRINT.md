# cmux-diff Blueprint

## Goals

Rebuild the old `diff-cmux-old/` Pi extension as a cleaner, more maintainable Bun-first project in `cmux-diff/`.

Primary goals:

- preserve the good UX from the old project:
  - open a diff viewer in a cmux browser pane
  - prompt interactively for diff target and cmux presentation mode
  - review many changed files in one place
  - draft file / line / overall comments and submit them back into the active Pi session
- simplify the architecture around the actual intended usage:
  - one `/cmux-diff` command per review session
  - one ephemeral local review server owned by the extension
  - submit comments once, then close the browser page
  - rerun `/cmux-diff` when you want another review
- use **Bun** for runtime, HTTP server, bundling, and local development
- use **git-diff-view** as the rendering engine instead of the old diff stack
- optimize heavily for **incremental updates and minimal rerenders**
- run the **development build at all times** so React DevTools works
- support system light/dark mode using standard CSS techniques
- expose Pi commands to inspect and kill any stuck review server

---

## Product shape

### Main command

The primary UX should be a single command:

- `/cmux-diff`

This command should:

1. validate that we are in a git repository and inside cmux
2. prompt for the diff target
3. prompt for the cmux browser presentation mode
4. create an ephemeral review context
5. start an ephemeral Bun review server if needed
6. open the review page in cmux

### Supporting operational commands

We also want operational commands for debugging/recovery:

- `/cmux-diff-status`
  - report whether a review server is currently running
  - show the active review token(s), target, uptime, and URL if useful
- `/cmux-diff-kill`
  - force-stop the running review server
  - clear in-memory review contexts
  - useful if the browser/page or bridge gets stuck

Optionally later:

- `/cmux-diff-open` to reopen the active review page if the server is still alive

---

## What we learned from the old implementation

The old extension has a good product shape, but the architecture is too coupled:

1. **The extension entrypoint does too much**
   - command handling
   - git target resolution
   - server/session setup
   - comment send behavior
   - viewer bootstrap refresh logic

2. **The server owns too much implicit state**
   - sessions are just mutable objects in a map
   - asset build behavior is embedded into request handling
   - viewer bootstrap refresh is mixed with transport concerns

3. **The frontend is a monolith**
   - `web/app.tsx` is extremely large and stateful
   - many top-level `useState` values live in one component
   - changing one comment can cause broad rerender pressure
   - data loading, persistence, UI behavior, keyboard shortcuts, and rendering are all mixed together

4. **The app is architected for more lifecycle than we really need**
   - for the new version, review sessions are ephemeral and user-driven
   - we do not need a generalized long-lived app/session model

The rewrite should keep the UX, but treat the old project as a behavioral reference rather than a codebase to port.

---

## Updated architectural direction

The new implementation should be intentionally small and centered on a **single ephemeral review flow**.

### Core idea

We do **not** need a large persistent backend.
We **do** need a tiny local bridge between the browser page and the running Pi extension so submitted comments can be injected back into Pi.

So the right model is:

- a thin Pi extension
- a tiny Bun server owned by the extension
- a single-page review app
- a one-shot submit action from browser back to extension runtime

This is not a production web service; it is a local callback bridge.

---

## Proposed architecture

We should split the new implementation into four layers.

### 1. Pi extension layer

Responsible for:

- registering slash commands:
  - `/cmux-diff`
  - `/cmux-diff-status`
  - `/cmux-diff-kill`
- validating environment (`ctx.hasUI`, git repo, cmux availability)
- prompting for:
  - diff target
  - cmux view mode
- preparing the review payload
- starting/stopping the ephemeral review server
- opening the cmux pane/surface with the review URL
- receiving submitted comments from the server bridge and injecting them into Pi
- cleaning up runtime resources on `session_shutdown`

This layer should stay thin and orchestration-focused.

Suggested files:

- `src/extension/index.ts`
- `src/extension/commands.ts`
- `src/extension/prompts.ts`
- `src/extension/runtime.ts`
- `src/extension/notifications.ts`

### 2. domain layer

Responsible for pure application logic.

#### a. Git domain

- resolve repo root
- resolve target (`uncommitted`, `branch`, `commit`)
- compute reviewable file list
- load patch text / per-file diff payloads
- filter unsupported / binary paths
- generate stable file ids and fingerprints

Suggested files:

- `src/domain/git.ts`
- `src/domain/diff-target.ts`
- `src/domain/file-id.ts`
- `src/domain/types.ts`

#### b. cmux domain

- resolve workspace/pane context
- build new-pane/new-surface commands
- execute cmux commands with `pi.exec`

Suggested files:

- `src/domain/cmux.ts`

#### c. comment formatting domain

- validate submitted comments
- format comments into text suitable for Pi editor injection
- append formatted comments into the editor cleanly

Suggested files:

- `src/domain/comments.ts`

### 3. ephemeral review server layer

Use `Bun.serve()` and Bun's HTML/TSX support.

Responsibilities:

- serve the review page
- serve embedded bootstrap data or fetchable diff data
- receive submitted comments from the browser
- hand submitted comments back to extension-owned callbacks
- track whether a review server is running
- support forced shutdown and cleanup

Important: this is a **tiny local bridge**, not a broad application API.

Suggested files:

- `src/server/index.ts`
- `src/server/review-registry.ts`
- `src/server/routes.ts`
- `src/server/html.ts`

### 4. frontend app layer

The frontend should be small at the root and feature-oriented below it.

Responsibilities:

- render the review page
- show file list + diff panels
- manage comment drafts
- submit comments once
- show success/failure states
- close the page after successful submission if possible

Suggested files:

- `src/viewer/index.html`
- `src/viewer/main.tsx`
- `src/viewer/app.tsx`
- `src/viewer/state/*`
- `src/viewer/components/*`
- `src/viewer/lib/*`
- `src/viewer/styles.css`

---

## Review lifecycle

### Open review

1. user runs `/cmux-diff`
2. extension validates environment
3. extension prompts for diff target
4. extension prompts for cmux view mode
5. extension builds review payload
6. extension registers an ephemeral review context with the server runtime
7. extension opens cmux browser to `/review/:token`
8. frontend loads and renders the review

### Submit review

1. user drafts comments in the browser app
2. user clicks submit
3. browser POSTs submitted comments to the local review endpoint
4. server validates payload and calls back into extension-owned submit logic
5. extension injects formatted feedback into Pi editor/session
6. browser shows success state
7. browser attempts to close itself or instructs user it is safe to close
8. review context is disposed shortly afterward

### Recover from failure

If something gets stuck:

- user runs `/cmux-diff-status` to inspect runtime state
- user runs `/cmux-diff-kill` to stop the review server and clear contexts

---

## Review server model

### Why we still need a server

Pi exposes editor/session mutation APIs inside the extension runtime, but a standalone browser page cannot call those directly.

So even if the viewer is mostly a single page, we still need a local bridge so the browser can send comments back to the extension.

### Scope of the server

Keep it intentionally minimal.

Preferred route set:

- `GET /review/:token`
  - serves the review page
- `POST /api/review/:token/submit`
  - submits comments back to the extension bridge

Optional extra route if embedding the whole diff payload into HTML is impractical:

- `GET /api/review/:token/data`
  - returns the review payload JSON

Optional extra route if large diffs should be loaded lazily:

- `GET /api/review/:token/files/:fileId`
  - returns per-file patch payloads

### Review context model

Avoid a generalized "session orchestration" subsystem.
Instead, use a small ephemeral in-memory review registry.

Each review context should contain only what is needed for one review, for example:

- token
- createdAt / lastAccessedAt
- repo metadata
- resolved diff target
- file list metadata
- embedded payload or payload loader callback
- submit callback
- optional cmux/opening metadata for status display

This is enough to support:

- one active review
- or a small number of concurrent reviews if needed
- `/cmux-diff-status`
- `/cmux-diff-kill`

### Cleanup behavior

The review runtime should support:

- automatic disposal after successful submission
- automatic timeout for abandoned reviews
- forced kill via command
- full cleanup on `session_shutdown`

---

## Payload strategy

We have two acceptable options.

### Option A: embed everything into the review page

Flow:

- server serves one HTML page
- review payload is serialized into the page
- frontend boots with all data already present
- browser only uses network for submit

Pros:

- simplest client/server contract
- fewer endpoints
- easier to reason about

Cons:

- large diffs may make the page too heavy
- patch payload duplication may be expensive

### Option B: embed bootstrap metadata, fetch diff data separately

Flow:

- server serves one HTML page with lightweight bootstrap info
- frontend fetches either:
  - one `/data` payload, or
  - per-file payloads lazily

Pros:

- better for large diffs
- enables progressive loading
- better control over rendering cost

Cons:

- slightly larger API surface

### Recommendation

Start with this practical compromise:

- embed lightweight bootstrap metadata into the page
- allow one extra endpoint for fetching the actual diff payload if needed
- if large diffs still hurt, expand to per-file payload endpoints

That keeps the architecture simple while preserving room for performance tuning.

---

## Frontend state management

Use **Jotai**.

This is a good fit because we want:

- fine-grained subscriptions
- small, composable state units
- minimal rerenders when a single comment changes
- clear separation between diff state and comment state

### State principles

- keep root React state minimal
- use atom-level subscriptions per feature and per file where possible
- avoid giant prop objects flowing from the app root
- isolate comment edits from diff rendering

### Suggested atom groups

- bootstrap atoms
- UI atoms
  - view mode
  - active file id
  - search query
  - sidebar state
- file metadata atoms
- loaded diff payload atoms
- comments atoms
- per-file derived comment atoms
- submission state atoms

### Performance rule

A file row should subscribe only to its own state slice:

- its own metadata
- its own diff payload
- its own comments
- its own collapsed/review UI state

Typing into a comment for file A should not rerender unrelated file panels.

---

## Rendering strategy with git-diff-view

We should treat `git-diff-view` as the diff rendering engine, not as the app architecture.

### Integration plan

- backend computes stable file ids and diff payloads
- frontend renders a dedicated `GitDiffFileView` component per file
- `GitDiffFileView` is wrapped in `React.memo`
- parsing/rendering results should be cached per file fingerprint + relevant display options

### Performance rules

1. **Do not let comment edits invalidate diff rendering**
   - comment text changes should rerender only comment-related components
   - diff rendering should be keyed by patch identity, not comment state

2. **Keep file panels isolated**
   - one file panel = one subscription boundary
   - avoid broad root rerenders

3. **Load progressively if needed**
   - if diff payload is large, fetch it separately
   - if needed, fetch per-file payloads lazily

4. **Cache parsed diff artifacts**
   - if `git-diff-view` exposes a parse step, cache it
   - cache key should include fingerprint and display mode

---

## Theming strategy

Keep theming simple.

### Requirements

- support both light and dark system themes
- use standard CSS techniques
- do not add manual theme preference state in v1

### Implementation

- use CSS custom properties for app colors
- use `@media (prefers-color-scheme: dark)`
- use `color-scheme: light dark` where helpful
- map the effective system theme into any `git-diff-view` theme settings we need

This keeps theme support low-complexity and easy to maintain.

---

## Dev-mode-only build strategy

The user explicitly wants the development build always, for React DevTools.

### Implications

- do not produce or serve a production bundle for the viewer
- always run Bun server with development settings enabled
- keep source maps and readable component names
- optimize architecture for runtime responsiveness and debuggability

### Proposed approach

- serve `src/viewer/index.html` directly from Bun
- import `main.tsx` from HTML
- let Bun transpile/bundle on the fly in development mode
- keep the review server always in development mode

---

## Suggested project layout

```text
cmux-diff/
  package.json
  tsconfig.json
  index.ts
  src/
    extension/
      index.ts
      commands.ts
      prompts.ts
      runtime.ts
      notifications.ts
    domain/
      types.ts
      git.ts
      diff-target.ts
      file-id.ts
      cmux.ts
      comments.ts
    server/
      index.ts
      review-registry.ts
      routes.ts
      html.ts
    viewer/
      index.html
      main.tsx
      app.tsx
      state/
        atoms.ts
        comments.ts
        files.ts
        ui.ts
      components/
        toolbar.tsx
        sidebar.tsx
        file-panel.tsx
        comments.tsx
      lib/
        api.ts
        diff-cache.ts
      styles.css
  tests/
    unit/
    integration/
```

---

## Major implementation milestones

## Milestone 1: foundation and command flow

Deliverables:

- Bun project structure established
- dependencies selected and installed
- `/cmux-diff` command registered
- `/cmux-diff-status` and `/cmux-diff-kill` commands registered
- runtime object for tracking server state added

Success criteria:

- `/reload` loads the extension
- commands are visible and callable
- status/kill commands work against placeholder runtime state

## Milestone 2: minimal ephemeral review server

Deliverables:

- Bun review server runtime
- in-memory review registry
- HTML route for `/review/:token`
- submit route for `/api/review/:token/submit`
- cleanup and forced-kill behavior

Success criteria:

- extension can start a local review server
- status command reports running server information
- kill command fully stops the server and clears contexts

## Milestone 3: git and cmux integration

Deliverables:

- diff target prompt flow
- repo metadata loading
- diff payload generation
- cmux opening logic
- review context creation tied to real payloads

Success criteria:

- `/cmux-diff` can open a real review page in cmux
- target selection works cleanly
- review page is tied to one ephemeral review token

## Milestone 4: frontend shell + Jotai state

Deliverables:

- app shell
- sidebar/toolbar skeleton
- Jotai state atoms
- basic review page layout
- system theme CSS

Success criteria:

- review page renders cleanly
- theme follows OS setting
- state shape supports per-file isolation

## Milestone 5: diff rendering with git-diff-view

Deliverables:

- `git-diff-view` integration
- file panel rendering
- progressive payload loading if needed
- diff cache layer

Success criteria:

- multi-file review works
- large diffs remain reasonably responsive
- comment edits do not force whole-app rerenders

## Milestone 6: comment workflow

Deliverables:

- overall/file/line comments
- submit-one-review flow
- comment formatting and injection back into Pi
- success/failure UI after submit
- auto-dispose review context after submit

Success criteria:

- submitted comments appear in Pi editor/session as intended
- browser can be closed after success
- server cleanup behavior is reliable

## Milestone 7: operational robustness

Deliverables:

- abandoned review timeout
- better status reporting
- stuck-server recovery handling
- integration tests around start/status/kill/submit flows

Success criteria:

- a broken review can always be recovered via Pi commands
- runtime state is observable
- cleanup is dependable

## Milestone 8: performance hardening and docs

Deliverables:

- React profiling pass
- memo/subscription audit
- diff parse cache tuning
- README with install/dev/debug instructions
- architecture notes kept current

Success criteria:

- comment editing rerenders only the relevant subtree
- opening and using large diffs remains practical
- future iteration is straightforward

---

## Performance checklist

This should guide implementation from day one.

- keep root React state minimal
- prefer Jotai atom granularity over broad app state
- isolate comment editing from diff rendering
- use `React.memo` for heavy file-level components
- cache parsed diff artifacts by fingerprint
- avoid recreating large arrays in render paths unless memoized
- embed only lightweight bootstrap data if large diffs make full-page payloads too heavy
- progressively fetch diff payloads when needed
- measure with React DevTools Profiler throughout implementation

---

## Open questions

These do not block the blueprint, but should be answered before implementation gets deep.

1. Should v1 support both pane and surface modes, or only new-pane mode?
2. Should we allow more than one active review context at a time, or keep exactly one?
3. What timeout should expire an abandoned review?
4. After successful submit, should the page auto-close, redirect to a success page, or just show a "safe to close" message?
5. Is one extra `/data` endpoint enough, or will large repos require per-file endpoints from day one?
6. Does `git-diff-view` expose file-level primitives we can mount incrementally, or do we need an adapter layer around its higher-level API?

---

## Recommended implementation principles

- prefer small pure modules over convenience megafiles
- keep the Pi extension shell thin
- keep the Bun server tiny and explicitly ephemeral
- put application logic in domain modules
- use Jotai for fine-grained frontend state
- treat frontend performance as a first-class requirement, not polish
- optimize for debuggability over cleverness
- never reintroduce a giant `App.tsx` state blob
