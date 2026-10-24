/**
 * NInfer parameter surface. The declarative `ParameterSpec` data for the
 * NInfer engine, sourced from `docs/serving.md`, `docs/cli.md`, and the
 * `inference-launcher/qwen-ninfer` script. Each spec carries its form kind,
 * a behavior-first description, the group it renders under, and the `toArgv`
 * spelling that turns a value into a `ninfer-serve` CLI flag.
 *
 * The data is the surface; the `NInferAdapter` (Phase 5) composes it into a
 * `LaunchPlan`. Adding a flag here is a data edit, never a core rewire.
 * @module dsh-plugin-local-infer/providers/ninfer
 */
import type { ComboOption, EnumOption, ParameterSpec } from 'dsh-plugin-local-infer/core';
/**
 * The KV cache quantization formats NInfer serves, in the order the form
 * dropdown lists them. `note` carries the tradeoff text the dropdown shows
 * beside each choice.
 */
export declare const KV_DTYPE_OPTIONS: readonly EnumOption[];
/**
 * The speculative-decoding backends. `none` loads no speculative backend at
 * all, which is the smallest resident profile.
 */
export declare const SPEC_OPTIONS: readonly EnumOption[];
/**
 * The per-GPU kernel-schedule profiles. `auto` uses the stored or built-in
 * profile and calibrates a device that has none.
 */
export declare const DEVICE_PROFILE_OPTIONS: readonly EnumOption[];
/**
 * The chat templates the combo control offers as known choices. The plan
 * ships the popular templates as data, tagged with their source, and the
 * free-text half of the control accepts any local path or HF repo reference.
 */
export declare const CHAT_TEMPLATE_OPTIONS: readonly ComboOption[];
/**
 * The speculation gate message the form shows while draftTokens and
 * lmHeadDraft are greyed out. It names the fix (pick a backend) and the
 * backends that unlock the fields, so a first-time user knows the next
 * click, not just the constraint.
 */
export declare const SPEC_GATE_MESSAGE = "Pick a speculation backend first (mtp, dflash, or dflash2)";
/**
 * The gate message the form shows while the LM-head draft field is greyed out.
 * The LM-head drafter is an MTP-backend feature, so the field unlocks only
 * while the MTP speculation backend is selected, for every provider that
 * spells the flag.
 */
export declare const LM_HEAD_DRAFT_GATE_MESSAGE = "LM-head draft is only available with the MTP speculation backend";
/**
 * The NInfer `ParameterSpec` surface, in form order. The `group` field is the
 * form section; specs without a group render under `General`. `requires`
 * names the cross-parameter dependency in the message the form shows while
 * the field is disabled.
 */
export declare const NINFER_PARAMETERS: readonly ParameterSpec[];
//# sourceMappingURL=ninfer.d.ts.map