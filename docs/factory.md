# Fern's Autonomous Coding Contraption

There may be many software factories like it, but this one is mine.

## Orchestration

![Diagram](./factory.pdf)

### Vocabulary

- **operator**: me!
- **architect**: PM agent who can read the codebase + internet to produce a SPEC. Runs in two modes:
  - **deep-design** (sync): I work back-and-forth with the architect to flesh out larger ideas
  - **draft-from-prompt** (async): one-line ticket in, architect researches and returns a SPEC for me to review
- **orchestrator**: tech lead agent who can take a SPEC and turn it into an executable PLAN for junior engineers
- **executor**: junior engineer(s) that execute a given PHASE of a plan. Really a sub-hierarchy, not a true primitive (see [PLAN (non)requirements](#plan-nonrequirements)):
  - **builder**: writes the code
  - **reviewer**: reviews code
  - **QA**: exclusively reviews output program. Splits in two:
    - **walker**: walks through the feature manually with no code access, captures evidence (screenshots/recordings) for the PR
    - **formalizer**: takes walker traces and produces Playwright e2e tests; has read-only code access for selectors/routes

### Happy Path Flow

1. **Operator** works with **Architect** to produce SPEC
2. **Orchestrator** analyzes SPEC to produce PLAN composed of N serial PHASES
3. **Orchestrator** hands off first PHASE to **Executor** to implement
4. **Executor** produces approved, working implementation of the PHASE
5. **Orchestrator** repeats steps 3 and 4 until PLAN is complete
6. **Orchestrator** pings **Operator** to tell them the SPEC is complete

#### Executor Loop

1. **Orchestrator** opens a PR for the PHASE
2. **Builder** implements best attempt and pushes to the PR
3. **Reviewer** runs against the PR (greptile for now; custom review bot later) looking for maintainability and broad correctness
    - posts comments to the PR; **builder** wakes on PR events and addresses them
    - blocks progress up to R times before erroring the whole loop
4. **QA walker** runs the deployed code, explores it, posts evidence (screenshots/recordings) + issues to the PR
    - **builder** wakes on issues and addresses them; blocks up to Q times before erroring
5. **QA formalizer** converts walker traces into Playwright tests, pushes to the PR

This makes executor processes **long-lived and event-driven** — they sleep waiting on PR webhooks, not synchronous spawns. The PR itself doubles as the human-readable progress dashboard.

### Executor Failure Handling

When an executor errors, the orchestrator consumes a **trace summary** (think Slate's "thread episodes" — a curated digest, not the raw trace which would blow out context) plus the current PR state, and picks one of three recovery modes:

- **retry**: transient failure (e.g. too many review cycles). Same plan, new executor, possibly with a juiced prompt.
- **replan**: discovery during execution invalidates the plan but the SPEC is still valid. Orchestrator rewrites the remaining PHASES.
- **abort**: SPEC was built on false assumptions and cannot be implemented. Escalate to operator.

Each mode is a distinct sub-routine with its own prompt and inputs, not one mega-prompt that "intelligently decides."

#### Maintained State

- SPEC: tracked in-repo on main
- current PLAN
- current PHASE
- completed PHASES
- executor trace + curated trace summary
- orchestrator traces (for rerunning the whole thing on the same SPEC)
- per-PHASE cost/token budget consumed (another abort trigger)

### SPEC Requirements

A SPEC is designed to codify the **intent** of a feature - the Orchestrator+Executor loop is basically a compiler for a SPEC. The SPEC should come with "stories" outlining end-to-end user journies and invariant properties of the entire system that can be tested for. It should directly cite documentation and reference implementations when introducing new capabilities to the system.

### PLAN (non)requirements

The **Executor** is given as a primitive despite outlining its internal builder, reviewer, and QA components because we want to let model intelligence dictate its own orchestration as much as possible (see [Bitter Lesson](https://www.cs.utexas.edu/~eunsol/courses/data/bitter_lesson.pdf)). As such, the only constraint we impose on the **Orchestrator** is that it has access to executors that run in serial. By rejecting parallelism we avoid a whole slew of coordination complexity.

In an ideal universe the orchestrator could provide the end-to-end implementation, review, and QA itself. But due to the realities of model capabilities and context length we need native primitives for creating heirarchical units of work. Instead of giving the model complete freedom of choice for creating sub-agents to implement we force the use of our structured executors for _REASONS_.

### Required (not optional)

The moment I stop babysitting is the moment durable state matters. These are tier-0:

- **remote execution** for all involved agents (laptop closing can't kill a run)
- **resumable agents** (workflow-engine shape: function that can sleep for hours waiting on a PR webhook)
- **attachable agents** (I can plug in to provide guidance without disrupting; the alternative to "abandoned to its fate")

### Nice-to-haves

- control plane dashboard (the PRs already serve this for now)
- reusable agents (i.e. mega compaction)
- some level of parallelization
- nice visuals for plans (html)

### Other orchestration resources

- [RLM](https://arxiv.org/pdf/2512.24601)
- [Slate](https://randomlabs.ai/blog/slate)
- [Missions](https://factory.ai/news/missions-architecture)
- [Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Devin Multi Agents](https://cognition.ai/blog/multi-agents-working)

## Steering

We use the language of [Böckeler](https://martinfowler.com/articles/harness-engineering.html)) to differentiate the primary forms of steering. Below is a table of examples.

|        | computational | inferential |
| ------ | ------------- | ----------- |
| sensor | linter        | code review |
| guide  | codegen       | skills      |

Many random ideas I've tried and/or implemented as Pi extensions are in the [Tracker](./tracker.md)

### Sensors

The parimary computational sensors in use are just linters with varying degrees of intensity. The real issue is introducing a new sensor (lint rule) with many existing violations. I think the solution here is for the agent adding this new lint rule to segment violations by general feature area, add violation correction tasks to the backlog for future agents, and mark existing violations as "ignored." There should be a continuous stream of new sensors over time that catch and prevent mistakes from previous runs from occurring again.

#### Testing

The most interesting sensor to me is testing. This encompasses both automated and "manual" where an intelligence manually uses the system and observes its behavior. This is still mostly a problem for the specific project/repo being worked on - not for the end-to-end system.

### Code Review

Just use greptile EOM

### Guides

This is where the bulk of "context engineering" comes into play via complex progressive disclosure and memory schemes. Not particularly interested in working in this space but willing to just pickup whatever is most functional and least invasive. Currently our guides are just skill files documenting "golden patterns", gotchas, and general dependency docs. Happy to keep it here while maintaining a "mining" step to update these guides after every run.

In terms of vocabulary lets say "context engineering" is the advanced RAG stuff while "context optimization" is the little things like RTK that we should keep in our back pocket.

### Other steering resources

- [fallow](https://www.fallow.tools/)
- [Best Reviewer Model](https://factory.ai/news/code-review-benchmark)
- [Devin Verification](https://cognition.ai/blog/testing-development)
- [Factory QA](https://factory.ai/news/automated-qa)

## Implementation Ideas

### Design principles

- **All human-visible state lives in PRs and the repo.** No separate dashboard until that's painful. Notifications, review UI, and audit trail come free from GitHub.
- **Steering is handled entirely by the project codebase.** We provide an API surface for integrating sensors and guides into different phases of the flow.
- **Agents run in the Pi harness** with different collections of extensions depending on type (the above API surface lol). Keeps the harness extensible and open instead of leaning on a closed SaaS.

### Runtime

- Orchestration tracks enough sub-states that a real workflow engine pays for itself the first time we recover from a crash. Long-lived, event-driven, sleep-on-webhook shape (Temporal / Inngest / XState locally).
- Orchestrator and executors run on the same remote machine for shared state visibility, with **easy** attach.
- Architect's deep-design mode can run on the client device; draft-from-prompt mode runs remote like everything else.
- QA walker runs `agent-browser` to explore apps; formalizer writes Playwright tests.

### Model tiering

- **Architect + orchestrator**: frontier SOTA. These calls are infrequent but high-stakes; bad plans cascade.
- **Builder / reviewer / QA**: cheap open-weights (qwen3.6, kimi2.6, deepseek v4 flash). Strong sensors + guides should make well-scoped tasks reliable on weaker models. This is the whole bet of the steering system.
- Per-PHASE token/cost budget tracked as orchestrator state; budget exhaustion is another abort trigger.

### Git flow

- SPEC gets merged to main before work begins (in a spec folder)
- **PLAN** goes in its own PR for review before work begins (not straight to main — orchestrator shouldn't have unreviewed write access to main)
- One PR per PHASE; orchestrator owns open/close/merge
- Only orchestrator can write to the plan doc

Worked example:

1. orchestrator opens PR0 for the plan; operator approves & merges
2. orchestrator opens PR1 for phase 1
3. executor succeeds in implementing phase 1
4. orchestrator marks phase 1 complete on PR1 and merges
5. orchestrator opens PR2 for phase 2
6. executor errors during implementation
7. orchestrator reads the trace summary + PR2 state, picks **replan**
8. orchestrator closes PR2, opens PR3 with updated plan, operator approves & merges
9. orchestrator opens PR4 for the new phase 2
...
