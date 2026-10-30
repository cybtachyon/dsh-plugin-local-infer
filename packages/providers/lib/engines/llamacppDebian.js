/**
 * The llama.cpp Debian build profile. Debian builds llama.cpp through the
 * shared Linux route (cmake with the Ninja generator), so this profile reuses
 * the shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/llamacppDebian
 */
import { LLAMACPP_LINUX } from "./llamacppLinux.js";
export const LLAMACPP_DEBIAN = LLAMACPP_LINUX;
//# sourceMappingURL=llamacppDebian.js.map