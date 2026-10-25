# T3.8 `src/Card.tsx`.

Compose the panels. Wire every action
(save, discard, register, unregister, launch, stop, download,
chat-template) through `performAction`. Delete the duplicated
lifecycle state (the Store invariants "deleted state" list); the
title-bar control renders from `deriveLifecycleControl`. Keep the
debounced re-price (300 ms) as the only field-edit side effect.

**DoD:** typecheck; build; `grep -c "useState" packages/client/src`
reports only the UI-local state that `CardState.ui` does not cover;
manual GUI walkthrough passes (see the GUI walkthrough checklist in
PLAN.md).
