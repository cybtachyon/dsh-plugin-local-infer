# TASK-012: Activation walkthrough and end-to-end verification

Verify the shipped behavior as far as this environment allows; record results
in this task file.

1. Default-off proof: with the repo profile install (symlinked) and the
   profile patch layer carrying no `local-infer-orchestrator` override, a
   restarted host loads the component off. Check the profile patch files under
   `~/.dsh/profiles/<profile>/` for an absence of an enabling override, and
   (if a dsh host is running and reachable) probe
   `GET http://127.0.0.1:3080/local-infer/orchestrator` expecting 404.
2. Enablement path proof: confirm through the component row (id
   `local-infer-orchestrator`) that enabling writes the profile override and
   the route answers after a host restart; if the live host cannot be
   restarted from this session, perform the equivalent check by mounting all
   five bundle rows (orchestrator included) into one Cordis `Context` in a
   scratch vitest run and probing the route handlers with the ui test
   harness.
3. Card proof: after `pnpm build` and a page refresh, confirm
   `dsh/client.js` is served and, in a browser-less check, confirm the
   bundle exports the orchestrator card wiring (grep the artifact for the
   title/field strings).
4. Leave a concise manual checklist (enable component → restart host →
   refresh page → card appears → edit + Save → systemPrompt carries it) at
   the bottom of this file for the human to run in the GUI.

Definition of Done: each numbered proof recorded as PASS, or BLOCKED with the
concrete environmental reason; scratch verification files deleted; no code
changes except fixes for defects found here (committed separately).

## Answered open questions

(none specific to this task)

## Results (2026-11-04)

Environment: the live `dsh web` host (PID 1636545, started 2026-11-04
02:20:38) is the process serving this session at 127.0.0.1:3080; it cannot be
restarted from this session without ending the session. The profile install
`~/.dsh/profiles/web/node_modules/dsh-plugin-local-infer` symlinks the repo.

1. Default-off proof: PASS.
   - `~/.dsh/profiles/web/cordis.patch.yml` (the only profile patch layer)
     carries no `local-infer-orchestrator` row, so nothing overrides the
     bundle row.
   - Both shipped copies (`cordis.patch.yml` and
     `packages/bundle/cordis.patch.yml`) declare
     `id: local-infer-orchestrator` with `disabled: true` (asserted by
     `packages/bundle/tests/bundle.spec.ts`).
   - Live probe `GET http://127.0.0.1:3080/local-infer/orchestrator` answers
     404, while the ui component's `GET /local-infer/summary` and
     `GET /local-infer/deps` answer 200: the webServer seam is up and the
     orchestrator route is absent, not the server. `~/.dsh/local-infer/`
     holds no `orchestrator.json` (the component never ran).
   - Caveat (not a defect): that host booted 02:20, before TASK-006 (02:57)
     added the row, so the live 404 proves the route is unmounted but not
     yet the `disabled: true` row semantics; the next host restart (manual
     checklist step 1) is the definitive live off-state proof.

2. Enablement path proof: PASS via the sanctioned equivalent.
   - The GUI toggle mechanism was read in the running host's code:
     `writePluginEnabled` in `@deepseek-ai/dsh-plugin-manager` writes the
     `disabled` scalar into the profile patch layer (`cordis.patch.yml`) on
     the entry found by `id` (with `name` match), appending `{id, disabled}`
     when no override row exists, and skips the write only when the
     composed lower layers already imply the requested value (they do not
     here: the shipped row is `disabled: true`). So enabling the
     `local-infer-orchestrator` component row writes an enabling profile
     override.
   - Live toggle + restart was not executed: the toggle would mutate the
     user's live profile and the restart would kill this session's host.
   - Equivalent check run in a scratch vitest spec
     (`packages/bundle/tests/task012-scratch.spec.ts`, deleted after the
     run): all five bundle rows (service, providers, tool, ui, orchestrator)
     mounted into one Cordis `Context` with the webServer/systemPrompt seams
     stood in by fakes; the mount asserted `ctx.localInfer` composed, the ui
     routes and both orchestrator routes registered, and one `orchestrator`
     systemPrompt section (order 100). Route probes with the ui fake req/res
     harness: `GET /local-infer/orchestrator` answered 200 with the shipped
     `prompt.md` default and `saved: false`; the save round-trip persisted
     (scratch `HOME` only) and the section text provider followed the holder;
     a blank save cleared back to the default. Scratch file deleted; the
     real `~/.dsh/local-infer/` untouched; full suite after deletion: 78
     files, 1412 tests, all green.

3. Card proof: PASS (browserless) + BLOCKED (live HTTP fetch).
   - `pnpm build` regenerated `dsh/client.js` (140314 bytes) leaving the git
     tree clean: the committed artifact matches the current sources.
   - Browserless grep of `dsh/client.js`: "Orchestrator Prompt" x1,
     `/local-infer/orchestrator` x3 (route probe + save + card), the
     `plugins.row.config` slot injection x2 keyed
     `PACKAGE_NAME + "#local-infer-orchestrator"`, "Orchestrator" x10,
     `defaultPrompt` x1.
   - Live fetch of the card over HTTP: BLOCKED with two concrete reasons.
     (a) The `/plugins` combo/chunk route only serves URLs whose `rev` was
     advertised at boot; revs hash the artifact's file metadata captured at
     host composition, and the boot manifest that carries them lives behind
     the authenticated index (`/` and `/api/boot` answer 401 to this
     session). (b) The live host composed its client graph at 02:20, before
     the card artifact existed (TASK-008, 03:13), and no HMR watch is
     installed, so its graph still holds the pre-card bytes. Both resolve
     with the host restart in the checklist below.

## Manual activation checklist (for the human, in the GUI)

1. Restart the dsh host (or toggle the bundle off/on). Confirm the
   Orchestrator row is OFF on the Plugins page and
   `GET http://127.0.0.1:3080/local-infer/orchestrator` still answers 404
   (curl) before enabling anything.
2. Plugins page → dsh-plugin-local-infer → Components → enable
   `local-infer-orchestrator`. `~/.dsh/profiles/web/cordis.patch.yml` gains
   a `local-infer-orchestrator` row with `disabled: false`.
3. Restart the host (host half: routes + systemPrompt section), then refresh
   the page (client half: the new `dsh/client.js` rev).
4. The plugin's Orchestrator row shows its Configure control exactly once;
   open it. The Engine settings card is unchanged (no slot displacement).
5. `curl http://127.0.0.1:3080/local-infer/orchestrator` answers 200 with
   `{prompt, defaultPrompt, saved: false}`.
6. Edit the prompt, Save. `~/.dsh/local-infer/orchestrator.json` appears
   with the saved text; the GET answers `saved: true`.
7. Start a new session (or trigger a prompt assembly) and confirm the
   system prompt carries the `orchestrator` section with the saved text
   (order 100, after the persona, before policy sections).
8. Clear the field, Save: the file holds `{"prompt": ""}` and the GET
   answers the shipped default with `saved: false`. To return to factory
   state, disable the component row again.
