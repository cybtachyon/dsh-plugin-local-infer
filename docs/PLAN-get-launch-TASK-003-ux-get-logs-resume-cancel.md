# TASK-003: Long-download UX (Get logs, per-step logging, resume, Cancel)

## Context

- The Get button seeds the Logs buffer with `--- ${t.getting}` where
  `t.getting = 'Getting...'` (`packages/client/src/store/deps.ts`,
  `packages/client/src/text.ts`). The request wants `--- Getting engine and
  model...` in both the Logs textarea and the log file.
- Each Get step must also write to the Logs textarea AND the log file. The get
  route streams to the textarea and persists the whole run to the log file at
  the end; make every step (deps, clone, build, model download, template
  download) land in both.
- A very long download (the 100GB+ Basalt model) must re-acquire (resume) if
  interrupted by an external process. The hub-cache layout is content-addressed
  (`.incomplete` blob), so re-running `hf download` resumes.
- A Cancel must interrupt the in-flight process and write `--- Canceled` to the
  Logs textarea and the log file. **Answer applied:** reuse the existing
  provider-form Cancel (not a new title-bar control) to abort the in-flight
  Get/Launch download.

## Work

1. Change `t.getting` (en + zh) to `Getting engine and model...` so the Get
   button and the get route both write `--- Getting engine and model...` to the
   Logs textarea and the log file.
2. Ensure every Get step (deps, clone, build, model download, template
   download) writes its output to the Logs textarea (streamed) and the log
   file (persisted), reusing the TASK-001 Get-steps routine's log sink.
3. Make the model/template download resume on re-run: run `hf download` against
   the hub-cache layout so an interrupted (`.incomplete`) download resumes
   instead of starting over, and do not create a duplicate download.
4. Wire the existing provider-form Cancel to abort an in-flight Get/Launch
   download: interrupt the in-flight `hf` child (SIGINT/SIGTERM) and append
   `--- Canceled` to the Logs textarea and the log file. Thread the abort
   through the client stream and the get/launch route. (No new title-bar
   control; the provider-form Cancel is the affordance.)

## Definition of Done

- `t.getting` reads `Getting engine and model...`; the Get button and the get
  route write `--- Getting engine and model...` to the Logs textarea and the
  log file.
- Every Get step's output reaches both the Logs textarea and the log file.
- An interrupted `hf download` resumes from the cache (no duplicate dir) when
  re-run.
- The provider-form Cancel interrupts the in-flight download and writes
  `--- Canceled` to the Logs textarea and the log file.
- `pnpm build`, `pnpm test` (with coverage thresholds), and `pnpm lint` pass.
- New/updated Vitest tests cover: the `Getting engine and model...` separator,
  the per-step logging, and the `--- Canceled` line on cancel.
