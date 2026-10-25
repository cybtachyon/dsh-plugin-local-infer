# T2.1 `src/store/types.ts`.

Define `CardState` (per the schema in
"Store invariants": `summary`, `summaryNote`, `draft`, `dirty`,
`launch`, `actions`, `templateActions`, `deps`, `notes`, `ui`),
`ActionState` (`{ status: 'idle' | 'pending' | 'ok' | 'error';
detail: string }`), `ActionKey`, and the reducer action union.

**DoD:** typecheck green with `noUnusedLocals`; no `any` anywhere in
the file.
