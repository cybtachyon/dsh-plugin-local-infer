# TASK-001b: Fix the pre-existing basalt spec failure (plan interlude)

Pre-existing at blueprint commit 12b7ab1 (reported by TASK-001, re-verified
at f547adf): `pnpm test` fails in
`packages/providers/tests/basalt.spec.ts`, test "Basalt OS profiles > spells
the README CMake commands for the Linux and Windows routes" (line ~214). The
spec expects `BASALT_LINUX.buildSteps` to end with
`… && sudo python3 -m pip install -r {dir}/requirements.txt`; commit fc68df6
"fix(providers): Basalt prereqs now use full deps" removed that pip step from
`packages/providers/src/engines/basalt/basaltLinux.ts` without updating the
spec.

Fix by intent, not by whichever side is shorter to edit:

- Read the fc68df6 diff and message. If moving the requirements install into
  the full-deps prereqs was deliberate (likely: the commit title says so),
  update the spec's expected Linux buildSteps, its comment, and check whether
  the Windows route expectation in the same test still matches
  `basaltWindows.ts`; the lib artifacts must be rebuilt (`pnpm build`) only
  if sources change.
- If the source lost the step by accident, restore it in the source instead.
- Also note (from TASK-001): vitest hides the coverage summary on test
  failure (`coverage.reportOnFailure` default); no config change is required
  by this task.

Definition of Done: `pnpm vitest run packages/providers/tests/basalt.spec.ts`
passes and repo-wide `pnpm test` is green; one commit.

## Answered open questions

(none specific to this task)
