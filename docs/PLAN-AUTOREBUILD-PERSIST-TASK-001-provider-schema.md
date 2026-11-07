# TASK-001 - Stored provider schema: per-provider autoRebuild

Add the stored field so each provider configuration carries its own Auto Rebuild
value.

- File: `packages/ui/src/config.ts`.
- Add `autoRebuild?: boolean` to `StoredProviderConfig` (sibling of `platform`,
  documented as the card's Auto Rebuild checkbox stored per provider; a missing
  key means the card treats the provider as unchecked).
- In `parseProviders`, keep the value only when `typeof fields.autoRebuild ===
  'boolean'` (a by-hand edit with a non-boolean is dropped, same discipline as
  the other keys).
- DoD: `packages/ui/tests` config round-trip test: a written `autoRebuild:
  false` reads back false; a missing key stays absent; a non-boolean is dropped.
  `pnpm build` emits the tracked `lib/` outputs in the same commit.
