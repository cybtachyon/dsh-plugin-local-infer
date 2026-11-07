# TASK-011: Audit remaining process-vs-button mismatches

Dependencies: TASK-010.

Walk every control that reflects a provider process and record whether the
displayed text matches what is actually running. Fix each mismatch or
record why it stays, in this file.

Checklist to audit (extend as found):

- [x] Provider entry row while a *different* entry's run is in flight
      (`packages/client/src/render/ProviderList.tsx`): the row's control
      must read from that entry's own machine, not the edited one.
      Verified: `EntryLaunchButton` prices only `state.launch[provider.id]`
      and takes no `editingId`; the row-control API cannot read another
      entry. Added `prices each row from its own machine entry, not another
      entry run` (providerlist.spec): the building row throbs its own phase
      label, a second running entry's row reads its own Stop, an idle row
      stays Launch.
- [x] The `downloading` re-poll path: the result `state === 'downloading'`
      maps to the Downloading label; confirm the engine-files case reads
      right next to the model-download case from TASK-009.
      Verified: one settle path (`performEntryLaunch` moves the machine on
      the `downloading` result) and one mapping (`LAUNCH_STATE_DISPLAY`
      sends both the `download` phase and the `downloading` re-poll to the
      one `entryDownloading` key, 'Downloading...'). Pinned by the
      launch.spec shared-label test and the providerlist THROBBER_PATHS
      cases for both states.
- [x] `stopping` state: label shows the stop is in flight, and the stop
      fast-poll's summary reads do not flicker the label.
      Verified: the machine's `stopping` status (not the summary) drives
      both controls, and the phase branch prices before the
      `provider.status === 'running'` Stop branch. Added `keeps the
      stopping label across the stop fast-poll summary acks`
      (providerlist.spec): repeated summary acks never flicker 'stopping...'.
- [x] Download / chat-template / install buttons and cells
      (`actions.ts`, `deps.ts`, `template.ts`): a pending cell renders a
      busy label matching the route's process (Downloading... for the hf
      pull, Installing for the deps install).
      Model-Download cell reads 'downloading...' (names the hf pull;
      pinned by the new `paints the model download cell busy with the
      downloading label` card.spec test); the chat-template cell already
      reads 'downloading template...' (pinned in chattemplate.spec).
      Wording fix: the deps Run cell read the generic 'running...', so the
      text.ts key `running` became `installing` ('installing...' /
      '安装中…') and DepsPanel now shows `t.installing` while the install
      cell is pending (depspanel.spec updated).
- [x] `performDraftLaunch` (title-bar draft target): the draft control
      shows no phase labels today; with live step events available it
      should show the same phase labels as the entry control when the form
      is editing a provider (the machine entry exists for that id).
      Verified as already correct, accepted: while the form edits a saved
      provider the control's target is `entry` (deriveLifecycleControl via
      `editingProviderId`), so its click drives that entry's machine and
      the control shows the phase labels the machine reaches (derive.spec's
      per-status loop; new card.spec
      `routes the edited provider title-bar Launch to its entry machine`
      pins the wiring). `performDraftLaunch` runs only for a fresh draft,
      which has no machine entry and reads the plain 'Launching...' busy
      label (derive.spec); accepted.
- [x] The red Logs (`failed`) and Stop states after a stop timeout: the
      cause-aware reset keeps Stop on a still-up engine (already priced in
      the machine); confirm in the UI.
      Mismatch fixed: the row evaluated the summary's still-running status
      before its own machine's `failed`, so after a stop timeout
      (machine failed, cause 'stop') the row showed a Stop whose click is
      a no-op (`performEntryStop` guards a failed machine) while the
      title-bar control showed the red Logs for the same state.
      `EntryLaunchButton` now prices `failed` before the status-dot Stop
      branch, matching the title-bar control. Added
      `the red Logs after a stop timeout resets to a Stop control (engine
      still up)` (providerlist.spec): red Logs while up; the click's
      cause-aware reset lands the machine on running and the control reads
      as Stop.
- [x] From TASK-010: `deriveLifecycleControl`'s fresh-draft sudo branch
      (t.entrySudo driven by ui.sudoPending, no machine entry) sits outside
      the machine displayText mapping by design; route it through
      `launchDisplayKeyFor('sudo')` for strict single-source, or record the
      reason it stays draft-flag-driven.
      Fixed (single-sourced): the branch now reads
      `t[LAUNCH_STATE_DISPLAY.sudo]`, the same table `launchDisplayKeyFor`
      consults (direct indexing keeps it type-total and avoids a dead
      undefined branch). derive.spec asserts the draft-sudo label through
      the mapping.
- [x] From TASK-009: 'build' is announced at the start of the sync/build
      step, so the button can read "Building..." while a git clone/fetch
      runs, and a non-fatal rebase failure keeps the build label even
      though the build is skipped. Decide per this task: accept the
      clone-under-Building grouping (with the label wording checked), or
      give the phase a more accurate displayText.
      Decision: accept. Under Auto Rebuild the clone/fetch and the compile
      are one source-build phase, so "Building..." (zh '构建中…') reads
      naturally for the whole step, and the Logs-header step chips still
      separate clone from build for detail. A widened label ('Preparing...')
      would be vaguer during the multi-minute compile; wording stays.

Definition of Done:

- [x] Every checklist line above ticked (fixed, or recorded with reason).
- [x] Fixes land with tests in the owning spec files.
- [x] `pnpm build` and `pnpm test` green (plus `pnpm test:coverage` and
      `pnpm lint`).

## Findings for the TASK-012 ledger (pre-existing, not touched here)

- The machine's `downloading` state has no settle path in the client: the
  machine comment says "the card re-polls (a re-launch) until the engine
  reports ready", but neither the ported drivers nor the original
  hand-written bundle carries such a timer, so a `downloading` entry keeps
  reading "Downloading..." (a disabled throbber) until the page reload
  drops the in-memory machine. A settle needs a fold of the summary status
  (or a poll) into the machine; that is a restructure for TASK-012.
- `deriveLifecycleControl` has no summary-status fallback for the lost
  machine the entry row compensates for ("the launch state is lost when the
  user navigates away"): an engine running with no machine entry reads as
  Stop on the row but as a plain Launch on the title bar (whose click
  `performEntryLaunch` guards to a no-op). TASK-012 should price
  `provider.status === 'running'` into the launchStop branch too.
