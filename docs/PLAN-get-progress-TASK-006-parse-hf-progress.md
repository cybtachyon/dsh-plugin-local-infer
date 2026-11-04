# TASK-006: pure `parseHfProgress` parser in a new `store/progress.ts`

## Context

The hf CLI with `--format human` writes tqdm progress to stderr, streamed
through the get route into the card's Logs buffer. Two line shapes appear:

- `Fetching N files: 42%|...| 43/102` (a file-count progress bar)
- `Downloading x.safetensors: 12% | 5.2G/43.5G [01:23<10:11, 72.3MB/s]` (a
  byte progress bar with an ETA)

tqdm rewrites the current line with `\r`, so a streamed chunk can carry a
partial line, several `\r`-separated updates, and a final `\n`.

Per the plan decision, the get route streams NDJSON (`{ log }` +
`{ progress }` events, TASK-004). The server parses the tqdm lines with the
pure core parser (`packages/core/src/progress.ts`) for the structured
`{ progress }` events. Core is not browser-safe (node imports in its other
modules), so the client keeps its own pure mirror of the parser in
`store/progress.ts`: it folds the raw tqdm text that arrives in the
`{ log }` events into a `GetProgressState`, the path the request names for
populating `getProgress`. The structured `{ progress }` events feed the
same state when present (TASK-008).

## Change

- New file `packages/client/src/store/progress.ts`:
  - `GetProgressState` interface:
    `{ step: string; percent: number; doneBytes: number; totalBytes: number; etaSeconds: number }`
    (fields the title-bar readout and the progress strip render from;
    `etaSeconds` is -1 or 0 when the line carries no ETA).
  - `parseHfProgress(chunk: string, prior: GetProgressState | null): GetProgressState | null`
    : a pure parser that folds a streamed chunk (which may contain `\r`
    updates and partial lines) into the latest progress state. It recognizes
    both line shapes above, converts human byte sizes (`5.2G`, `43.5G`) to
    bytes, and converts the `[elapsed<remaining, rate]` tail to
    `etaSeconds`. Returns the prior state (or null) when the chunk carries
    no recognizable progress line.
  - A `deriveGetStep(log: string): GetStep` helper that maps the step-header
    lines get-steps already emits (`system dependencies`, `model download:`,
    `chat template:`, `get complete`) to the current Get step
    (`'deps' | 'clone' | 'build' | 'model' | 'template' | 'done'`), so the
    step chips (TASK-014) and the readout share one derivation.

## Definition of Done

- Unit tests cover: both tqdm line shapes, `\r`-separated multi-update
  chunks, a partial line completing across chunks, human byte-size
  conversion, the ETA tail, and a chunk with no progress line (returns the
  prior state).
- `deriveGetStep` tests cover each step-header line and the no-match case.
- The parser is pure (no clock, no I/O) and exported for the throttle
  (TASK-008) and the step chips (TASK-014).
- `pnpm build`, `pnpm test`, `pnpm lint` all green.

## Files

- `packages/client/src/store/progress.ts` (new)
- a new test file under `packages/client/tests/`.
