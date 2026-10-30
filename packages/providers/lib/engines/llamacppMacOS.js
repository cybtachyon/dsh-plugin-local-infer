/**
 * The llama.cpp macOS build profile. macOS builds llama.cpp through the same
 * cmake route as Linux, so this profile reuses the shared Linux build steps
 * and build directory; the binary keeps its plain name (no .exe on macOS).
 * @module dsh-plugin-local-infer/providers/engines/llamacppMacOS
 */
import { LLAMACPP_LINUX } from "./llamacppLinux.js";
export const LLAMACPP_MACOS = LLAMACPP_LINUX;
/**
 * llamacppMacOSBinary returns the llama.cpp engine binary name on macOS: the
 * plain `llama-server` (no .exe on macOS). The name comes from the shared
 * Linux profile the macOS profile reuses, so the spelling has one home.
 */
export function llamacppMacOSBinary() {
    return LLAMACPP_MACOS.binary ?? 'llama-server';
}
//# sourceMappingURL=llamacppMacOS.js.map