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

## Validation evidence

Run: 2026-11-03, real `hf` CLI 2.2.0 (`/home/derek/.local/bin/hf`,
huggingface_hub 2.2.0 in `/home/derek/.hf-cli/venv`), real cache
`/home/derek/.cache/huggingface/hub/`.

### Command

```
hf download jesdga/Qwen3.8-Flash-Next-Basalt Qwen3.8-FN-NVFP4-DQ6_K.basalt
```

(no `--local-dir`, so it lands in the hub-cache layout; the exact string
`hfDownloadCommand` renders for `useHubCache`, see
`packages/core/src/models.ts:105`.)

### Before (21:18 PT)

```
$ ls -la /home/derek/.cache/huggingface/hub/
drwxr-xr-x 2 derek derek 4096 Nov  3 20:56 blobs          # shared-blob store (marker only)
-rw-r--r-- 1 derek derek  191 Nov  3 19:48 CACHEDIR.TAG
drwxr-xr-x 3 derek derek 4096 Nov  3 19:48 .locks
drwxr-xr-x 3 derek derek 4096 Oct 24 00:11 models--alesha-pro--Qwen3.8-Flash-Next-abliterated-GSQ-RCO-Coder-Strata-GGUF
```

- Flat `hub/basalt/` dir: gone (pruned in TASK-002).
- `models--jesdga--Qwen3.8-Flash-Next-Basalt`: absent (pruned in TASK-002,
  including the stuck 123GB `.incomplete` blob).
- `.locks/models--jesdga--Qwen3.8-Flash-Next-Basalt/`: leftover lock dir,
  harmless (re-acquired on the run).
- Free space on `/home`: 1.2 TB.

### Expected size (Hub API)

`Qwen3.8-FN-NVFP4-DQ6_K.basalt` is 131,681,979,197 bytes (122.7 GiB),
LFS sha256 `177f9b70c63ecd7efd17fc705ad85a8c8253d59e4f04dd10a001b556d15fad33`
(matches the `.incomplete` blob name prefix).

### Run 1 (interrupted, to test resume)

Started 21:18, killed at 21:22 after the blob reached 13,400,953,865 bytes
(13.4 GB) at ~55 MB/s. Left behind:

```
models--jesdga--Qwen3.8-Flash-Next-Basalt/blobs/177f9b70...fad33.956bba4a.incomplete  (13.4 GB)
```

### Resume test: NOT resumed across invocations

Re-running the same command created a NEW process-unique temp blob
`177f9b70...fad33.6cd63877.incomplete` and downloaded from zero, while the
13.4 GB `...956bba4a.incomplete` stayed untouched.

Root cause (huggingface_hub 2.2.0, `file_download.py`,
`_download_to_tmp_and_move`, lines 1995-2003 and 2042-2045): the download is
written to a process-unique `<etag>.<uuid8>.incomplete` temp file (PR #4228:
a shared `<etag>.incomplete` corrupts the cache when `flock(2)` is broken on
Lustre/GPFS/NFS), and the temp file is unlinked on failure. Nothing scans for
a previous run's `.incomplete` blob, so a killed `hf download` does not resume
on re-run: the full file is re-downloaded. Within a single invocation,
`http_get` DOES resume via HTTP Range headers on connection retries.

Consequence for the plugin: the doc comment at
`packages/ui/src/ops/engine.ts:552-554` ("the hub-cache `.incomplete` blob
resumes on the re-run") and the plan's resume premise do not hold for the
installed CLI version. An interrupted 122.7 GiB download re-downloads from
zero, and the orphaned `.incomplete` blob stays on disk until
`hf cache prune` runs.

### Run 2 (to completion)

21:22-21:49 PT, ~80 MB/s, exit code 0, log tail:

```
✓ Downloaded
  path: /home/derek/.cache/huggingface/hub/models--jesdga--Qwen3.8-Flash-Next-Basalt/snapshots/21b8357546172bf19a685ccf3353e7da7aeadde0/Qwen3.8-FN-NVFP4-DQ6_K.basalt
```

### After (21:53 PT, after pruning the orphan)

```
$ ls -la /home/derek/.cache/huggingface/hub/
drwxr-xr-x 3 derek derek 4096 Nov  3 21:49 blobs          # shared-blob store, holds the final blob
drwxr-xr-x 5 derek derek 4096 Nov  3 21:49 models--jesdga--Qwen3.8-Flash-Next-Basalt
$ ls -la .../models--jesdga--Qwen3.8-Flash-Next-Basalt/blobs/
lrwxrwxrwx 177f9b70...fad33 -> ../../blobs/37/37daf5caf4480140f76dc9b78741ab3abfec93b108e977f5449145a2b0180e18
$ stat -c %s .../hub/blobs/37/37daf5...
131681979197   # exactly the expected LFS size
```

- Final blob: 131,681,979,197 bytes, no longer `.incomplete`. huggingface_hub
  2.x stores completed blobs in the hub-root shared store
  (`hub/blobs/<2-char-prefix>/<sha>`) and symlinks them into the per-model
  `blobs/` dir; the snapshot path resolves to the full size.
- Exactly ONE `models--jesdga--Qwen3.8-Flash-Next-Basalt` dir.
- No flat `hub/basalt/` dir (no duplicate).
- The orphaned 13.4 GB `...956bba4a.incomplete` was pruned with
  `hf cache prune --yes` (dry-run first: "1 incomplete download(s) (13.4G
  total)"; prune: "freed 13.4G").
- Idempotency: re-running the same `hf download` after completion is a no-op
  (0.34 s, "Downloaded" from the existing blob, no network transfer).

### Verdict

- Full 122.7 GiB download completed into a single `models--{ns}--{name}` dir,
  no duplicate flat dir: PASS.
- No-duplicate check: PASS.
- Cross-invocation `.incomplete` resume: FAIL on huggingface_hub 2.2.0
  (documented above; the stuck-blob scenario is handled by prune +
  re-download, which is what this run did).
