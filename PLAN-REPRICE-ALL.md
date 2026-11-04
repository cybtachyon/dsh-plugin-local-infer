# PLAN-REPRICE-ALL

Adopt the `repriceAll` helper at the `repriceSummary` + `repriceDeps` pair
call sites in `packages/client/src/Card.tsx` and
`packages/client/src/store/actions.ts`, so the card's reprice paths use the
single two-fetch driver that `providers.ts` already uses.

## Questionnaire answers

- **Scope:** all call sites. Every `repriceSummary` site in `actions.ts`
  and `providers.ts` (pairs and standalone) adopts `repriceAll`, with the
  side effects evaluated below.
- **Commit granularity:** one commit per file (TASK-001, TASK-002,
  TASK-003), as planned.

## Side-effect evaluation (re-fetching the deps panel while the user edits
the draft)

1. **`deps/clear` on a probe failure.** `repriceDeps` clears the deps
   model on a fetch failure, so a transient probe failure hides the deps
   panel. This is the established, documented `repriceDeps` semantics
   (a host that predates the deps route keeps the card usable), already
   exposed at every pair site. The panel returns on the next successful
   reprice (the debounced field edit, the refresh button, the next
   provider operation). Handling: no code change; the semantics carry
   over unchanged.
2. **The `performEntryStop` fast-poll.** `pollFn` re-fires
   `repriceSummary` every `STOP_POLL_MS` (1000 ms) for up to 10 seconds,
   and the deps route re-probes the host on every fetch. Converting the
   poll to `repriceAll` adds up to ten live deps probes per stop with no
   UI benefit: stopping an engine does not change the system dependencies
   the panel prices. Handling: the poll keeps `repriceSummary` (summary
   only) with a comment naming the reason (TASK-003).
3. **Out-of-order responses while editing.** A slow deps response fired
   with the call-time engine/config can land after the draft changed,
   painting the panel with a stale price. This race already exists at
   the pair sites (the 300 ms debounced re-price fires both fetches), and
   the debounced `scheduleReprice` self-heals on the next edit. Handling:
   no new handling.
4. **Extra round trips at the one-shot sites.** One extra
   `GET /local-infer/deps` per register / unregister / download / launch /
   stop action. Bounded, and consistent with the pair behavior. Handling:
   accepted.

## Verification

- Behavioral invariance: each converted call site must fire the same two
  fetches (`/local-infer/summary`, `/local-infer/deps`) with the same
  query, fire-and-forget (`void`), as `repriceAll` already does.
- The one intentional exception: the `performEntryStop` fast-poll stays
  `repriceSummary` (side effect 2 above).
- `packages/ui/tests/client.spec.ts` pins `repriceSummary` in the bundle
  source. The symbol stays in the bundle (defined in `deps.ts`, used by
  the stop-poll), so the pin keeps passing.
- After `pnpm build`, `dsh/client.js` is rewritten and the
  `packages/client/lib/**` artifacts of the changed source files are
  re-emitted (a Card.tsx-only change touched 3 lib files, not the whole
  tree). Stage and commit as-is. The end-of-file-fixer hook can modify
  files during the commit, so a re-stage and re-commit may be needed.

## Tasks

### Phase 1: Refactor

- [x] [TASK-001-convert-card-pairs](docs/PLAN-REPRICE-ALL-TASK-001-convert-card-pairs.md)
- [x] [TASK-002-convert-actions-sites](docs/PLAN-REPRICE-ALL-TASK-002-convert-actions-sites.md)
- [x] [TASK-003-convert-providers-sites](docs/PLAN-REPRICE-ALL-TASK-003-convert-providers-sites.md)
- [x] [TASK-006-normalize-lib-newlines](docs/PLAN-REPRICE-ALL-TASK-006-normalize-lib-newlines.md)
- [x] [TASK-007-settle-build-docs](docs/PLAN-REPRICE-ALL-TASK-007-settle-build-docs.md)
- [x] [TASK-004-refactor-review](docs/PLAN-REPRICE-ALL-TASK-004-refactor-review.md)
- [x] [TASK-008-get-settle-reprice](docs/PLAN-REPRICE-ALL-TASK-008-get-settle-reprice.md)

### Phase 2: Verify

- [x] [TASK-005-full-gate](docs/PLAN-REPRICE-ALL-TASK-005-full-gate.md)

## Task dependencies

- TASK-001: none (the `repriceAll` helper already exists in `deps.ts`).
- TASK-002: none (independent file from TASK-001).
- TASK-003: none (independent file; the stop-poll exception is documented
  in the task body).
- TASK-006: none (independent tooling fix for the pre-existing lib
  newline churn discovered during TASK-002; runs before the review so the
  build script change is settled).
- TASK-007: TASK-006 (deduplicates the normalization TASK-006 added and
  settles the remaining pre-existing build and doc issues).
- TASK-004: TASK-001, TASK-002, TASK-003 (reviews the files those commits
  touched).
- TASK-008: TASK-004 (the review surfaced the `performGet` settle re-read
  duplication; runs before the gate so the source is settled).
- TASK-005: TASK-004 (the gate runs after the refactor review settles the
  source), TASK-008.

## Known pre-existing issues

- **`packages/ui/lib/viewmodels/summary.js` content churn.** tsc re-emits a
  collapsed `renderMeter(` call and a trailing space that the hooks had
  normalized, so a ui-package re-emit shows a 2-line diff that no
  trailing-newline pass can absorb. A post-build formatter pass is a bigger
  tooling change, out of scope here. The commit hooks absorb the churn on
  commit, so it is documented, not fixed.
