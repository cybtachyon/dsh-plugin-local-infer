/**
 * The NInfer macOS build profile. macOS builds NInfer through the same cmake
 * route as Linux, so this profile reuses the shared Linux build steps and
 * build directory; the binary keeps its plain name (no .exe on macOS).
 * @module dsh-plugin-local-infer/providers/engines/ninferMacOS
 */
import { NINFER_LINUX } from "./ninferLinux.js";
export const NINFER_MACOS = NINFER_LINUX;
/**
 * ninferMacOSBinary returns the NInfer engine binary name on macOS: the plain
 * `ninfer-serve` (no .exe on macOS). The name comes from the shared Linux
 * profile the macOS profile reuses, so the spelling has one home.
 */
export function ninferMacOSBinary() {
    return NINFER_MACOS.binary ?? 'ninfer-serve';
}
//# sourceMappingURL=ninferMacOS.js.map