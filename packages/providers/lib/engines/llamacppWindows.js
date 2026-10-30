/**
 * The llama.cpp Windows build profile. llama.cpp carries no dedicated Windows
 * build route, so a Windows host reads the shared Linux cmake steps and build
 * directory; the binary is the .exe.
 * @module dsh-plugin-local-infer/providers/engines/llamacppWindows
 */
import { LLAMACPP_LINUX } from "./llamacppLinux.js";
export const LLAMACPP_WINDOWS = {
    buildSteps: LLAMACPP_LINUX.buildSteps,
    buildDir: 'build',
    binary: 'llama-server.exe',
};
/**
 * llamacppWindowsBinary returns the llama.cpp engine binary name on Windows:
 * the `llama-server.exe` the Windows build leaves in the build tree. The name
 * comes from the Windows profile, so the .exe spelling has one home.
 */
export function llamacppWindowsBinary() {
    return LLAMACPP_WINDOWS.binary ?? 'llama-server.exe';
}
//# sourceMappingURL=llamacppWindows.js.map