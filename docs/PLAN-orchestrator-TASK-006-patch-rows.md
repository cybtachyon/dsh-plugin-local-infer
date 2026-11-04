# TASK-006: Mount the component disabled-by-default in the bundle patch

Add one row to BOTH `cordis.patch.yml` (repo root) and
`packages/bundle/cordis.patch.yml`, keeping the two files' row sets identical
(their comments may differ):

```yaml
    # Orchestrator: the opt-in "Orchestrator" card and its system-prompt
    # injection. Ships disabled: the Plugins page Components toggle writes the
    # enabling override in the user's profile patch layer.
    - id: local-infer-orchestrator
      name: 'dsh-plugin-local-infer/orchestrator'
      disabled: true
```

- `disabled: true` is a first-class loader EntryOptions field
  (cordis-plugin-loader `config/entry.ts`), so a fresh install loads the
  component off; the GUI enable writes `disabled: false` for the same row `id`
  at the profile layer (last write per row wins).
- Update `packages/bundle/tests/bundle.spec.ts` (and its title/comments):
  mount the orchestrator plugin as a fifth row; parse both patch files and
  assert the fifth declared row carries `disabled: true` in both copies and
  that the two files declare the same row ids.
- `pnpm install` after adding the bundle dependency (TASK-001) so the patch
  resolves from the profile-style layout.

Definition of Done: `pnpm test` passes with the updated bundle spec; both
patch files carry the row; one commit.

## Answered open questions

(none specific to this task)
