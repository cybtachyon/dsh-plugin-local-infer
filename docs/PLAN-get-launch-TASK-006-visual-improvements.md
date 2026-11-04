# TASK-006: Recommend visual improvements for long build/download steps

## Context

The build and download steps take a long time (the Basalt model is 100GB+). The
user wants visual updates, especially in the provider title bar, so a long
download does not look frozen.

## Work

Produce a concrete set of visual-improvement recommendations (scope per the
questionnaire answer): a progress indicator in the provider title bar during a
long download (bytes/percent/ETA from the `hf` stream), a per-step status line
in the Logs section (which of the five Get steps is running), a cancel
affordance, and any DSH UI primitive (`@deepseek-ai/dsh-client-ui-primitives`)
that fits (StateDot, Progress, Tag, etc.). If the scope is "implement the top
1-2", implement the highest-value ones (title-bar progress + current-step
label) and keep the rest as recommendations.

## Definition of Done

- A written recommendations list (in this task file and echoed in the final
  message) covering: title-bar progress during long downloads, current-Get-step
  indicator, cancel affordance, and the matching DSH primitives.
- If the scope includes implementation: the top 1-2 are implemented,
  `pnpm build`/`pnpm test`/`pnpm lint` pass, and the change is verified through
  the host-restart path.
