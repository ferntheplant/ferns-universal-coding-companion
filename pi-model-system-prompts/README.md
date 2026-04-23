# pi-extension-starter

A minimal GitHub template repo for Bun-managed, Node-compatible Pi extensions.

## Use With `bun create`

```bash
bun create <your-github-user>/pi-extension-starter my-extension
```

Bun will copy this repo into the destination directory, run `bun install`, and initialize a fresh Git repository.

## Template Principles

- Use Bun for package management and local scripts
- Keep extension runtime code Node-compatible
- Start from the Pi extension docs, not memory
- Keep the entrypoint thin
- Prefer manual smoke tests over early unit tests
- Add explicit cleanup and recovery paths when state exists

## Reference Docs

- Bun template docs: `https://bun.com/docs/runtime/templating/create#from-github`
- Pi extension docs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md`
- Starter guide: `docs/pi-extension-guide.md`

## Included Files

- `index.ts` - root re-export only
- `src/extension/index.ts` - bootstrap and cleanup
- `src/extension/commands.ts` - main/status/reset commands
- `src/extension/runtime.ts` - in-memory state
- `src/extension/notifications.ts` - user-facing messages
- `docs/pi-extension-guide.md` - workflow and implementation guidance

## After Creating A Project

1. Rename the package and commands.
2. Run `bun run typecheck`.
3. Load the extension in Pi with `/reload`.
4. Verify the real Pi command flow manually.
5. Add status/reset commands if the extension keeps local state.
