/**
 * Hyper-Qwen parameter surface. The declarative `ParameterSpec` data for the
 * Hyper-Qwen (vLLM) engine, sourced from `.env.example`,
 * `docker-compose.yml`, and the `single-user`/`batch` start scripts. The
 * concepts mirror the NInfer surface; the spelling is a `.env` key the
 * `HyperQwenAdapter` (Phase 5) writes into the compose environment.
 * @module @dsh/dsh-plugin-local-infer/providers/hyperqwen
 */
import type { EnumOption, ParameterSpec } from '@dsh/dsh-plugin-local-infer/core';
/**
 * The speculative-decoding backends Hyper-Qwen serves. The launcher's own
 * default is `mtp`; the single-user speed profile sets `dflash2`.
 */
export declare const SPEC_OPTIONS: readonly EnumOption[];
/**
 * The context profiles. `fast` is the 64k default; `long` trades decode rate
 * for ~150k; `huge` uses the KVarN 4/2-bit KV cache for 240k.
 */
export declare const CTX_OPTIONS: readonly EnumOption[];
/**
 * The KV cache formats the vLLM engine serves. `fp8` is the batch default;
 * `kvarn` is the 4/2-bit cache the `huge` profile uses.
 */
export declare const KV_OPTIONS: readonly EnumOption[];
/**
 * The Hyper-Qwen `ParameterSpec` surface, in form order. Every spec's `toEnv`
 * is the `.env` key the compose file passes straight into the container; the
 * adapter composes them into the launch plan.
 */
export declare const HYPERQWEN_PARAMETERS: readonly ParameterSpec[];
//# sourceMappingURL=hyperqwen.d.ts.map