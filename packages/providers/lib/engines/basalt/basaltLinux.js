/**
 * The Basalt shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Basalt through the engine's own CMake route: configure a
 * Release build into the `build` directory, then compile it. CMake sets the
 * target's RUNTIME_OUTPUT_DIRECTORY to the repo's `bin` folder, so the
 * `basalt` binary lands in `bin/`, not the CMake `build/` tree. The distro
 * profiles reuse this profile, so a distro carries no build steps of its own.
 *
 * Basalt is Blackwell-only (sm_120): the engine is compiled for the NVIDIA
 * Blackwell GPU, so the CUDA 13 toolkit and a C++20 compiler are hard
 * requirements. The serve/ server's pip requirements install into the system
 * Python, and the hf CLI downloads the .basalt model artifact.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltLinux
 */
import { SYSTEM_DEPS } from "../../systemDeps.js";
export const BASALT_LINUX = {
    buildSteps: [
        'cmake -S {dir} -B {dir}/build -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j && sudo python3 -m pip install -r {dir}/requirements.txt',
    ],
    // The CMake target sets RUNTIME_OUTPUT_DIRECTORY to the repo's bin/ folder,
    // so the basalt executable lands in bin/, not the CMake build/ tree.
    buildDir: 'bin',
    binary: 'basalt',
    // The local build is the engine's own CMake route: the CMake toolchain, the
    // C++20 compiler, the CUDA 13 toolkit (Blackwell-only), the serve/
    // server's pip requirements in the system Python, and the hf CLI to
    // download the model.
    deps: [
        SYSTEM_DEPS.cmake,
        SYSTEM_DEPS.compiler,
        SYSTEM_DEPS.cudaToolkit,
        // The serve/ server is Python; its pip requirements land in the system
        // Python the serve CLI falls back to, so the launch's health poll does not
        // time out on a missing module import.
        SYSTEM_DEPS.basaltPip,
        SYSTEM_DEPS.hfCli,
    ],
};
/**
 * basaltLinuxBinary returns the Basalt engine binary name on Linux: the plain
 * `basalt` (no .exe). The name comes from the shared Linux profile, so the
 * spelling has one home.
 */
export function basaltLinuxBinary() {
    return BASALT_LINUX.binary ?? 'basalt';
}
//# sourceMappingURL=basaltLinux.js.map
