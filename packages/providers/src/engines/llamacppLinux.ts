/**
 * The llama.cpp shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds llama.cpp through this one route: cmake with the Ninja
 * generator into the `build` directory, which is where the `llama-server`
 * binary lands. The distro profiles reuse this profile, so a distro carries no
 * build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/llamacppLinux
 */

import type { EngineOsProfile } from './engineOs.ts'

export const LLAMACPP_LINUX: EngineOsProfile = {
  buildSteps: [
    'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
  ],
  buildDir: 'build',
  binary: 'llama-server',
}

/**
 * llamacppLinuxBinary returns the llama.cpp engine binary name on Linux: the
 * plain `llama-server` (no .exe). The name comes from the shared Linux
 * profile, so the spelling has one home.
 */
export function llamacppLinuxBinary(): string {
  return LLAMACPP_LINUX.binary ?? 'llama-server'
}
