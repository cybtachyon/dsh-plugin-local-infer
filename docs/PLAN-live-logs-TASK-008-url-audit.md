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

- [ ] Audit table appended to this file (site -> change or exclusion +
      reason).
- [ ] Tests: the launch health-poll logs the URL line before the result and
      the verdict after (stub host fetch); no per-retry spam.
- [ ] `pnpm build` and `pnpm test` green.
