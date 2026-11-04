/**
 * The Orchestrator card: the prompt editor the orchestrator component's
 * configuration page renders.
 *
 * The card owns its own small state (no card store): it loads the model from
 * GET /local-infer/orchestrator on mount, binds the textarea to the local
 * edit (the model's prompt until the first keystroke), and posts the edit to
 * POST /local-infer/orchestrator/save. The save route answers with the fresh
 * model, so the card re-reads prompt and defaultPrompt from one response. An
 * empty saved prompt clears the override back to the shipped prompt.md
 * default (the route's rule), which is what the note under the field says.
 *
 * The bootstrap (plugin.ts) mounts this card only when the orchestrator
 * route exists, which is exactly when the component is enabled; the slot
 * host renders the component with its own props (view, form), which this
 * card ignores: the prompt persists through the orchestrator's own routes,
 * not the host form.
 * @module dsh-plugin-local-infer/client/OrchestratorCard
 */
import type { ReactNode } from 'react';
import { type LocaleRef } from './Card.tsx';
/**
 * orchestratorCard builds the Orchestrator card component. It has the same
 * (react, localeRef) factory shape as the main card(), so the bootstrap
 * resolves the runtime externals once per mount path and hands them in the
 * same way; the button draws the primitives seed through the shared seam.
 */
export declare function orchestratorCard(_react: unknown, localeRef: LocaleRef): () => ReactNode;
//# sourceMappingURL=OrchestratorCard.d.ts.map
