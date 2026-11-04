# TASK-005: Basalt build-step test (pre-existing failure)

Pre-existing issue discovered by the TASK-001 subagent:
`packages/providers/tests/basalt.spec.ts` "spells the README CMake commands
for the Linux and Windows routes" fails on a clean tree. The test expects
`BASALT_LINUX.buildSteps` to be exactly
`['cmake -S {dir} -B {dir}/build -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j']`,
but the provider data (intentionally extended by the basalt launch-hang fix,
and path-pinned by the requirements fix) now reads
`'cmake -S {dir} -B {dir}/build -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j && uv pip install -r {dir}/requirements.txt'`.

The provider data is the source of truth (the serve-deps step is deliberate;
the dep plan carries `basalt-pip`). Update the stale test expectation to
match the data.

Definition of Done: `pnpm test` is fully green (the basalt spec included);
`pnpm build` passes; the fix is committed.
