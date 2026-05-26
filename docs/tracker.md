# Fern's Universal Coding Companion Ideas

Just put high level ideas + references here; split out into individual specs once ready

## Done

NOTE: Had to remove caveman + rtk due to conflicts

- custom html "slides" skill
- [mcp adapter](https://github.com/nicobailon/pi-mcp-adapter)
- [terminal signals](https://github.com/lucasmeijer/pi-terminal-signals)
- [pi answer](https://github.com/sids/pi-extensions/tree/main/answer)
- [hashline readmap](https://github.com/coctostan/pi-hashline-readmap)
  - possible [alternative](https://github.com/RimuruW/pi-hashline-edit)
  - TODO: merge with [`rtk`](https://github.com/sherif-fanous/pi-rtk)
  - TODO: merge with [bash-live-view](https://github.com/lucasmeijer/pi-bash-live-view)
  - TODO: add `cwd` param to bash tool (see [aliou](https://github.com/aliou/pi-harness/tree/main/extensions/defaults))
- [cursor](https://github.com/ndraiman/pi-cursor-provider)
- custom usage quota tracking via pi-usage
- [raw paste](https://github.com/tmustier/pi-extensions/tree/main/raw-paste)
- custom observability via pi-context
- custom extension starter
- custom generation time tracker via pi-usage
- [web fetch](https://github.com/Thinkscape/agent-smart-fetch)
- [agent browser](https://github.com/fitchmultz/pi-agent-browser-native)
- [exa mcp search](https://exa.ai/mcp)

## In-Flight

- track mcp configs
- move config to dotfiles
- AI generated session names (pi-context)
- replace `pi-context` with [langfuse](https://github.com/hdkiller/pi-langfuse)

## Extensions

- [lsp](https://github.com/samfoy/pi-lsp-extension/tree/main)
  - make small changes to not register so many tools
  - need to make it give diagnostics in batches instead of on every tool call
- cmux sidebar status/notification
  - [winter](https://github.com/w-winter/dot314)
  - [sasha](https://github.com/sasha-computer/pi-cmux)
  - [javier](https://github.com/javiermolinar/pi-cmux)
- guardrails
  - [git](https://github.com/mattpocock/skills/blob/main/skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh)
  - [toolchain](https://github.com/aliou/pi-toolchain)
  - [aliou guardrails](https://github.com/aliou/pi-guardrails)
- [introspection](https://github.com/aliou/pi-harness/tree/main/extensions/introspection)
  - see what tools/skills/extensions/context is currently available
- [context-mode](https://github.com/mksglu/context-mode)
- browser dev tools
  - [dev tools](https://github.com/ChromeDevTools/chrome-devtools-mcp)
  - [playwriter](https://github.com/remorses/playwriter)
  - [browserai](https://github.com/mksglu/browsirai)

## Workflows

- worktree/cmux workspace management
  - should be a standalone script outside of Pi
  - vercel [portless](https://github.com/vercel-labs/portless)
  - compatible with work tycho setup
- fetch and resolve GH PR comments
  - should be a custom extension with slash-commands
- compounding (session mining)
  - [breadcrumbs](https://github.com/aliou/pi-harness/tree/main/extensions/breadcrumbs)
- planning (blueprint -> plan; verification steps)
  - [dex](https://dex.rip/guide)
    - [scott](https://github.com/stolinski/s-stack/blob/main/skills/dex/SKILL.md)
  - matt pocock skills [domain model](https://github.com/mattpocock/skills/tree/main/domain-model) and [to-prd](https://github.com/mattpocock/skills/blob/main/to-prd/SKILL.md)
  - [hattice](https://github.com/mksglu/hatice)
  - [rjs](https://github.com/rjs/shaping-skills)
  - [missions](https://factory.ai/news/missions-architecture)
- commit messages (likely a skill or command)
- debugging
  - matt pocock skills [qa](https://github.com/mattpocock/skills/blob/main/qa/SKILL.md) and [triage](https://github.com/mattpocock/skills/blob/main/triage-issue/SKILL.md)
  - [codebase quality](https://github.com/mattpocock/skills/tree/main/improve-codebase-architecture)

## Big boyz (in order)

- "profiles" (i.e. only load figma MCP when it's a frontend session)
- time travel (i.e. tree + cwd snapshots)
  - jj?
- sandbox/durable runtimes (might be the solution to time-travel)
  - [just bash](https://github.com/vercel-labs/just-bash)
  - [zmx](https://erock.prose.sh/zmx-ai-portal)
  - [gondolin](https://github.com/earendil-works/gondolin)
  - [runtm](https://github.com/runtm-ai/runtm)
- remote runtimes
  - [sandcastle](https://github.com/mattpocock/sandcastle)
  - cloudflare
  - exe.dev
  - [ax](https://github.com/google/ax)
- subagents
- natives (see `omp`)
- TTSR (see `omp`)

## General categories of features

### HUD

- current context window usage
- response timers
- reasoning traces
- tool use visualizer
- quota tracker
- introspection

### Context

- bash tool result compression
- hashline read + edits
- AST grep
- graph codebase search
- session mining
- lsp integration (really this means "hints" without model directly asking)
- `/btw` mode

### Ecosystem

- respects `AGENTS.md`
- uses `skills/` folder
- MCP support
- works with all major providers
- collects traces for observability

### Capabilities

- browser use
- browser devtools
- web fetch
- web search
- research subagents
- microtask subagents
- tool call sanity checks
- toolchain enforcement (i.e. npm -> pnpm)

### Workspace

- git worktrees
- session rollback includes workspace state
- UI tool integration (i.e. cmux, superset, etc)
- durable sessions runtime
- session forking
- secrets management

### Orchestration

- planning
- full-power subagents
- background execution
- remote runtimes

### Project specific needs

- guides (via skills or readmes/agents.md)
- worktree setup script
- verifier command integration
  - tier 1: format, lint, and typecheck
  - tier 2: fast automated tests
  - tier 3: slow automated tests
  - tier 4: artifacts for human review
    - playbooks demonstrated in artifacts should eventually becomes automated in at least tier 3, hopefully tier 2

## Autonomous modes

- three primary interactive "modes"
  - product lead: design feature/spec
  - tech lead: create architecture and implementation plan
  - pair programmer: live coding
- background autonomous execution is exactly 2 modes
  - worker
  - verifier
- follow Factory AI missions architecture
  - dream is interactive session with product + tech leads -> fully autonomous implementation via worker<-->verifier iterations
  - I like their appeal to bitter lesson: do not provide strict structure for how planning looks and let model intelligence design its own planning solution
    - all the orchestrator gets to know is that "milestones" are handed off to worker/verifier pairs to implement
      - tier 1 and 2 verification before verifier handoff
      - tier 3 verification before milestone complete
      - tier 4 verification before mission complete

## Autonomy vs Interactivity

The features for a coding **assistant** are very different than those for an autonomous **agent**. The **assistant** is functionally a tool for thought for myself as I execute the task - it's my google search, rubber duck, and quick companion who can make edits faster than I can. The **agent** is essentially a trustworthy coworker I completely delegate away to by declaring intent and later confirming that their output matches my intent.

In the featureset listed above most features apply to both types code coding harness but in subtly different ways. For example; browser use for an assistant is a nicety that helps me share my visual context with the assistant easily but for the agent it's an essential tool for self-verifying its work against my declared intent. In an interactive mode the HUD is for me to see realtime stats but for an autonomous system the HUD allows me to monitor intent drift across multiple agents and quickly update intent, validate outputs, and apply steering corrections.

### The Canvas vs The Control Plane

An assistant needs a realtime canvas but an agent needs a batch processing control plane that is optimized for me to declare intents and monitor drift. Note that the act of declaring intent is likely best served by an interactive tool for thought meaning the necessary canvas takes 2 forms: one for intent and one for assistance. Off the top of my head an interactive intent-tool might look like a direct chat side-by-side with the intent document where an LLM serves as a thought partner for drafting an intent-doc of appropriate detail and scope. This is similar to the assistant which serves as a thought partner in directly writing code; are these really different tools?

## Specific Implementations

### zmx persistence

- basically wrap every pi session in a zmx wrapper
- give each pi session yet another zmx session to serve as a bash "sandbox"
- extensions that need singletons (langfuse server, code review server, etc) share their resource as a zmx session
- the sdk wrapping zmx should expose a generic interface that we can fill with exe.dev later
