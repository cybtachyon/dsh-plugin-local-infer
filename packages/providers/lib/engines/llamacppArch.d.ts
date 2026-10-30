/**
 * The llama.cpp Arch Linux build profile. Arch builds llama.cpp through the
 * shared Linux route (cmake with the Ninja generator), so this profile reuses
 * the shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/llamacppArch
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const LLAMACPP_ARCH: EngineOsProfile;
//# sourceMappingURL=llamacppArch.d.ts.map