# cmux-diff Architecture

## Design Philosophy

`cmux-diff` is intentionally small and focused on a single ephemeral review flow. Unlike the previous implementation, it does not attempt to be a generalized session orchestration system.

Key principles:

- **One review at a time** per Pi session (max 1 active review)
- **Ephemeral lifecycle**: review exists until submit or explicit kill
- **Instant feedback**: server starts immediately while diff is computed
- **Local bridge**: tiny Bun server enables browser → extension communication
- **Fine-grained reactivity**: Jotai atoms isolate file-level state

## Architecture Layers

### 1. Extension Layer (`src/extension/`)

Thin orchestration layer responsible for:

- Command registration (`/cmux-diff`, `/cmux-diff-status`, `/cmux-diff-kill`)
- Environment validation (git repo, cmux available)
- User prompts (diff target, pane selection)
- Lifecycle coordination (server start → payload build → cmux open)
- Comment injection into Pi editor

Key files:

- `index.ts` - Extension bootstrap
- `commands.ts` - Command handlers with optimized startup flow
- `prompts.ts` - User interaction flows
- `runtime.ts` - In-memory state tracking

### 2. Domain Layer (`src/domain/`)

Pure business logic modules:

#### Git (`git.ts`)

- Repo root resolution
- Diff target resolution (uncommitted, branch, commit)
- Patch computation with binary/unsupported file filtering
- File fingerprinting for stable identities

#### cmux (`cmux.ts`)

- Pane discovery with parallel surface info fetching
- Pane command builders (new-pane, existing-pane)
- Semantic pane labeling (title-aware)

#### Comments (`comments.ts`)

- Comment validation schemas (TypeBox)
- Formatter for Pi editor injection
- Editor text mutation via `ctx.ui.setEditorText()`

### 3. Server Layer (`src/server/`)

Tiny local bridge (not a generalized API):

- **Routes**:
  - `GET /review/:token` - Serves review page HTML
  - `POST /api/review/:token/submit` - Receives comments from browser
  - `GET /api/review/:token/data` - Returns review payload JSON

- **Registry** (`review-registry.ts`): In-memory ephemeral context storage

- **Assets** (`viewer-assets.ts`): On-the-fly Bun transpilation for dev mode

The server starts **immediately** after pane selection to provide feedback while the diff payload is computed.

### 4. Viewer Layer (`src/viewer/`)

React + Jotai single-page app:

#### State Management

- **Atoms** (`state/atoms.ts`, `state/ui.ts`, `state/files.ts`, `state/comments.ts`)
- Fine-grained subscriptions: editing a comment in file A does not rerender file B
- Normalized file graph with atom families for per-file isolation

#### Components

- `app.tsx` - Root layout (sidebar + file panels)
- `sidebar.tsx` - `react-arborist` file tree with filtering
- `file-panel.tsx` - Per-file diff view
- `git-diff-file-view.tsx` - `git-diff-view` integration
- `line-comments.tsx` - Inline comment annotations

#### Performance Optimizations

- `React.memo` on file panels
- Diff parse cache keyed by fingerprint
- Local React state for comment input (prevents cursor jumping)
- Comment count badges in sidebar (derived atoms)

## Startup Flow Optimization

The original flow had sequential delays:

```
Prompt → List Panes (sequential) → Build Payload → Start Server → Open cmux
```

Optimized flow:

```
Prompt → List Panes (parallel) → Start Server → Build Payload → Open cmux
                              ↑ immediate feedback
```

1. **Parallel pane discovery**: All `cmux list-pane-surfaces` calls run concurrently
2. **Early server start**: Server boots immediately after pane selection
3. **Async payload build**: Diff computation happens while server is running

## Review Lifecycle

```
User runs /cmux-diff
        ↓
    Validate env (git, cmux)
        ↓
    Prompt for diff target
        ↓
    Fetch panes (parallel)
        ↓
    Prompt for pane selection
        ↓
    START SERVER (immediate feedback)
        ↓
    Build review payload
        ↓
    Create review context
        ↓
    Open cmux browser → reviewUrl
        ↓
    [User reviews, adds comments]
        ↓
    Submit clicked
        ↓
    POST to /api/review/:token/submit
        ↓
    Extension injects comments into Pi editor
        ↓
    Browser auto-closes (or shows "safe to close")
        ↓
    Review context disposed
```

## State Isolation Strategy

### Why Jotai?

The previous implementation had a monolithic `App.tsx` with many `useState` hooks. Every comment edit caused broad rerenders.

Jotai provides:

- Atom-level subscriptions
- Derived atoms for computed values (comment counts, filtered trees)
- Clean separation between diff state (immutable) and comment state (mutable)

### File Panel Isolation

Each file panel subscribes only to:

- Its own metadata atom
- Its own diff payload atom
- Its own comments atom family

Result: Typing in file A's comment input does not:

- Rerender file B's panel
- Recompute file B's diff parse
- Trigger sidebar re-sorting

## Data Flow

### Diff Data

```
git diff → parseNumstat → computeReviewFiles → ReviewPayload
                                              ↓
                                    embedded in HTML (bootstrap)
                                              ↓
                                    viewer atoms hydration
                                              ↓
                           git-diff-view rendering with parse cache
```

### Comment Data

```
User types in inline comment
        ↓
Local React state (cursor stable)
        ↓
Blur/Save → update Jotai atom
        ↓
Derived: comment count badge updates
        ↓
Submit → POST /api/review/:token/submit
        ↓
Server calls onSubmit callback
        ↓
injectCommentsIntoPi → ctx.ui.setEditorText()
```

## Error Handling & Recovery

### Graceful Degradation

- Pane listing fails → Still offer "new pane" option
- Surface info fetch fails → Pane shows ID only
- Blob content missing → File renders without old/new content
- Submit fails → Browser shows error, review stays open for retry

### Recovery Commands

| Scenario              | Recovery                                |
| --------------------- | --------------------------------------- |
| Browser stuck         | `/cmux-diff-kill`                       |
| Review orphaned       | `/cmux-diff-kill`                       |
| Second launch blocked | `/cmux-diff-status` → `/cmux-diff-kill` |
| Server won't start    | Check port availability, kill existing  |

## Security Model

This is a **local development tool**, not a production service:

- Server binds to `127.0.0.1` only (no external access)
- Random UUID tokens prevent cross-review collisions
- No authentication (runs in user's local environment)
- Review contexts expire on submit or kill

## Performance Checklist

Verified behaviors:

- [x] Comment editing rerenders only relevant subtree
- [x] Large diffs use parse cache (fingerprint-keyed)
- [x] File panels memoized with `React.memo`
- [x] Pane discovery parallelized
- [x] Server starts immediately (feedback before payload ready)
- [x] No giant arrays recreated in render paths

## Future Extension Points

1. **Per-file lazy loading**: If `/data` payload becomes too large, enable `GET /api/review/:token/files/:fileId`
2. **Surface mode**: Currently pane-only; surface mode command shape exists but not implemented
3. **Multiple reviews**: Runtime state supports `maxActiveReviews` config; currently hardcoded to 1
4. **Timeout sweeper**: Currently no auto-timeout; could add periodic cleanup of abandoned reviews

## Locked Decisions (v1)

| Decision                | Rationale                                  |
| ----------------------- | ------------------------------------------ |
| Pane-only               | Simpler UX, single visible context         |
| Exactly 1 active review | Prevents cognitive overhead, easy recovery |
| No timeout              | User controls lifecycle explicitly         |
| Auto-close on submit    | Clean ephemeral model                      |
| Lockfile filtering      | Reduces noise in dependency-heavy repos    |
| Dev-mode-only build     | React DevTools availability prioritized    |
