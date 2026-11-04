# TASK-005: Validate the Basalt Get download (resume, no duplicates)

## Context

The Basalt engine was getting stuck during the download step. The real cache
(`/home/derek/.cache/huggingface/hub/`) currently holds:
- `models--jesdga--Qwen3.8-Flash-Next-Basalt/blobs/177f9b70...fad33.482561fd.incomplete`
  (a 102GB incomplete download).
- a flat `hub/basalt/` dir (the old `--local-dir` layout).

The user referenced `/home/derek/.cache/hugginface/download/` (a typo for the
real hub cache). The goal: the Get step downloads correctly, auto-resumes from
an incomplete download, and does not generate duplicate downloads.

## Answers applied

- **Validation depth:** run the full Basalt 100GB+ download to completion
  against the real `hf` CLI and the real cache.

## Work

1. Run the Get step for the current (Basalt) setup against the real `hf` CLI and
   the real cache, running the full 100GB+ download to completion.
2. Prove resume: the existing 102GB `.incomplete` blob must be resumed (the
   download continues from it, not restart from zero). If it was pruned in the
   TASK-002 cleanup, re-download and confirm a clean single-dir result.
3. Prove no duplicates: confirm exactly one `models--jesdga--Qwen3.8-Flash-Next-Basalt`
   dir and no flat `hub/basalt/` dir after the run.
4. Record the outcome (commands, before/after `ls` of the cache, the resume
   evidence, the final blob size) in the task file or a short note for the user.

## Definition of Done

- A documented validation run shows the full Basalt 100GB+ download completes
  into a single `models--{ns}--{name}` dir (no duplicate flat dir), resuming
  from the `.incomplete` blob where present.
- The stuck 102GB `.incomplete` blob is handled (resumed to completion, or
  pruned and re-downloaded, with a note).
- The evidence (commands + before/after cache listing + final blob size) is
  recorded for the user.
