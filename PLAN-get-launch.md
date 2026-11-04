# PLAN: Get/Launch Refactor + HF Paths + UX

Make "Get" a true subset of the "Launch" code path, fix the Hugging Face
download paths to the real hub-cache layout, and improve the long-download UX
(logs, resume, cancel) for the local-infer plugin.

## Objective

Refactor the local-infer plugin so that:
1. **Get is a subset of Launch.** A shared Get-steps routine runs (1) install
   engine deps for the host OS, (2) git clone / download the engine binary,
   (3) `docker compose pull` or the source build step, (4) `hf download` the
   selected model when absent, and (5) `hf download` any selected chat
   templates when absent. `Get` runs those steps; `Launch` wraps the same
   steps (idempotently) and then launches the model. `Launch` must not wipe the
   Get-step logs it inherits.
2. **HF download paths use the real hub-cache layout.** The default download
   path is `$HOME/.cache/huggingface/hub/models--{namespace}--{Model-Name}/blobs/`
   (the layout `hf download` produces without `--local-dir`), not the flat hub
   root. Providers target that path. The model-presence check and the per-
   provider model dropdown match the `models--*` pattern against the models
   already in the cache, listing the artifact types each engine serves
   (Basalt `.basalt`, NInfer `.ninfer`, Strata `.gguf`/`.safetensors`, etc.).
3. **Long-download UX.** The Get button writes `--- Getting engine and model...`
   to the Logs textarea and the log file. Every Get step (deps, clone, build,
   model download, template download) also writes to both. A very long download
   (the 100GB+ Basalt model) re-acquires (resumes) if interrupted by an external
   process. A Cancel in the title bar interrupts the in-flight process and
   writes `--- Canceled` to both the Logs textarea and the log file.
4. **Validate.** Run the Get step for the current (Basalt) setup against the real
   `hf` CLI and the real cache; confirm it resumes an interrupted download and
   does not create duplicate downloads.
5. **Recommend visual improvements** for the long build/download steps,
   especially the provider title bar.

## Verification guidelines

These are the checks a task is not done until it passes. (Build/test/lint
commands and code style already live in `AGENTS.md`; not repeated here.)

- `pnpm build` succeeds (type-check + client bundle).
- `pnpm test` passes and clears the `vitest.config.ts` coverage thresholds.
- `pnpm lint` (repo-wide) passes.
- New behavior is covered by a new or updated Vitest test in the affected
  package. A task that changes a pure function ships the test in the same task.
- Host-side changes are verified by the host restart path, not a page reload
  (see `AGENTS.md` Dev Environment Tips).
- The Get-steps routine is the single source both `getEngine` and `launchEngine`
  call; no step (deps, clone, build, model download, template download) is
  duplicated across the two.
- The HF download command and the presence check agree on one path shape
  (the hub-cache `models--*` layout); no code targets the flat hub root for a
  model artifact.
- The per-provider model dropdown lists only the artifact types the engine
  serves, matched against `models--*` dirs present in the cache.
- The Logs textarea and the log file receive the same step lines (the
  `--- Getting engine and model...` lead, each step, and `--- Canceled` on a
  cancel).
- An interrupted `hf download` resumes from the cache (content-addressed
  `.incomplete` blob) and leaves exactly one `models--{ns}--{name}` dir (no
  duplicate flat dir).

## Answers (questionnaire)

1. **HF layout.** Use the hub-cache layout (`hub/models--{ns}--{name}/blobs/`
   + `snapshots/`) by dropping `--local-dir`, **only when the model directory
   is not overridden**. When the user overrides the Model Directory, keep
   `--local-dir` pointed at that dir (flat). The Model Directory field default
   is the hub cache.
2. **Existing artifacts.** Use the cache layout AND clean up: remove the flat
   `hub/basalt/` dir and prune the stuck 102GB `.incomplete` blob.
3. **Cancel.** Reuse the existing provider-form Cancel (not a new title-bar
   control) to abort an in-flight Get/Launch download and write `--- Canceled`
   to the Logs textarea and the log file.
4. **Launch wraps Get.** Launch runs the Get steps idempotently (skip
   already-satisfied steps), then launches; the Get logs are preserved.
5. **Visual scope.** Written recommendations only; implement none this pass.
6. **Validation depth.** Run the full Basalt 100GB+ download to completion
   against the real `hf` CLI and cache.

## Task dependencies

- TASK-001 (Get subset of Launch) is the foundation; TASK-003 (UX) builds on the
  Get-steps routine it introduces.
- TASK-002 (HF paths) is independent of TASK-001 but must land before
  TASK-005 (validation), which exercises the real download path.
- TASK-004 (code-risk review) runs after TASK-001/002/003 so it reviews the
  freshly-touched files.
- TASK-005 (validation) runs after TASK-002 and TASK-003.
- TASK-006 (visual recommendations) runs last, after the behavior is settled.
- Finalize runs after every task is checked.

## Micro-tasks

- [x] [TASK-001-get-subset-of-launch](docs/PLAN-get-launch-TASK-001-get-subset-of-launch.md)
- [x] [TASK-002-fix-hf-download-paths](docs/PLAN-get-launch-TASK-002-fix-hf-download-paths.md)
- [x] [TASK-003-ux-get-logs-resume-cancel](docs/PLAN-get-launch-TASK-003-ux-get-logs-resume-cancel.md)
- [x] [TASK-004-refactor-code-risk-review](docs/PLAN-get-launch-TASK-004-refactor-code-risk-review.md)
- [x] [TASK-005-validate-basalt-get](docs/PLAN-get-launch-TASK-005-validate-basalt-get.md)
- [x] [TASK-006-visual-improvements](docs/PLAN-get-launch-TASK-006-visual-improvements.md)
- [ ] Finalize: delete this plan and the `docs/` task files, commit the cleanup,
      close the session goals, and present the results.

## Findings (from subagent runs)

- TASK-001 found a cross-platform bug: `ninferAdapter.resolveChatTemplate`
  probed file presence with a POSIX-only `[ -f ]` shell test. Fixed in
  TASK-002 (node `existsSync` for the flat layout, the concrete snapshot path
  for the cache layout); TASK-004 verifies it.
- Whole-repo model presence mismatch and the flat `--local-dir` adapter
  downloads were TASK-002 scope (the hub-cache layout change settled both).
