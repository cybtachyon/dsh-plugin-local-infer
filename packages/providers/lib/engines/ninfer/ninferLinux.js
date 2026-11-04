/**
 * The NInfer shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds NInfer through this one route: cmake with the Ninja generator
 * into the `build` directory, which is where the `ninfer-serve` binary lands.
 * The distro profiles reuse this profile, so a distro carries no build steps of
 * its own.
 * @module dsh-plugin-local-infer/providers/engines/ninfer/ninferLinux
 */
import { SYSTEM_DEPS } from "../../systemDeps.js";
export const NINFER_LINUX = {
    buildSteps: [
        'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
    ],
    buildDir: 'build',
    binary: 'ninfer-serve',
    // The Linux local build needs the compile toolchain (cmake, ninja), the
    // ffmpeg and curl dev libraries (pkg-config, ffmpeg, curl), the CUDA
    // toolkit, and the hf CLI to download the model.
    deps: [
        SYSTEM_DEPS.cmake,
        SYSTEM_DEPS.ninja,
        SYSTEM_DEPS.pkgConfig,
        SYSTEM_DEPS.ffmpeg,
        SYSTEM_DEPS.curl,
        SYSTEM_DEPS.cudaToolkit,
        SYSTEM_DEPS.hfCli,
    ],
};
/**
 * ninferLinuxBinary returns the NInfer engine binary name on Linux: the plain
 * `ninfer-serve` (no .exe). The name comes from the shared Linux profile, so
 * the spelling has one home.
 */
export function ninferLinuxBinary() {
    return NINFER_LINUX.binary ?? 'ninfer-serve';
}
//# sourceMappingURL=ninferLinux.js.map
