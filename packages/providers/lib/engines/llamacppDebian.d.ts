/**
 * The llama.cpp Debian build profile. Debian builds llama.cpp through the
 * shared Linux route (cmake with the Ninja generator), so this profile reuses
 * the shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/llamacppDebian
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const LLAMACPP_DEBIAN: EngineOsProfile;
//# sourceMappingURL=llamacppDebian.d.ts.map