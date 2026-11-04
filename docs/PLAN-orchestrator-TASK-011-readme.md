# TASK-011: README instructions for the Orchestrator package

Add an "Orchestrator package" section to `README.md`, placed where a reader
learns plugin features (after "Using the plugin"). Cover:

- What it is and why, based on this wording (reworded as needed, meaning kept):

  > Local models often struggle with agentic workflows and can't "One-shot"
  > prompts without assistance. The included "Orchestrator" package gives your
  > models a default prompt that enables that capability. Simply enable the
  > package in the `dsh-plugin-local-infer` plugin settings.

- How to enable: the plugin's entry in the DeepSeek Harness Plugins page,
  "Orchestrator" component (disabled by default at install).
- How to edit: the "Orchestrator" card that appears, its "Orchestrator Prompt"
  field, Save, and that the default text ships in the plugin's `prompt.md`.
- That enabling the component makes the prompt part of the agent's system
  prompt for new requests (no restart needed after Save; a host restart is
  needed after first enabling the component).

Follow the README's existing voice and heading style. Also add the equivalent
Chinese section to `docs/zh/README.md` (decided in the questionnaire).

Definition of Done: both README diffs reviewed against the points above; one
commit (docs only).

## Answered open questions

- zh README in scope: yes, `docs/zh/README.md` gets the Chinese section.
