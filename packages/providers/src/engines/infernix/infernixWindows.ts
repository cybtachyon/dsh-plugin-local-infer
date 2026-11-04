/**
 * The Infernix Windows build profile. Infernix builds through the engine's own
 * cmake preset on every platform, so the Windows host reads the same preset
 * route as Linux; the published release zip ships the server and its DLLs, so
 * the binary is the .exe.
 * @module dsh-plugin-local-infer/providers/engines/infernix/infernixWindows
 */

import type { EngineOsProfile } from '../engineOs.ts'
import { INFERNIX_LINUX } from './infernixLinux.ts'
import { SYSTEM_DEPS } from '../../systemDeps.ts'

export const INFERNIX_WINDOWS: EngineOsProfile = {
  buildSteps: INFERNIX_LINUX.buildSteps,
  buildDir: 'build',
  binary: 'infernix-serve.exe',
  // Infernix builds through the engine's own cmake preset, so its Windows
  // local list is the same winget toolchain as NInfer's: CMake, Ninja, the
  // MSVC compiler, the CUDA toolkit, the hf CLI, and git.
  deps: [
    SYSTEM_DEPS.cmake,
    SYSTEM_DEPS.ninja,
    SYSTEM_DEPS.visualStudio,
    SYSTEM_DEPS.cudaToolkit,
    SYSTEM_DEPS.hfCli,
    SYSTEM_DEPS.git,
  ],
}

/**
 * infernixWindowsBinary returns the Infernix engine binary name on Windows:
 * the `infernix-serve.exe` the published release zip ships with its DLLs. The
 * name comes from the Windows profile, so the .exe spelling has one home.
 */
export function infernixWindowsBinary(): string {
  return INFERNIX_WINDOWS.binary ?? 'infernix-serve.exe'
}
