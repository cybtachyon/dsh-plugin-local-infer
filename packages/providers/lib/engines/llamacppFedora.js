/**
 * The llama.cpp Fedora build profile. Fedora builds llama.cpp through the
 * shared Linux route (cmake with the Ninja generator), so this profile reuses
 * the shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/llamacppFedora
 */
import { LLAMACPP_LINUX } from "./llamacppLinux.js";
export const LLAMACPP_FEDORA = LLAMACPP_LINUX;
//# sourceMappingURL=llamacppFedora.js.map