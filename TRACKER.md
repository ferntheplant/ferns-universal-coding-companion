## Stuff I've done

- html "slides" skill
- mcp-adapter package
- terminal signals package
- answer package
- hashline readmap package
  - possible [alternative](https://github.com/RimuruW/pi-hashline-edit)
- [`rtk`](https://github.com/sherif-fanous/pi-rtk)
  - conflicts with bash-live-view package
- [cursor](https://github.com/ndraiman/pi-cursor-provider)
- usage quota tracking
- [caveman](https://github.com/jonjonrankin/pi-caveman/tree/main)
- [raw paste](https://github.com/tmustier/pi-extensions/tree/main/raw-paste)

## in-flight

- [web](https://github.com/nicobailon/pi-web-access)
  - do we need search or is nice fetch enough?
- [lsp](https://github.com/samfoy/pi-lsp-extension/tree/main)
  - did small changes to not register so many tools
  - need to make it give diagnostics only at end of user-turn rather than at end of every tool call
- observability
  - context-lens is too flaky and doesn't play nice with `/new` within a running pi session
  - we should just emit our own events for analysis; maybe we make it work with the same schema as context-lens to use their frontend
  - created my own context-lens "fork" with claude at `/Users/fjorn/withco/context-lens`

## Backlog

- images
- worktree/cmux workspace management
  - should be a standalone script outside of Pi
- GH PR comments
  - should be a custom extension with slash-commands
- compounding (session mining)
  - also a slash command?

## Big boyz (in order)

- browser dev tools
- browser control
- "profiles" (i.e. only load figma MCP when it's a frontend session)
- time travel (i.e. tree + cwd snapshots)
- sandbox runtimes (might be the solution to time-travel)
- remote runtimes
- subagents
- natives (see `omp`)
