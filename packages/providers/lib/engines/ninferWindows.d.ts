/**
 * The NInfer Windows build profile. The Windows route is the ninfer-all fork's
 * vcpkg build: the manifest pulls the dev libraries, then the engine's own
 * build-native.bat configures and builds. The step cds into the checkout first
 * (the {dir} placeholder), because vcpkg install and the relative script path
 * both resolve against the checkout root.
 *
 * The build leaves the engine binary in the Windows build tree, not the Linux
 * build directory: the vcpkg route writes ninfer-serve.exe into
 * build-windows\apps\Release, so the launch step reads the binary from that
 * directory, not from the shared Linux build directory. The launch binary is
 * the path relative to the checkout root (the engine directory the spawn runs
 * in), so the spawn resolves it against the default or override engine dir.
 * @module dsh-plugin-local-infer/providers/engines/ninferWindows
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const NINFER_WINDOWS: EngineOsProfile;
/**
 * ninferWindowsBinary returns the NInfer launch binary on Windows: the path
 * relative to the checkout root (the engine directory the spawn runs in) where
 * the vcpkg build-native route writes the Release binary,
 * `build-windows/apps/Release/ninfer-serve.exe`. The directory and the .exe
 * name both come from the Windows profile, so the build tree and the spelling
 * have one home. `join` keeps the result cross-platform: the host's path module
 * normalizes the separators, so the spawn resolves it on Windows, Linux, and
 * macOS alike.
 */
export declare function ninferWindowsBinary(): string;
//# sourceMappingURL=ninferWindows.d.ts.map