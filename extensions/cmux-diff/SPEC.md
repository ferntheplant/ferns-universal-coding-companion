# cmux-diff SPEC

## Purpose

Provide a fast, reviewable git-diff experience inside cmux that ends in feedback flowing back into the active Pi session — without standing up a long-lived web service. One ephemeral review at a time, opened on demand, closed once comments are submitted.

## Behaviors

### `/cmux-diff` review flow

The primary command runs a single review end-to-end:

1. Validate the environment (Pi has UI, current dir is a git repo, cmux is available).
2. Prompt the user for a diff target — uncommitted changes, a branch, or a specific commit.
3. Prompt the user for the cmux presentation mode (new pane vs. existing pane).
4. Compute the diff payload and register an ephemeral review context.
5. Start the local review server if it isn't already running, and open the cmux browser at the review URL.
6. The user reviews files, drafts overall / file-level / line-level comments, and submits.
7. Submitted comments are formatted and injected back into the active Pi editor; the page indicates the review is safe to close.
8. The review context is disposed automatically after a successful submit.

### Operational commands

- `/cmux-diff-status` — report whether the review server is running, plus active review tokens, targets, uptime, and URL.
- `/cmux-diff-kill` — force-stop the review server and clear all in-memory review contexts. The escape hatch when the browser, bridge, or server gets stuck.

### Review server

- Owned by the extension; the user never starts or stops it directly.
- Bun HTTP server, intentionally tiny: it serves the review page and accepts a single comment-submit POST per review token.
- Always runs in development mode so React DevTools and source maps work.
- Exists to bridge the browser back to extension-owned editor mutations — _not_ to be a general web service.
- Cleans up on `session_shutdown`, after successful submit, and on abandoned-review timeout.

### Diff rendering

- Powered by `git-diff-view` as the rendering engine.
- File panels are isolated subscription boundaries: editing a comment for one file must not rerender unrelated panels.
- Diff parsing is cached per file fingerprint + display options.
- Light/dark mode follows the OS via `prefers-color-scheme` and `color-scheme: light dark`. No manual theme toggle in v1.

### Comment workflow

- Three comment scopes: overall, file-level, line-level.
- Submission is one-shot — the user assembles all comments in the browser and posts them in a single round trip.
- Comments are formatted into Pi-editor-friendly text and appended cleanly into the active session.
- Failure modes (network error, server gone, Pi rejected the injection) surface clearly in the browser; the user can retry or fall back to `/cmux-diff-kill`.

## Non-goals

- Persistent or multi-session review state. Each review is ephemeral and dies with its submission (or kill).
- A general-purpose review web app, multi-user collaboration, or a production-grade backend.
- Production bundles or release builds of the viewer — dev mode only.
- A monolithic `App.tsx` or any state shape that forces broad rerenders on comment edits.
- Manual theme preferences in v1.
- Concurrent reviews as a feature; one active review at a time is the supported shape, even if the architecture happens to permit more.
