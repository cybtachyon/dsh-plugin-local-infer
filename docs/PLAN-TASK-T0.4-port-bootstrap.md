# T0.4 Port the bootstrap (`plugin.ts` + `index.ts`).

Port `apply`, `registerCard`, `mountCard` (the locale/slots injects, the
404 route probe, the react/primitives require with native-control
fallback) from the current `dsh/client.js` lines 4540-4627 into
`src/plugin.ts`; `src/index.ts` exports `{ apply, inject }`. `Card` is a
placeholder element for now.

**DoD:** `pnpm build` green; `node --check` green; `dsh/client.js`
contains exactly the two runtime `require` calls (the runtime
externals); in the GUI (refresh after `node scripts/e2e-relink.mjs`)
the card slot renders the placeholder without console errors.
