/**
 * The llama.cpp Arch Linux build profile. Arch builds llama.cpp through the
 * shared Linux route (cmake with the Ninja generator), so this profile reuses
 * the shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/llamacppArch
 */
import { LLAMACPP_LINUX } from "./llamacppLinux.js";
export const LLAMACPP_ARCH = LLAMACPP_LINUX;
//# sourceMappingURL=llamacppArch.js.map