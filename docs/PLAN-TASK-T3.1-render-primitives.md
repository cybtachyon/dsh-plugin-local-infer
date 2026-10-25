# T3.1 `src/render/primitives.tsx`.

Port the guarded primitive
renderers: `renderSelect`, `renderButton`, `renderCheckbox`,
`renderStateDot`, `renderThrobber`, `renderProcessButton`,
`renderHelpRow`, and the native-control fallbacks (the
`primitives && typeof primitives.X === 'function'` guards).

**DoD:** typecheck green; `pnpm build` green; GUI unchanged with the
primitives seed present, and unchanged again with the seed removed
(native fallback path).
