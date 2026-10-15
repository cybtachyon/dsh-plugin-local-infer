/**
 * Strata parameter surface. Strata is the placeholder engine: the plan names
 * it as a docker-only engine whose parameter data lands when the engine is
 * available. The surface is empty until then, so the form renders no fields
 * and the adapter renders a bare docker plan; adding a spec here is a data
 * edit, never an adapter rewire.
 * @module dsh-plugin-local-infer/providers/strata
 */
/**
 * The Strata `ParameterSpec` surface, empty until the engine's flag set lands.
 * The `StrataAdapter` composes this (currently nothing) into a docker plan.
 */
export const STRATA_PARAMETERS = [];
//# sourceMappingURL=strata.js.map