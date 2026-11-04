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
