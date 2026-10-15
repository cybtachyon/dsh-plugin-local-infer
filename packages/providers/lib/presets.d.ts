/**
 * Built-in preset data for the local-inference defaults layer. The presets are
 * the offline floor the DefaultsResolver resolves against: the NInfer
 * measured configs (the `config-calculator.html` figures and the
 * `qwen-ninfer` launcher, on a 24 GiB sm86 card) and the Hyper-Qwen `.env`
 * profiles (the single-user speed, long-context, and huge-context tiers from
 * `.env.example`). Each preset is keyed by its exact (engine, model, hardware
 * class) triple, so it is only trusted for the hardware it was sourced for.
 *
 * The `PRESET_SOURCES` list names the mod-search fetch path: the URL the
 * bridge pulls and the pure extractor that turns the fetched page into a
 * preset. The service runs the fetch and tags the result with the URL and the
 * fetch date.
 * @module dsh-plugin-local-infer/providers/presets
 */
import type { Config, Preset, PresetSource } from 'dsh-plugin-local-infer/core';
/**
 * BUILTIN_PRESETS is the combined preset list the providers register with the
 * seam. Adding a preset is a data edit here, never a resolver change.
 */
export declare const BUILTIN_PRESETS: readonly Preset[];
/**
 * extractJsonBlock reads the first fenced ```json block out of a fetched page
 * and parses it as the preset values. A page with no json block (or a broken
 * one) extracts an empty config, which the resolver reads as "the preset
 * contributed nothing" rather than a guess.
 */
export declare function extractJsonBlock(content: string): Config;
/**
 * PRESET_SOURCES names the mod-search fetch path: the NInfer docs source the
 * bridge pulls to refresh the 24 GiB sm86 preset. The extractor reads the json
 * block the docs embed, so a page without one degrades to an empty config.
 */
export declare const PRESET_SOURCES: readonly PresetSource[];
//# sourceMappingURL=presets.d.ts.map