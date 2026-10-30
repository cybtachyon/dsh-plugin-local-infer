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

import type { EngineOsProfile } from './engineOs.ts'

export const NINFER_WINDOWS: EngineOsProfile = {
  buildSteps: [
    'cd {dir} && vcpkg install && .\\scripts\\build-native.bat configure && .\\scripts\\build-native.bat build',
  ],
  // The vcpkg build-native route writes the Release binary into the Windows
  // build tree, not the Linux build directory the shared route uses.
  buildDir: 'build-windows\\apps\\Release',
  binary: 'ninfer-serve.exe',
}

/**
 * ninferWindowsBinary returns the NInfer engine binary name on Windows: the
 * `ninfer-serve.exe` the vcpkg build-native route writes into the Windows build
 * tree. The name comes from the Windows profile, so the .exe spelling has one
 * home.
 */
export function ninferWindowsBinary(): string {
  return NINFER_WINDOWS.binary ?? 'ninfer-serve.exe'
}
