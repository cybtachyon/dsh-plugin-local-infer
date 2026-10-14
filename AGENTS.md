# Technical Overview
- This is a DeepSeek Harness plugin to manage local inference setups.

# Dev Environment Tips
- Query the codebase using the `codegraph` tool. Prefer using existing API and
  programming patterns over new code.
- When implementing, do not rely on memory. Instead, look up the tool's
  documentation for the current version or use online resources to ensure
  accuracy and reliability.
- DeepSeek Harness supports a Creator Mode for deep introspection and working
  with the environment. If not active, request the user to set it for next turn. 
- Read class methods and properties with the `codegraph` tool before writing 
  code e.g., `codegraph explain FileName`.
- Use Vitest tests to answer questions, verify code, and test functionality.
- Sub-packages import each other by relative path
  (`../../core/lib/index.js`). A self-referencing bare specifier
  (`@dsh/dsh-plugin-local-infer/core`) only resolves when the package has a
  self-link inside a `node_modules` tree, so it fails on local/pnpm installs.
- A bundle with a client half needs a bare-package carrier row: a no-op
  `dsh/host.js` module, a root `.` export, and a bundle row named after the
  bare package. The client-module scan keys `dsh.client` on a bare
  package-root entry, never a subpath, so without it the browser card DSH UI is
  never loaded.

# Code Style
- Follow [Typescript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
  Be concise, declarative, and factual.
- Use a declarative and explicit coding style. Ensure single sources of truth
  and use language mechanics for deterministic behavior. Use tools like Object
  Literal Unions, Decorators, and Mixins if they fit the problem.
- Organize code with Services like Managers or Event Subscribers to keep code
  DRY and avoid reinventing the wheel.
- Never use grammatical shortcuts like emdash. Use separate sentences; commas
  and semicolons if necessary. Avoid pronouns and adverbs whenever possible.
- **Doc comments** start with the name and state what it does. Structure:
  `// [Name] [verb]s [what]. [Optional: when/why to use it].`
  Put useful information where users make decisions:
  usually the constructor, not methods.
- **Inline comments** are terse. Prefer end-of-line when short enough.
- **Explain why, not what.** The code shows what it does; comments should
  explain reasoning, non-obvious decisions, or edge cases.
- **Wrap comments** at ~80 characters, continuing naturally at word boundaries.
- **Naming matters.** Before proposing a name, stop and review existing names in
  the file. Ask: what would someone assume from this name? Does it fit with how 
  similar things are named? A good name is accurate on its own and consistent in
  context. Do not use single letter variable names besides the common
  `i, j, k, n, x, y, z` in loops.
- **Comment content:**
    - Add information beyond what the code shows (not tautologies)
    - State directly: "Returns X" (not "Note that this returns X")
    - Drop filler: "basically", "actually", "really" add nothing

# Docs
Fetch these docs to answer questions about their covered topic.
- [DeepSeek Harness Cordis Framework](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/refs/heads/master/docs/cordis-tutorial/index.md)

# Testing Instructions
- Lint with `npx eslint`.
- Lint GitHub Actions with `actionlint`
- For testing GitHub Actions Workflows, use local docker image
  `w-act-latest:chrome` = `catthehacker/ubuntu:act-latest` + Google Chrome stable 153
  ```
  act --env-file .env --secret-file .secrets -s GUESTWISE_SSH_PRIVATE_KEY="${GUESTWISE_SSH_PRIVATE_KEY}" --pull=false -W .github/workflows/{{my-push-workflow}}.yml push
  act --env-file .env -W .github/workflows/{{my-schedule-workflow}}.yml schedule`
  ```
