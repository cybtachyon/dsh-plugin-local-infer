/**
 * The Basalt shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Basalt through the engine's own CMake route: configure a
 * Release build into the `build` directory, then compile it. The `basalt`
 * binary lands in that directory. The distro profiles reuse this profile, so
 * a distro carries no build steps of its own.
 *
 * Basalt is Blackwell-only (sm_120): the engine is compiled for the NVIDIA
 * Blackwell GPU, so the CUDA 13 toolkit and a C++20 compiler are hard
 * requirements. The Python 3.10+ interpreter runs the serve/ server and its
 * pip requirements, and the hf CLI downloads the .basalt model artifact.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltLinux
 */

import type { EngineOsProfile } from '../engineOs.ts'
import { SYSTEM_DEPS } from '../../systemDeps.ts'

export const BASALT_LINUX: EngineOsProfile = {
  buildSteps: [
    'cmake -S {dir} -B {dir}/build -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
  ],
  buildDir: 'build',
  binary: 'basalt',
  // The local build is the engine's own CMake route: the CMake toolchain, the
  // C++20 compiler, the CUDA 13 toolkit (Blackwell-only), the Python 3.10+
  // interpreter for the serve/ server, and the hf CLI to download the model.
  deps: [
    SYSTEM_DEPS.cmake,
    SYSTEM_DEPS.compiler,
    SYSTEM_DEPS.cudaToolkit,
    SYSTEM_DEPS.python,
    SYSTEM_DEPS.hfCli,
  ],
}

/**
 * basaltLinuxBinary returns the Basalt engine binary name on Linux: the plain
 * `basalt` (no .exe). The name comes from the shared Linux profile, so the
 * spelling has one home.
 */
export function basaltLinuxBinary(): string {
  return BASALT_LINUX.binary ?? 'basalt'
}
