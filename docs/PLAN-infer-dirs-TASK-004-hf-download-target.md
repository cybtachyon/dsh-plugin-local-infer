# TASK-004: hf download routes share the directory rule

In `packages/ui/src/ops/hf.ts`, `resolveDownloadTarget` picks
`requestDir ?? storedDir ?? defaultModelDirectory()`. Align it with the
TASK-002/003 rule so every download route agrees with the card:

- The request directory still wins (flat `--local-dir` layout).
- The stored `config.modelDirectory` still wins when it names a path.
- Otherwise the hub-cache layout applies and the base is the hub cache root
  (the hf CLI resolves its own snapshot destination). The chat-template
  download keeps the same rule (its own `models--{ns}--{name}` dir).
- Where the route's result feeds a *presence* or *model directory* report
  (not the download itself), use the resolved hf download result directory
  from TASK-002.

Audit remaining `defaultModelDirectory()` call sites
(`grep -rn defaultModelDirectory packages/*/src`) and confirm each one
either names the hf download base (correct) or is converted to the resolved
directory rule (model directory reports). Do not change
`packages/service/src/index.ts`'s `defaultModelDirectory()` itself: it is
the hf hub cache probe and stays the download base.

Update route.spec download assertions as needed and add one covering the
three-level precedence with a cached artifact.

Definition of Done: one shared precedence rule; no route materializes a
fake override; suites pass; ui `lib/` outputs committed; prek clean;
committed.

Depends on: TASK-003.
