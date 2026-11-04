/**
 * The Basalt Windows build profile. The Windows route is the engine's own
 * CMake build with the Ninja generator, run inside the MSVC developer shell:
 * the step calls vcvars64.bat (the Visual Studio 2022 Community C++ toolchain)
 * to put cl, cmake, and ninja on the path, then configures a Release build
 * into the `build` directory and compiles it. The `basalt.exe` binary lands in
 * that directory.
 *
 * The Windows toolchain is the winget route: CMake, Ninja (the -G Ninja
 * generator), the Visual Studio C++ workload (the MSVC C++20 compiler), the
 * CUDA 13 toolkit (Blackwell-only), the Python 3.10+ interpreter for the
 * serve/ server, and the hf CLI to download the model.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltWindows
 */

import type { EngineOsProfile } from '../engineOs.ts'
import { SYSTEM_DEPS } from '../../systemDeps.ts'

export const BASALT_WINDOWS: EngineOsProfile = {
  buildSteps: [
    'cmd /c "call "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" && cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j"',
  ],
  buildDir: 'build',
  binary: 'basalt.exe',
  // The Windows local build is the winget route: the CMake toolchain, Ninja
  // (the -G Ninja generator), the Visual Studio C++ workload (the MSVC C++20
  // compiler), the CUDA 13 toolkit (Blackwell-only), the Python 3.10+
  // interpreter for the serve/ server, and the hf CLI to download the model.
  deps: [
    SYSTEM_DEPS.cmake,
    SYSTEM_DEPS.ninja,
    SYSTEM_DEPS.visualStudio,
    SYSTEM_DEPS.cudaToolkit,
    SYSTEM_DEPS.python,
    SYSTEM_DEPS.hfCli,
  ],
}

/**
 * basaltWindowsBinary returns the Basalt launch binary on Windows: the plain
 * `basalt.exe` the Windows build leaves in the `build` directory. The name
 * comes from the Windows profile, so the .exe spelling has one home.
 */
export function basaltWindowsBinary(): string {
  return BASALT_WINDOWS.binary ?? 'basalt.exe'
}
