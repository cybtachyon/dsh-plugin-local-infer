# TASK-003: basalt signature declares its port as config-carried [x]

Declares the basalt launch signature's port as not carried in argv, so the
detector matches a live basalt process without requiring the port number in
its command line.

Files: `packages/providers/src/engines/basalt/basaltAdapter.ts`,
`packages/providers/tests/basalt.spec.ts`.

Changes:

- `launchSignature`: return `{ binary: 'basalt', port, portInArgv: false }`.
  Comment: the serve CLI binds the port from the `basalt_config.json` server
  block, so the argv never carries the number; the port stays the model-tie
  key for the launched-models map.
- Test: the signature names the config port and declares
  `portInArgv: false`; a bare config keeps the default port.

Definition of done: `pnpm vitest run packages/providers/tests/basalt.spec.ts`
passes; `pnpm build` lands the tracked `packages/providers/lib` outputs;
commit.

Depends on: TASK-001.
