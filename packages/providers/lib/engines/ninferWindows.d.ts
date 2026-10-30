/**
 * The NInfer Windows build profile. The Windows route is the ninfer-all fork's
 * vcpkg build: the manifest pulls the dev libraries, then the engine's own
 * build-native.bat configures and builds. The step cds into the checkout first
 * (the {dir} placeholder), because vcpkg install and the relative script path
 * both resolve against the checkout root.
 *
 * The build leaves the engine binary in the Windows build tree, not the Linux
 * build directory: the vcpkg route writes ninfer-serve.exe into
 * build-windows\apps\Release, so the symlink step and the launch step read the
 * binary from that directory, not from the shared Linux build directory.
 * @module dsh-plugin-local-infer/providers/engines/ninferWindows
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const NINFER_WINDOWS: EngineOsProfile;
/**
 * ninferWindowsBinary returns the NInfer engine binary name on Windows: the
 * `ninfer-serve.exe` the vcpkg build-native route writes into the Windows build
 * tree. The name comes from the Windows profile, so the .exe spelling has one
 * home.
 */
export declare function ninferWindowsBinary(): string;
//# sourceMappingURL=ninferWindows.d.ts.map