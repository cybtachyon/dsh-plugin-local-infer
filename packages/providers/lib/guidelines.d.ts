/**
 * Built-in hardware guidelines. The rules that every engine shares, expressed
 * as `Guideline` data over (config, hardware): the docker-availability gate,
 * the host RAM tier ceiling, and the WSL2 pin-memory boot abort. Each is
 * registered with `ctx.localInfer` by the provider `apply`, so a per-engine
 * override or an extra rule composes on top without touching these.
 *
 * The rules that need the registered VramModel (the estimator-backed
 * "exceeds usable VRAM" and "spec needs draft weights" rules) live in the
 * core `modelGuidelines` and run in the service, because they price against
 * a model, not against the hardware alone.
 * @module @dsh/dsh-plugin-local-infer/providers/guidelines
 */
import type { Guideline } from '@dsh/dsh-plugin-local-infer/core';
/**
 * One pinned Host StateImage, in bytes. The NInfer measured figure for the
 * 27B artifact (195,897,344 B, the README's Host StateImage size), used as
 * the per-slot cost the host RAM rule sums. A StateImage costs this much
 * regardless of the prefix depth it resumes, so the slot count, not the
 * context length, is what pins host RAM.
 */
export declare const HOST_STATE_IMAGE_BYTES = 195897344;
/**
 * The built-in guideline set, in the order the panel lists them. Levels:
 * `error` for a state the engine cannot boot from, `warn` for a state that
 * degrades before it breaks.
 */
export declare const BUILTIN_GUIDELINES: readonly Guideline[];
//# sourceMappingURL=guidelines.d.ts.map