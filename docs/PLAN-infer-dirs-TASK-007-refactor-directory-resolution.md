# TASK-007: Refactor the directory-resolution code touched so far

Refactor:

Review the files touched by the previous 7 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Focus areas for this change set: the model-directory precedence repeated in
`summary.ts`, `hf.ts`, `model.ts`, and `get-steps.ts` (collapse to one
shared resolver); leftover `${HOME}/.cache` literals; the
`modelDir`/`useHubCache` pair traveling together through the ops (candidate
for the `ModelDownloadTarget` value already in core); stale doc comments
describing the old `join(modelDir, engineId)` and config-in-model-dir rules.

Carried over from the TASK-002/TASK-003 reviews (resolve or explicitly
dismiss): the coarse hub-cache presence checks. `modelArtifactPath` with
`useHubCache` only checks that `models--{ns}--{name}/blobs` exists (any
blob, not the selected file) and `chatTemplateArtifactPath` with
`useHubCache` only checks the per-repo `snapshots` directory, both weaker
than `hfDownloadResultDirectory(...) !== null`. Replace the
directory-existsSync checks with the deterministic snapshot resolution as
the hub-cache presence check (call sites: summary view model, get-steps
model + chat-template steps). Also dedup `hf.ts resolveDownloadTarget`
against the shared resolver once TASK-004 lands.

Carried from TASK-004: redundant narrowing guards that restate the
`isModelDirectoryOverridden` predicate (`deps.ts` inline
`overridden && typeof ... === 'string'`, `ops/model.ts
resolveModelDirectory`, `get-steps.ts resolveEngineDirectory` inline
non-blank-string checks) collapse onto the predicate or the shared
`ModelDownloadTarget` value.

Carried from TASK-006 (stale rationale after the config move):
`packages/providers/tests/basalt.spec.ts` `modelEntryPath` docstring and
`packages/providers/src/engines/basalt/basaltAdapter.ts`
`basaltConfigContent` docstring still say the engine "resolves [the model
value] against the config file's home"; the config file no longer shares a
home with the model and deploy restamps an absolute artifact path, so
reword to "the entry must carry an absolute artifact path". Also refresh
the synthetic `/home/u/.cache/hf/basalt_config.json` command-line fixture
in `packages/service/tests/local-infer.spec.ts` (~1339-1345) to the new
config home. From TASK-005: `resolveEngineDirectory` is now a 3-line
override-or-builder; its dedup note is likely already satisfied - resolve
or dismiss explicitly.

Definition of Done: each risk listed above is either resolved or explicitly
dismissed with a one-line note in the commit message; suites, build, and
lint stay green; committed.

Depends on: TASK-002..TASK-006.
