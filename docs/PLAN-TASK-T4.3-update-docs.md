# T4.3 Update the docs.

In `AGENTS.md`: replace "**`dsh/client.js`**
is the hand-written lazy-CJS browser card (no build step)" with the new
story (typed source in `packages/client`, esbuild artifact, the two
runtime externals, the store invariants). In `README.md`: update the
`Install` "From source" section to mention `pnpm build` producing the
card.

**DoD:** no stale "no build step" or "hand-written" claims remain in
either file; the described pipeline matches `scripts/build-client.mjs`.
