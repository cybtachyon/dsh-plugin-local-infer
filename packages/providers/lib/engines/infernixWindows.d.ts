/**
 * The Infernix Windows build profile. Infernix builds through the engine's own
 * cmake preset on every platform, so the Windows host reads the same preset
 * route as Linux; the published release zip ships the server and its DLLs, so
 * the binary is the .exe.
 * @module dsh-plugin-local-infer/providers/engines/infernixWindows
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const INFERNIX_WINDOWS: EngineOsProfile;
/**
 * infernixWindowsBinary returns the Infernix engine binary name on Windows:
 * the `infernix-serve.exe` the published release zip ships with its DLLs. The
 * name comes from the Windows profile, so the .exe spelling has one home.
 */
export declare function infernixWindowsBinary(): string;
//# sourceMappingURL=infernixWindows.d.ts.map