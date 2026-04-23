## Done

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
- observability via custom pi-context

## Extensions

- [web](https://github.com/nicobailon/pi-web-access)
  - do we need search or is nice fetch enough?
- [lsp](https://github.com/samfoy/pi-lsp-extension/tree/main)
  - did small changes to not register so many tools
  - need to make it give diagnostics in batches at end of string of edits instead of on every tool call
- images

## Workflows

- worktree/cmux workspace management
  - should be a standalone script outside of Pi
    - [effect cli](https://github.com/Effect-TS/effect/tree/main/packages/cli)
  - vercel [portless](https://github.com/vercel-labs/portless)
- GH PR comments
  - should be a custom extension with slash-commands
- compounding (session mining)
  - also a slash command?
- [dev](https://dex.rip/guide)?

## Big boyz (in order)

- browser
  - [dev tools](https://github.com/ChromeDevTools/chrome-devtools-mcp)
  - [agent browser](https://github.com/vercel-labs/agent-browser)
- "profiles" (i.e. only load figma MCP when it's a frontend session)
- time travel (i.e. tree + cwd snapshots)
- sandbox runtimes (might be the solution to time-travel)
  - [just bash](https://github.com/vercel-labs/just-bash)
  - [zmx](https://erock.prose.sh/zmx-ai-portal)
- remote runtimes
- subagents
- natives (see `omp`)
