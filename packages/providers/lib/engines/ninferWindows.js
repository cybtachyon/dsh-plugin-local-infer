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
import { join } from 'node:path';
export const NINFER_WINDOWS = {
    buildSteps: [
        '$env:PATH="C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\vcpkg;$env:PATH"; $env:NINFER_VCPKG_ROOT="C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\vcpkg"; cd {dir} && vcpkg install && .\\scripts\\build-native.bat configure && .\\scripts\\build-native.bat build && .\\scripts\\build-native.bat build',
    ],
    // The vcpkg build-native route writes the Release binary into the Windows
    // build tree, not the Linux build directory the shared route uses. The
    // separators are forward slashes (valid on every platform) so the directory
    // joins cross-platform; the host's path module normalizes them on use.
    buildDir: 'build-windows/apps/Release',
    binary: 'ninfer-serve.exe',
    shell: 'pwsh.exe'
};
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
export function ninferWindowsBinary() {
    const binary = NINFER_WINDOWS.binary ?? 'ninfer-serve.exe';
    const buildDir = NINFER_WINDOWS.buildDir;
    return buildDir !== undefined ? join(buildDir, binary) : binary;
}
//# sourceMappingURL=ninferWindows.js.map