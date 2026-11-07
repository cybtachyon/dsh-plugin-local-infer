# TASK-011: Audit remaining process-vs-button mismatches

Dependencies: TASK-010.

Walk every control that reflects a provider process and record whether the
displayed text matches what is actually running. Fix each mismatch or
record why it stays, in this file.

Checklist to audit (extend as found):

- [ ] Provider entry row while a *different* entry's run is in flight
      (`packages/client/src/render/ProviderList.tsx`): the row's control
      must read from that entry's own machine, not the edited one.
- [ ] The `downloading` re-poll path: the result `state === 'downloading'`
      maps to the Downloading label; confirm the engine-files case reads
      right next to the model-download case from TASK-009.
- [ ] `stopping` state: label shows the stop is in flight, and the stop
      fast-poll's summary reads do not flicker the label.
- [ ] Download / chat-template / install buttons and cells
      (`actions.ts`, `deps.ts`, `template.ts`): a pending cell renders a
      busy label matching the route's process (Downloading... for the hf
      pull, Installing for the deps install).
- [ ] `performDraftLaunch` (title-bar draft target): the draft control
      shows no phase labels today; with live step events available it
      should show the same phase labels as the entry control when the form
      is editing a provider (the machine entry exists for that id).
- [ ] The red Logs (`failed`) and Stop states after a stop timeout: the
      cause-aware reset keeps Stop on a still-up engine (already priced in
      the machine); confirm in the UI.
- [ ] From TASK-010: `deriveLifecycleControl`'s fresh-draft sudo branch
      (t.entrySudo driven by ui.sudoPending, no machine entry) sits outside
      the machine displayText mapping by design; route it through
      `launchDisplayKeyFor('sudo')` for strict single-source, or record the
      reason it stays draft-flag-driven.
- [ ] From TASK-009: 'build' is announced at the start of the sync/build
      step, so the button can read "Building..." while a git clone/fetch
      runs, and a non-fatal rebase failure keeps the build label even
      though the build is skipped. Decide per this task: accept the
      clone-under-Building grouping (with the label wording checked), or
      give the phase a more accurate displayText.

Definition of Done:

- [ ] Every checklist line above ticked (fixed, or recorded with reason).
- [ ] Fixes land with tests in the owning spec files.
- [ ] `pnpm build` and `pnpm test` green.
