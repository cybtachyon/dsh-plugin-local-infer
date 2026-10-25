# T3.6 `ProviderList` + per-entry Launch button.

Port the list,
the new-provider control, and the entry button. The entry button and
its fast-poll/deadline timers read `state.launch[provider.id]` and
dispatch `launch/move` events; delete `entryLaunchState` (part of the
Store invariants "deleted state" list) and the local timer bookkeeping
in favor of store-driven timers owned by the panel.

**DoD:** typecheck; build; GUI: per-entry launch (phase labels), stop
(fast poll repaints the dot), failed -> red Logs, and delete flows
behave identically; no timer leaks on unmount (verified by the
existing unmount-cleanup test pattern).
