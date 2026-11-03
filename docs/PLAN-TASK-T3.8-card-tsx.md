# T3.8 `src/Card.tsx`.

Compose the panels. Wire every action
(save, discard, register, unregister, launch, stop, download,
chat-template) through `performAction`. Delete the duplicated
lifecycle state (the Store invariants "deleted state" list); the
title-bar control renders from `deriveLifecycleControl`. Keep the
debounced re-price (300 ms) as the only field-edit side effect.

**Note (config value display):** `summaryAck` (the re-price path)
resets the draft's `config` to the summary's stored config and merges
the platform entries field-level. So after `editProvider`,
`newProvider`, or `cancelProvider` fire `repriceSummary`, the form
re-reads the stored config, not the loaded provider's values or the
cached in-progress values. That is the 1:1 behavior of the hand-written
card, but it is a display defect: the freshly-loaded draft is
clobbered by the re-price it triggers. When wiring the re-price into
`Card.tsx`, improve the config value display so the form keeps showing
the intended values (the loaded provider's, or the cached in-progress
ones) and the re-price does not clobber them.

**DoD:** typecheck; build; `grep -c "useState" packages/client/src`
reports only the UI-local state that `CardState.ui` does not cover;
manual GUI walkthrough passes (see the GUI walkthrough checklist in
PLAN.md).
