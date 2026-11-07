# TASK-010: displayText mapping on the launch state machine

Dependencies: TASK-009.

Move the state-to-button-label mapping into the machine so the machine
names stay logical and the button shows a short user-friendly version:

- `packages/client/src/machine/launch.ts`: export a
  `LAUNCH_STATE_DISPLAY: Record<in-flight LaunchStatus, TextKey-like
  reference>` (or a `launchDisplayKeyFor(status)` function) that names, in
  one place, which label belongs to `prereqs`, `download`, `downloading`,
  `build`, `launch`, `sudo`, `stopping`. Keep the labels themselves in the
  text tables (`packages/client/src/text.ts`, both en and zh) so i18n
  stays intact.
- `packages/client/src/store/derive.ts` `phaseLabelFor` becomes the single
  consumer of the machine mapping (keep the function, delegate the
  state-to-key decision to the machine).
- `packages/client/src/render/ProviderList.tsx` and the title-bar control:
  verify they reach labels only through `phaseLabelFor` /
  `deriveLifecycleControl`; remove any hardcoded phase label.
- Review the label wording against the phases they now cover (after
  TASK-009, `build` covers clone+build, `download` covers the hf model and
  template fetches): keep the text short ("Building...", "Downloading...").

Definition of Done:

- [x] One exported mapping in the machine; `phaseLabelFor` delegates; no
      renderer hardcodes a phase label.
- [x] `launch.spec.ts` / `derive.spec.ts` / `providerlist.spec.ts` updated;
      en and zh tables carry a label for every in-flight state.
- [x] `pnpm build` and `pnpm test` green.
