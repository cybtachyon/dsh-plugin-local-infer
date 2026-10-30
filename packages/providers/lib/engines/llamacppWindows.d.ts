/**
 * The llama.cpp Windows build profile. llama.cpp carries no dedicated Windows
 * build route, so a Windows host reads the shared Linux cmake steps and build
 * directory; the binary is the .exe.
 * @module dsh-plugin-local-infer/providers/engines/llamacppWindows
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const LLAMACPP_WINDOWS: EngineOsProfile;
/**
 * llamacppWindowsBinary returns the llama.cpp engine binary name on Windows:
 * the `llama-server.exe` the Windows build leaves in the build tree. The name
 * comes from the Windows profile, so the .exe spelling has one home.
 */
export declare function llamacppWindowsBinary(): string;
//# sourceMappingURL=llamacppWindows.d.ts.map