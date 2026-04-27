# Fern's Universal Coder Ideas

Just put high level ideas + references here; split out into individual specs once ready

## Done

- custom html "slides" skill
- [mcp adapter](https://github.com/nicobailon/pi-mcp-adapter)
- [terminal signals](https://github.com/lucasmeijer/pi-terminal-signals)
- [pi answer](https://github.com/sids/pi-extensions/tree/main/answer)
- [hashline readmap](https://github.com/coctostan/pi-hashline-readmap)
  - possible [alternative](https://github.com/RimuruW/pi-hashline-edit)
- [`rtk`](https://github.com/sherif-fanous/pi-rtk)
  - TODO: merge with [bash-live-view](https://github.com/lucasmeijer/pi-bash-live-view)
  - TODO: add `cwd` param to bash tool (see [aliou](https://github.com/aliou/pi-harness/tree/main/extensions/defaults))
- [cursor](https://github.com/ndraiman/pi-cursor-provider)
- custom usage quota tracking via pi-usage
- [caveman](https://github.com/jonjonrankin/pi-caveman/tree/main)
- [raw paste](https://github.com/tmustier/pi-extensions/tree/main/raw-paste)
- custom observability via custom pi-context
- custom extension starter

## In-Flight

- custom system prompts per model
  - TODO: see if these [prompts](https://github.com/aliou/pi-harness/tree/main/extensions/modes/lib/prompt-families) are any good
  - also this [one](https://github.com/mattpocock/skills/blob/main/ubiquitous-language/SKILL.md)
- better session names (integrate with `pi-context`)

## Extensions

- [web](https://github.com/nicobailon/pi-web-access)
  - do we need web search or is nice fetch enough?
- [lsp](https://github.com/samfoy/pi-lsp-extension/tree/main)
  - make small changes to not register so many tools
  - need to make it give diagnostics in batches at end of string of edits instead of on every tool call
- images
- cmux
  - [winter](https://github.com/w-winter/dot314)
  - [sasha](https://github.com/sasha-computer/pi-cmux)
  - [javier](https://github.com/javiermolinar/pi-cmux)
- guardrails
  - [git](https://github.com/mattpocock/skills/blob/main/git-guardrails-claude-code/SKILL.md)
  - [toolchain](https://github.com/aliou/pi-toolchain)
  - [aliou](https://github.com/aliou/pi-guardrails)
- [introspection](https://github.com/aliou/pi-harness/tree/main/extensions/introspection)
- [context-mode](https://github.com/mksglu/context-mode)

## Workflows

- worktree/cmux workspace management
  - should be a standalone script outside of Pi
    - [effect cli](https://github.com/Effect-TS/effect/tree/main/packages/cli)
  - vercel [portless](https://github.com/vercel-labs/portless)
  - compatible with work tycho setup
- fetch and resolve GH PR comments
  - should be a custom extension with slash-commands
- compounding (session mining)
  - [breadcrumbs](https://github.com/aliou/pi-harness/tree/main/extensions/breadcrumbs)
- planning (blueprint -> plan; verification steps)
  - [dex](https://dex.rip/guide)
  - matt pocock skills [domain model](https://github.com/mattpocock/skills/tree/main/domain-model) and [to-prd](https://github.com/mattpocock/skills/blob/main/to-prd/SKILL.md)
- commit messages (likely a skill or command)
- debugging
  - matt pocock skills [qa](https://github.com/mattpocock/skills/blob/main/qa/SKILL.md) and [triage](https://github.com/mattpocock/skills/blob/main/triage-issue/SKILL.md)
  - [codebase quality](https://github.com/mattpocock/skills/tree/main/improve-codebase-architecture)

## Big boyz (in order)

- browser
  - [dev tools](https://github.com/ChromeDevTools/chrome-devtools-mcp)
  - [agent browser](https://github.com/vercel-labs/agent-browser)
  - [playwriter](https://github.com/remorses/playwriter)
- "profiles" (i.e. only load figma MCP when it's a frontend session)
- time travel (i.e. tree + cwd snapshots)
- sandbox runtimes (might be the solution to time-travel)
  - [just bash](https://github.com/vercel-labs/just-bash)
  - [zmx](https://erock.prose.sh/zmx-ai-portal)
- remote runtimes
  - [sandcastle](https://github.com/mattpocock/sandcastle)
  - cloudflare
  - exe.dev
- subagents
- natives (see `omp`)
- TTSR (see `omp`)
