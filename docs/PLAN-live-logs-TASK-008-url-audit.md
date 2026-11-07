# TASK-008: URL queries log the URL before querying

Dependencies: TASK-007.

Audit every host-side URL query and apply the same rule as exec: write the
URL to the log first, append the outcome after.

Carried in from TASK-007 (append-results half of the rule):

- `get-steps.ts` Infernix extras: on the `host.run` fallback the child's
  stdout is discarded (CommandOutcome carries only `{ ok, detail }`), so
  success output never reaches the log. Route the extras through
  `runStream` (capturing chunks to the log sink) even when `onChunk` is
  absent, or append `outcome.stdout` when a run log sink exists.
- Adapter deploy-time `host.run` outcomes (docker pull, deploy-time hf
  downloads in `adapters.ts` / engine adapters): same limitation - the
  `$ <command>` line lands now, but success output text never does. Apply
  the same fix so results follow their command line.
- The install run persists no run text (hub live only): fold the install
  settle text through `persistProcessLog` so a reload still shows the last
  install run, matching the other processes.

Sites found during planning (extend as the audit discovers more):

- Engine health poll: `host.fetch(plan.healthUrl)` in
  `packages/providers/src/adapters.ts` (~line 836) and
  `packages/providers/src/engines/strata/strataAdapter.ts` (~line 448).
  The launch's health-poll phase currently logs nothing about what it is
  waiting for: log `> GET <healthUrl>` once before the first request (not
  per retry; the retries are silent until the settled outcome), then append
  the verdict line (`ready on <url>` / the last failure detail) at settle.
  Thread the run's log sink through the service `launch` options the way
  `onProgress` rides today.
- `packages/service/src/index.ts` `fetchPage` / `resolveModsearchCli` (the
  preset fetch): fetchPreset is not a provider process (no run key); log the
  URL through the caller-visible detail only, and record that decision.
- Any other `fetch(` / `http(s).request` discovered by the grep audit gets
  the rule or a recorded exclusion.

Definition of Done:

- [x] Audit table appended to this file (site -> change or exclusion +
      reason).
- [x] Tests: the launch health-poll logs the URL line before the result and
      the verdict after (stub host fetch); no per-retry spam.
- [x] `pnpm build` and `pnpm test` green.

## Audit table (2026-11-06)

Every host-side URL query the grep audit found (`fetch(`, `http(s).request`,
`http.get`, over all `packages/*/src`):

| Site | Decision |
| --- | --- |
| `packages/providers/src/adapters.ts` `pollHealth` `host.fetch(plan.healthUrl)` (the poll behind NInfer, HyperQwen, llama.cpp, Infernix, Basalt) | **Changed.** The new shared `logHealthPoll` wrap writes one `> GET <healthUrl>` line to the run's log sink before the first request and the settled verdict after (`> GET <url> ready`, or `!! health check failed for <url>: <last detail>`); retries stay silent, so no per-retry spam. When the tracked child exits before the first fetch, the URL line still records what the poll was waiting for, followed by the failed verdict. |
| `packages/providers/src/engines/strata/strataAdapter.ts` `healthCheck` `this.host.fetch(plan.healthUrl)` | **Changed.** Same shared `logHealthPoll` wrap (the rule has one home, no copy-paste), plus the Strata-only verdict: a start still fetching its files settles as `> GET <url> still downloading: <detail>` (in progress, not a `!!` failure). |
| Sink threading: `HealthCheckOptions.onLog` (core), `LaunchOptions` | **Changed.** The health poll's sink rides the existing seam: `LocalInferService.launch` already passes its `LaunchOptions` straight into `adapter.healthCheck(plan, options)` (index.ts ~line 814), and `launchEngine` already threads `onLog: appendRunText` into `localInfer.launch`, so the URL line and verdict land in the launch run text and the live hub with no ui/engine.ts change. |
| `packages/providers/src/adapters.ts` `createNodeLifecycleHost.fetch` | **Exclusion.** The leaf HTTP client behind `LifecycleHost.fetch`; its only production callers are the two health polls above, which own the URL logging. The node `fetch` wrapper itself adds no line (a poll that logs is the caller's job). |
| `packages/service/src/index.ts` `fetchPreset` -> `fetchPage` / `resolveModsearchCli` (the modsearch preset fetch) | **Exclusion from a hub run** (the pre-agreed decision, confirmed by the audit: fetchPreset has no provider-process caller, no `runLogKey`, and is not a provider process). The rule is served through the caller-visible detail instead: a failed fetch now reads `the modsearch fetch failed for <url>: ...`. `resolveModsearchCli`'s `which modsearch` probe is a command, not a URL. |
| `packages/providers/src/engines/strata/strataAdapter.ts` `discoverModel` `curl -fsS http://127.0.0.1:<port>/v1/models` | **Exclusion.** A one-shot read-only probe on the register / save-sync / summary paths (no run key, not a provider process); the URL is already inside the command text, and a failure reads as "discover nothing, fall back to modelRef". No log sink reaches this call. |
| `packages/client/src/api/routes.ts` `fetch(...)` (3 sites) | **Exclusion.** Browser-side card code fetching this plugin's own routes; the host-side audit scope is provider-process URL queries. |
| ui / tool / orchestrator `src` | No `fetch(` / `http(s).request` sites found; nothing to rule or exclude. |

## Append-results gaps carried in from TASK-007 (fixed)

- `get-steps.ts` Infernix extras: the plain-`host.run` fallback now lands the
  child's success output after the `$ <command>` line. Carrier:
  `CommandOutcome.stdout` (core), the tail of the clean exit's combined
  output, capped by the node host's existing `COMMAND_DETAIL_TAIL` (1 KiB)
  tail rule so no huge blob regurgitates. The streaming path is unchanged
  (its chunks already reach the sink; it must not re-append them).
- Adapter deploy-time `host.run` outcomes: `auditRun` appends the outcome's
  success output tail to the log sink after the `$ <command>` line (docker
  pull, deploy-time hf downloads, strata install, compose up, docker stop,
  pid signal). A failed outcome lands no output there; the caller's own
  `!!` line carries the detail's output tail, so nothing duplicates.
  `createNodeLifecycleHost` `run` and `runStream` now carry the capped
  success tail in `outcome.stdout` (a silent clean exit carries none).
- Install settle: `runInstallFor` folds its collected run text (seed, the
  install `$ <command>` lines, the per-dep results, any sudo note) through
  `finishRunSection` over the pre-run baseline in the finally, so the last
  install run survives a card reload in the stored last-run logs and the log
  file (the Get route's pattern; the baseline close keeps a mid-run sudo note
  persisting once). A throwing install persists the partial section.

## Tests added

- `packages/providers/tests/adapters.spec.ts`: pollHealth URL-line-once +
  ready verdict with retried 503s, `!!` failure verdict with no per-retry
  URL lines, silent headless poll; StrataAdapter ready / still-downloading /
  failed verdict lines through the shared wrap; `auditRun` command-then-
  output order, newline normalization, silent-on-failure, headless run;
  `nodeLifecycleHost.run` carries the stdout tail (silent run carries none).
- `packages/ui/tests/route.spec.ts`: Infernix extras with a host that has no
  `runStream` land the success output after the `$ hf download` line; the
  install run's settle text persists to the stored last-run logs.
