# Technical Overview

- This is a DeepSeek Harness (Cordis) plugin that manages local inference engines.
  User-facing behavior (install, use, platforms, hardware) is documented in
  [README.md](README.md); this file covers how the code is built and verified.

# Architecture

- pnpm workspace over `packages/{core,service,providers,tool,ui,bundle}`.
  The root `package.json` is the installable bundle (`dsh.bundle.patch` →
  `cordis.patch.yml`).
- **`core`** is the pure, framework-free domain model: `ParameterSpec`,
  `HardwareProfile`, `EngineAdapter`, `VramEstimator`, `GuidelineEngine`,
  `DefaultsResolver`, `DshModelRegistrar`, `SystemDepProvisioner`, and the OS
  reserve resolver. Every parameter ↔ hardware relationship lives here as a
  declaration; the estimator and guideline engine consume the declarations.
- **`service`** is the `ctx.localInfer` Cordis service: the registries (engines,
  VRAM models, presets, guidelines, dep plans, platform configs) plus the
  orchestration entry points (`estimate`, `guidelines`, `deps`, `installString`,
  `runInstall`, `launch`, `stop`, `registerModel`, `removeModel`,
  `detectHardware`, `detectOsReserve`, `resolveDefaults`, `fetchPreset`).
- **`providers`** carries the concrete adapters (NInfer, Hyper-Qwen,
  llama.cpp, Strata) and all the data: parameter surfaces, measured VRAM
  models, presets, built-in guidelines, per-OS install blocks, and the engine
  registry.
- **`tool`** registers the model-facing tools; **`ui`** carries the web routes
  (`/local-infer/*`) and the render models; **`dsh/client.js`** is the
  hand-written lazy-CJS browser card (no build step); **`bundle`** is the
  no-source meta-package.
- **Data-driven invariant:** adding an engine is one adapter plus its
  parameter data, with zero changes to `core` or `service`. Adding a model is a
  data edit (the model artifact maps).

# Dev Environment Tips

- Query the codebase using the `codegraph` tool. Prefer existing API and
  programming patterns over new code.
- When implementing, do not rely on memory. Look up the tool's documentation
  for the current version, or use online resources, to ensure accuracy.
- DeepSeek Harness supports a Creator Mode for deep introspection. If not
  active, request the user to set it for the next turn.
- Read class methods and properties with the `codegraph` tool before writing
  code, e.g. `codegraph explain FileName`.
- Use Vitest tests to answer questions, verify code, and test functionality.
- Sub-packages import each other by relative path
  (`../../core/lib/index.js`). A self-referencing bare specifier
  (`dsh-plugin-local-infer/core`) only resolves when the package has a
  self-link inside a `node_modules` tree, so it fails on local/pnpm installs.
- A bundle with a client half needs a bare-package carrier row: a no-op
  `dsh/host.js` module, a root `.` export, and a bundle row named after the
  bare package. The client-module scan keys `dsh.client` on a bare
  package-root entry, never a subpath, so without it the browser card is
  never loaded.
- Client-side and host-side changes activate differently. A page refresh picks
  up a new `dsh/client.js`, but host-side packages (service, providers, tool,
  the ui route) load into the host process at startup: a bundle reinstall
  rewrites `~/.dsh/profiles/<profile>/node_modules`, and the running host keeps
  its in-memory modules until a restart or a bundle toggle off/on. Verify a
  host-side change by restarting the host, not by reloading the page.

# DSH UI Component Library

- Use the DSH UI component library, `@deepseek-ai/dsh-client-ui-primitives`,
  wherever a control or renderer is needed. It is the only place a control can
  be shared between plugins (a plugin cannot import another plugin's
  component). Reuse what fits and lift a deliberate visual difference into a
  prop rather than starting a second copy.
- Discovery entry points for an agent:
  - **Component catalog:** the package README's table (the installed
    `node_modules/@deepseek-ai/dsh-client-ui-primitives/README.md`, source at
    `packages/client/ui-primitives/` in the DSH checkout). It maps every
    export to what it is: `Button`, `Checkbox`, `Switch`, `Menu` /
    `MenuItemButton`, `SegmentedControl`, `SegmentedTabs`, `Tag`, `Pill`,
    `StateDot`, `PathLabel`, `DisclosureRow`, `Modal`, `RiskConfirmation`,
    `Tooltip`, `HoverCard`, `ImageLightbox`, `Toast`, `SettingsForm` family,
    `JsonTree` / `JsonBlock`, `MarkdownText` / `CodeBlock`, the agent-output
    cards (`TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`,
    `WebBlock`), and the `Icon*` / artwork sets.
  - **Export surface:** the root export `lib/index.js` (types at
    `lib/types/index.d.ts`). That single import is the whole API.
  - **Theme tokens:** components take `--dsw-*` design tokens. Query the
    client `Theme` inspect provider's `listTokens` method for the current
    token names and light/dark override requirements.
  - **Live slot topology:** the client `Slots` inspect provider's
    `listSubTree` method shows where a card can mount.
- In the hand-written lazy-CJS card (`dsh/client.js`), React and the
  primitives come from the shell's frozen platform module table:
  `require('react')` and `require('@deepseek-ai/dsh-client-ui-primitives')`.
  A missing seed is a fallback to native controls, not an error, so guard
  every primitive use (`primitives && typeof primitives.Button === 'function'`).

# Code Style

- Follow [TypeScript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html).
  Be concise, declarative, and factual.
- Use a declarative and explicit coding style. Ensure single sources of truth
  and use language mechanics for deterministic behavior. Use tools like
  Object Literal Unions, Decorators, and Mixins if they fit the problem.
- Organize code with Services like Managers or Event Subscribers to keep code
  DRY and avoid reinventing the wheel.
- Never use grammatical shortcuts like emdash. Use separate sentences; commas
  and semicolons if necessary. Avoid pronouns and adverbs whenever possible.
- **Doc comments** start with the name and state what it does. Structure:
  `// [Name] [verb]s [what]. [Optional: when/why to use it].`
  Put useful information where users make decisions: usually the constructor,
  not methods.
- **Inline comments** are terse. Prefer end-of-line when short enough.
- **Explain why, not what.** The code shows what it does; comments should
  explain reasoning, non-obvious decisions, or edge cases.
- **Wrap comments** at ~80 characters, continuing naturally at word
  boundaries.
- **Naming matters.** Before proposing a name, stop and review existing names
  in the file. Ask: what would someone assume from this name? Does it fit with
  how similar things are named? A good name is accurate on its own and
  consistent in context. Do not use single-letter variable names besides the
  common `i, j, k, n, x, y, z` in loops.
- **Comment content:**
  - Add information beyond what the code shows (not tautologies)
  - State directly: "Returns X" (not "Note that this returns X")
  - Drop filler: "basically", "actually", "really" add nothing

# Docs

Fetch these docs to answer questions about their covered topic.
- [DeepSeek Harness Cordis Framework](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/refs/heads/master/docs/cordis-tutorial/index.md)

# Testing Instructions

- Build with `pnpm build` (runs `tsc -b`).
- Run the full test suite with `pnpm test` (runs `vitest run`).
- Run coverage with `pnpm test:coverage`; the suite must clear the thresholds
  in `vitest.config.ts` (lines 90 / functions 93 / branches 78 / statements 90).
- Lint the whole repo with `pnpm lint` (runs `eslint .`). This is the
  repo-wide lint gate; do not run `npx eslint` on a subset.
- Lint GitHub Actions with `actionlint`.
- For testing GitHub Actions Workflows, use the local docker image
  `w-act-latest:chrome` = `catthehacker/ubuntu:act-latest` + Google Chrome
  stable 153:
  ```
  act --env-file .env --secret-file .secrets -s GUESTWISE_SSH_PRIVATE_KEY="${GUESTWISE_SSH_PRIVATE_KEY}" --pull=false -W .github/workflows/{{my-push-workflow}}.yml push
  act --env-file .env -W .github/workflows/{{my-schedule-workflow}}.yml schedule
  ```
