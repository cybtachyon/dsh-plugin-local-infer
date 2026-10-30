/**
 * The Hyper-Qwen Debian build profile. Hyper-Qwen is compose-driven (the
 * compose up pulls the vLLM image), so it carries no local build steps; this
 * profile reuses the shared Linux profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenDebian
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const HYPERQWEN_DEBIAN: EngineOsProfile;
//# sourceMappingURL=hyperqwenDebian.d.ts.map