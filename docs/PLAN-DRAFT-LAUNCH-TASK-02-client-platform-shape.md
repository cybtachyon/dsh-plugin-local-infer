# TASK-02 - Client launch bodies: correct platform shape

Files: `packages/client/src/api/routes.ts` (the mirrored `LaunchRequest`),
`packages/client/src/store/providers.ts` (`performEntryLaunch` saved body,
`draftLaunchBody`).

- Fix the launch-body `platform` shape: the host parses it as ONE per-engine
  `StoredPlatformConfig` entry (`parseStoredPlatformConfig` in
  `packages/ui/src/config.ts`), not the engine-keyed record the save route
  takes. Today `performEntryLaunch` and `draftLaunchBody` wrap the entry in
  `{ [engine]: entry }`, which the host reads as absent, so unsaved Engine
  Directory / Engine Fork edits never reach a launch. Send the entry directly
  (the Get route's contract).
- Do not touch the save route's record-shaped `platform` key; save is correct.
- The `performEntryStop` body keeps its platform entry shape fix too (same
  host parser, shared `launchRequestFromBody`).

Definition of Done:
- `pnpm build` clean; existing client specs updated for the corrected body
  shape and green; a spec asserts the launch body's `platform` is the entry
  itself when the draft (or entry) carries one.
