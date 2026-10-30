/**
 * The Strata Arch Linux build profile. Arch builds Strata through the shared
 * Linux route (the engine's own setup.sh), so this profile reuses the shared
 * Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/strataArch
 */

import type { EngineOsProfile } from './engineOs.ts'
import { STRATA_LINUX } from './strataLinux.ts'

export const STRATA_ARCH: EngineOsProfile = STRATA_LINUX
