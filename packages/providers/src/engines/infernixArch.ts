/**
 * The Infernix Arch Linux build profile. Arch builds Infernix through the
 * shared Linux route (the engine's own cmake preset), so this profile reuses
 * the shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/infernixArch
 */

import type { EngineOsProfile } from './engineOs.ts'
import { INFERNIX_LINUX } from './infernixLinux.ts'

export const INFERNIX_ARCH: EngineOsProfile = INFERNIX_LINUX
