# TASK-009: Refactor (client and wiring half)

Scope: the three implementation commits `9f765d6` (TASK-006), `8c4992b`
(TASK-007), `ff878ed` (TASK-008); docs(plan) commits between them are out of
scope.

Review the files touched by the previous 3 commits and identify the following code risks:
 - **Multiple Sources of Truth**: Same calculations done in multiple places.
 - **Duplicate Code**: Nearly-identical code in multiple methods.
 - **Bloaters**: Too many things done in a single method or class.
 - **Data Clumps**: Single variables that travel in a group for multiple methods.
 - **Shotgun Edits**: Commits with singular changes that touch multiple files.
 - **Feature Envy**: Method where over 50% of the code manipulates a different class.
 - **Magic Numbers**: Literals without context in method bodies.
Then address and resolve each risk.

Definition of Done: each risk listed is either resolved or explicitly reported
as not present; `pnpm build && pnpm test && pnpm lint` stay green (rebuild
`dsh/client.js` if sources changed, amended into the refactor commit); one
commit if code changed, otherwise a short note here and no commit.

## Answered open questions

(none specific to this task)

## Carry-over notes from TASK-008 (2026-11-04)

- The rebuild had to update the carrier pins in TWO suites in lockstep:
  `packages/client/tests/carrier.spec.ts` (the home named by TASK-008) and
  the older mirror `packages/ui/tests/client.spec.ts` (missed by the
  TASK-007 carry-over note). Both now load the same `dsh/client.js` with
  near-identical harnesses; the Duplicate Code review here should weigh
  consolidating the carrier-bootstrap behavior pins into carrier.spec.ts
  (its header already claims that role) and keeping only the source-pins in
  the ui suite.
- The committed `packages/client/lib` outputs lagged `packages/client/src`
  (TASK-007 shipped no lib outputs), so this artifact commit also lands the
  routes/plugin/text lib updates plus the new `OrchestratorCard.*`. Policy
  DECIDED by the parent (2026-11-04): tracked `lib/` outputs land in the
  same commit as their `src/` change; this repo's own specs (carrier.spec,
  bundle.spec, client.spec) load committed artifacts, so src-only commits
  leave them stale.
- `tsc -b` reported "up to date" over deleted outputs because a `git clean`
  after a verification build removed the new lib files but kept the
  git-ignored `packages/*/tsconfig.tsbuildinfo`. If a rebuild emits nothing
  while outputs are missing, delete the tsbuildinfo files and rebuild.

## Refactor outcome (2026-11-04)

Resolved risks:

- Duplicate Code (the carry-over item): the carrier bootstrap harness and
  five behavior tests (the lazy-CJS load contract, the locale and slots
  seams, the 404 probe skip, the mounted slot set, the primitives-seed
  fallback) were near-identical mirrors in `packages/ui/tests/client.spec.ts`
  and `packages/client/tests/carrier.spec.ts`. The behavior pins now live
  only in `carrier.spec.ts` (the home its header claims); the ui suite keeps
  only the source pins and cross-references the carrier suite in its header.
  The ui route-contract pin gained the two orchestrator route strings the
  artifact now carries.
- Duplicate Code: `routeExists` and `orchestratorRouteExists` each spelled
  the same fetch / status-not-404 / network-failure rule. Extracted
  `probeRoute(path)` in `routes.ts`; both are one-line delegates now.
- Duplicate Code: `plugin.ts` carried the probe-then-mount-try/catch pattern
  twice in `registerCard` and duplicated the skip-line logging again inside
  both mount functions. Extracted `mountWhenRouteExists(label, probe,
  mount)`; the mount functions rethrow `requireRuntimeModules` failures to
  that one catcher. The emitted skip log strings are unchanged.
- Multiple Sources of Truth / Duplicate Code: the `card()` and
  `orchestratorCard()` locale closures (`subscribeLocale`, `readLocale`)
  were identical. Extracted `localeStores(localeRef)` next to `LocaleRef`
  in `Card.tsx`; both factories destructure the pair.

Reported, not present in the reviewed scope:

- Bloaters: none introduced by TASK-006 through TASK-008. The Card.tsx file
  size is pre-existing and out of scope.
- Data Clumps: `(ctx, localeRef)` is a two-parameter handoff, idiomatic
  here; no variable group travels through methods.
- Feature Envy: none found in the reviewed methods.
- Magic Numbers: the OrchestratorCard style literals follow the established
  named-style-constant convention used across the card.

Reported, pre-existing and accepted:

- The client `OrchestratorModel` mirrors the node-side private
  `OrchestratorPayload` by hand (the documented TASK-007 decision; the
  client bundle cannot import the node-side orchestrator package). Both
  sides pin the exact field set (routes.spec and mount-e2e payloads on the
  client, full-object `toEqual` payload assertions in
  `orchestrator-routes.spec.ts`), so drifting one side breaks its own suite.
- The two `cordis.patch.yml` copies must stay row-identical (a repo
  structure predating TASK-006); bundle.spec pins the matching row id sets.

Verification: `pnpm build` regenerated `dsh/client.js` and the
`packages/client/lib` outputs in the same commit as the sources; `pnpm test`
78 files / 1412 green (five duplicated tests removed); `pnpm test:coverage`
passes the vitest thresholds; `pnpm lint` green.
