/**
 * The Basalt macOS build profile. Basalt is Blackwell-only (sm_120), and macOS
 * ships no NVIDIA Blackwell GPU, so the engine cannot run there; the hardware
 * constraint on the `gpu` spec fires for every macOS host. The profile exists
 * for registry completeness and reuses the shared Linux CMake route, so a
 * macOS host reads the same build steps and toolchain list.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltMacOS
 */

import type { EngineOsProfile } from '../engineOs.ts'
import { BASALT_LINUX, basaltLinuxBinary } from './basaltLinux.ts'

export const BASALT_MACOS: EngineOsProfile = BASALT_LINUX

/**
 * basaltMacOSBinary returns the Basalt engine binary name on macOS: the plain
 * `basalt` (no .exe), reusing the shared Linux route. The name comes from the
 * shared Linux profile, so the spelling has one home.
 */
export function basaltMacOSBinary(): string {
  return basaltLinuxBinary()
}
