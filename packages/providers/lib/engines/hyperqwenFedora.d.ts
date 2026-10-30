/**
 * The Hyper-Qwen Fedora build profile. Hyper-Qwen is compose-driven (the
 * compose up pulls the vLLM image), so it carries no local build steps; this
 * profile reuses the shared Linux profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenFedora
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const HYPERQWEN_FEDORA: EngineOsProfile;
//# sourceMappingURL=hyperqwenFedora.d.ts.map