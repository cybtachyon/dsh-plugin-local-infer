# TASK-006: Recommend visual improvements for long build/download steps

## Context

The build and download steps take a long time (the Basalt model is 100GB+). The
user wants visual updates, especially in the provider title bar, so a long
download does not look frozen.

## Work

Produce a concrete set of visual-improvement recommendations (scope per the
questionnaire answer): a progress indicator in the provider title bar during a
long download (bytes/percent/ETA from the `hf` stream), a per-step status line
in the Logs section (which of the five Get steps is running), a cancel
affordance, and any DSH UI primitive (`@deepseek-ai/dsh-client-ui-primitives`)
that fits (StateDot, Progress, Tag, etc.). If the scope is "implement the top
1-2", implement the highest-value ones (title-bar progress + current-step
label) and keep the rest as recommendations.

## Definition of Done

- A written recommendations list (in this task file and echoed in the final
  message) covering: title-bar progress during long downloads, current-Get-step
  indicator, cancel affordance, and the matching DSH primitives.
- If the scope includes implementation: the top 1-2 are implemented,
  `pnpm build`/`pnpm test`/`pnpm lint` pass, and the change is verified through
  the host-restart path.

## Recommendations

Scope for this pass: written recommendations only (questionnaire answer 5).
Nothing below is implemented.

### Baseline: why a 100GB download reads as frozen today

- The Get route (`packages/ui/src/routes/get.ts`) streams plain text through
  the log sink, and the card appends each chunk to `state.ui.logs.getLogs`
  (`performGet`, `packages/client/src/store/deps.ts`). The card already
  streams Get output, so a progress readout can be derived client-side from
  the streamed bytes.
- The model and template download steps (`runModelDownloadStep`,
  `runChatTemplateStep` in `packages/ui/src/ops/get-steps.ts`) emit one
  `$ hf download ...` header line and then call
  `localInfer.downloadModel` / `downloadChatTemplate`
  (`packages/service/src/index.ts`). Those run the rendered command through
  `downloadRunner`, which uses `exec` and captures stdout/stderr only on
  completion. Nothing streams during the download: for a 100GB pull the Logs
  pane shows the header line and then silence for hours.
- `hf download`'s default `--format auto` resolves to `agent` in a non-TTY
  (verified against the local `hf` CLI): `agent` prints only `path=...` to
  stdout and nothing to stderr, so even a streaming runner would see no
  progress. The `human` format writes tqdm progress to **stderr** as
  `\r`-separated updates:
  - file-count bar: `Fetching 1 files:  42%|***| 43/102 [00:45<01:02, 1.1s/it]`
  - per-file byte bar (large files): `Downloading model-00001-of-00010.safetensors: 12%|*| 5.2G/43.5G [01:23<10:11, 72.3MB/s]`
- The title-bar control (`deriveLifecycleControl`,
  `packages/client/src/store/derive.ts`) has no Get branch: while
  `state.actions.get.status === 'pending'` it renders the default
  `launchStop` control with `disabled: true` (via `deriveLaunchDisabled`), so
  the title bar reads as a greyed-out Launch button for the whole run.
- The provider-form Cancel (`cancelProvider`, `packages/client/src/store/providers.ts`,
  TASK-003) already aborts the in-flight Get run through the
  `activeGets` registry (`packages/client/src/store/abort.ts`) and writes the
  `--- Canceled` line, but it is only reachable from the provider row's
  Edit->Cancel swap, which a user mid-download is not looking at.

### R1. Stream the hf download progress (server side, prerequisite)

1. `hfDownloadCommand` and `hfChatTemplateCommand`
   (`packages/core/src/models.ts`): append `--format human` to the rendered
   command so the hf CLI emits tqdm progress to stderr. The rendered string
   is the single source the download route runs and the card shows, so the
   change stays in one place.
2. `downloadRunner` (`packages/service/src/index.ts`, the `exec`-based
   runner): switch to `spawn` (shell) and stream the child's stderr chunks
   through a new optional `onChunk` callback on `DownloadModelOptions`,
   keeping the existing tail-capture rule for failure detail and the
   `watchChildAbort` SIGINT->SIGTERM cancel path. `downloadModel` and
   `downloadChatTemplate` thread the callback through.
3. `runModelDownloadStep` / `runChatTemplateStep`
   (`packages/ui/src/ops/get-steps.ts`): pass `ctx.emit` as the chunk
   callback so progress lines land in the same log sink the get route
   streams (and the launch route's persisted logs).
4. Launch route (`packages/ui/src/routes/launch.ts` + `launchEngine` in
   `packages/ui/src/ops/engine.ts`): the launch NDJSON stream currently
   carries only the four launch step names (`prereqs`, `download`, `build`,
   `launch`); the Get steps a launch runs are collected into a string and
   never streamed. Add a third stream event kind,
   `{ progress: { step, percent, doneBytes, totalBytes, etaSeconds } }`,
   emitted from the same chunk callback, and extend `readLaunchStream`
   (`packages/client/src/api/routes.ts`) with an `onProgress` parameter so
   the launch machine can show the same readout.

### R2. Client-side progress derivation (store fields + parser)

- New store field in `CardState` (`packages/client/src/store/types.ts`):
  `CardUiState.getProgress: GetProgressState | null`, where
  `GetProgressState = { step: GetStepId; percent: number; doneBytes?: number;
  totalBytes?: number; etaSeconds?: number; rateLabel?: string; updatedAt:
  number }` and `GetStepId = 'deps' | 'clone' | 'build' | 'model-download' |
  'template-download' | 'done'`. It rides the existing generic
  `{ type: 'ui/patch'; patch: Partial<CardUiState> }` action; no new action
  type is needed.
- New pure parser module `packages/client/src/store/progress.ts`:
  `parseHfProgress(chunk: string): GetProgressState | null`. Split the chunk
  on `\r` and `\n`, take the last segment, and match the two tqdm shapes
  above (file-count bar and per-file byte bar) with a regex; map byte
  suffixes (K/M/G, iB) to numbers. Also `deriveGetStep(logs: string):
  GetStepId` in `packages/client/src/store/derive.ts`: the current step is
  the last step header the get-steps routine already emits
  (`system dependencies (...)`, the sync/build output, `model download:`,
  `chat template:`, `get complete`), so the step reads from the streamed
  buffer with no server change. Optionally the server emits explicit
  markers (`## step: model-download`) as one `ctx.emit` line per step
  function in `get-steps.ts`, which makes the derivation exact.
- Threading in `performGet` (`packages/client/src/store/deps.ts`): in the
  existing `append(chunk)` closure, run the parser on the chunk and, on a
  match, dispatch one `ui/patch` carrying both the merged `logs.getLogs`
  and `getProgress` (one dispatch, one render). Throttle the progress
  dispatch to ~2 Hz so a 100GB download does not re-render the card at the
  tqdm update rate. Clear `getProgress` in `finish` and on the abort path.
- The same derivation serves the standalone `download` action
  (`performDownload`, `packages/client/src/store/actions.ts`) once that
  route streams (see R6).

### R3. Progress indicator in the provider title bar

- `deriveLifecycleControl` (`packages/client/src/store/derive.ts`): add a
  `LifecycleControlKind` value `'getting'` and a new branch ahead of the
  default `launchStop` branch: while `state.actions.get.status ===
  'pending'` return
  `{ kind: 'getting', label: t.getting, variant: 'ghost', busy: true,
  busyLabel: <step label + readout>, disabled: false, target: 'draft',
  action: 'none' }`, where the readout composes
  `state.ui.getProgress` into e.g. `Downloading... 42% · 43.2/102.4 GB ·
  ETA 12:31` (falling back to the plain `t.getting` label when no progress
  has parsed yet). `deriveLaunchDisabled` already gates the Launch side
  while a Get is in flight; the new branch replaces that greyed-out state
  with a live one.
- The control render switch in `Card.tsx` (the `control.kind` chain near the
  form footer): add a `control.kind === 'getting'` branch that renders
  `renderProcessButton` (busy throbber, the existing `StateDot` ongoing
  spinner) plus a thin progress strip and the Cancel button (R5). The
  strip is a custom ~4px CSS bar using the `--dsw-alias-*` tokens, because
  the primitives package ships no `Progress` component (see R6).
- `ProviderRow` (`packages/client/src/render/ProviderList.tsx`): while a
  Get is in flight, render `renderStateDot('ongoing')` (the `StateDot`
  spinner) in place of the `STATUS_TO_DOT` status dot, and append the
  current step + readout to the row title, so the provider entry list
  (the title bar the plan names) shows `NInfer: Basalt (Downloading...
  42%)` instead of a stale `(stopped)` status.

### R4. Current-Get-step indicator

- `LogsPanel` (`packages/client/src/render/LogsPanel.tsx`): above the
  textarea, render a row of five step chips (deps, clone, build, model
  download, template download) as `Tag` primitives, with the tone derived
  from `state.ui.getProgress.step` and the run's settled state: done steps
  `tone="success"`, the running step `tone="info"` wrapped in
  `TextShimmer` (`active: true`) so the running chip visibly animates,
  pending steps `tone="quiet"`, a failed step `tone="danger"`. The chips
  are a pure draw of the store; no new state.
- The same `deriveGetStep`/`getProgress` source drives the title-bar
  readout (R3), so the chips, the title bar, and the Logs pane can never
  disagree.

### R5. Cancel affordance while a download is in flight

- `packages/client/src/store/abort.ts`: add `cancelInFlightGets(): boolean`
  that aborts only the `activeGets` set (the existing
  `cancelInFlightRuns(providerId)` also aborts a named provider's Launch
  run; a pure Get cancel should not).
- New driver `performGetCancel(store)` in `packages/client/src/store/deps.ts`:
  calls `cancelInFlightGets()`, appends the `--- Canceled` line to the Logs
  buffer (move `appendCanceledLog` out of `providers.ts` into a shared
  module so both drivers write the same line), and clears
  `state.ui.getProgress`. Unlike `cancelProvider` it does not collapse the
  form, so the user stays on the Get screen and can re-run (the hub-cache
  `.incomplete` blob resumes).
- Surface the cancel in three places, all reading
  `state.actions.get.status === 'pending'`:
  1. the title-bar `getting` branch (R3): a ghost `Button` labeled
     `t.cancel` beside the throbber;
  2. `DepsPanel` (`packages/client/src/render/DepsPanel.tsx`): beside the
     busy Get process button, a ghost Cancel `Button` (the busy
     `renderProcessButton` is currently a disabled button with no escape
     hatch);
  3. `LogsPanel` header: a `Pill` (interactive chip, `onClick` =
     `performGetCancel`) while a run is in flight.
- The existing provider-form Cancel (`t.cancel` on the provider row,
  `cancelProvider` -> `cancelInFlightRuns`) stays the primary path; the new
  affordances are the same abort surfaced where a mid-download user is
  looking.

### R6. Primitive mapping (verified against the installed
`@deepseek-ai/dsh-client-ui-primitives` 0.2.1-alpha.3 export surface)

| Recommendation | Primitive | Use |
| --- | --- | --- |
| Title-bar / row throbber | `StateDot` (`state: 'ongoing'`, `size`) | the shared loader; the card already renders it through `renderThrobber` |
| Title-bar progress bar | (none) | the package exports no `Progress` component (checked `lib/types`); a custom thin CSS strip on the `--dsw-alias-*` tokens, with a native fallback like the other renderers. Lift to a `Progress` primitive if DSH ships one |
| Step chips | `Tag` (`tone: 'success' \| 'info' \| 'quiet' \| 'danger'`) | the five Get-step chips in the Logs header |
| Running-step animation | `TextShimmer` (`active: true`) | animates the running chip / title readout so a 100GB pull reads as alive |
| Cancel | `Button` (`variant: 'ghost'`) | title bar, deps panel |
| Cancel (compact) | `Pill` (`onClick`) | the Logs header chip |
| Status dot swap | `StateDot` (`'ongoing'` replaces `STATUS_TO_DOT`) | the provider row while a Get is in flight |

Guarding: extend the `PrimitivesModule` interface
(`packages/client/src/render/primitives.tsx`, currently declares only
`Menu`, `Button`, `Checkbox`, `StateDot`, and two icons) with `Tag`,
`Pill`, and `TextShimmer` members, and add guarded renderers
(`renderTag`, `renderPill`, `renderShimmer`) with native fallbacks, the
same rule the existing renderers follow (a missing seed falls back, never
errors).

Follow-up (not this pass): convert the standalone `download` route
(`packages/ui/src/routes/download.ts`, a JSON answer) to the get route's
text stream so the form's Download button gets the same progress and
cancel treatment; `actions.download` carries the same 120 s
`ACTION_TIMEOUTS.download` desync as `get`.

### Pre-existing issues found while writing these

- `ACTION_TIMEOUTS.get` and `GET_IDLE_MS` are both 120 s
  (`packages/client/src/store/sync.ts`, `packages/client/src/store/deps.ts`).
  A download longer than two minutes settles the get cell to `ok` (detail
  `'idle'`) while the run keeps streaming in the background: the Get button
  re-enables, and a second click starts a concurrent second Get run (the
  `performAction` guard blocks only while the cell is `pending`).
- `hfDownloadCommand` renders no `--format`, so the non-TTY default
  (`agent`) suppresses all progress output; `downloadRunner`'s `exec`
  captures nothing until the child exits (see Baseline).
- `actions.download` (the standalone Download button) arms a 120 s timeout
  against the runner's 2 h `DOWNLOAD_TIMEOUT_MS`: the same desync as the
  get cell.
- TASK-005 (validate-basalt-get) is still unchecked in
  `PLAN-get-launch.md`; it precedes this task in the plan's list.
