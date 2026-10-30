/**
 * The NInfer Debian build profile. Debian builds NInfer through the shared
 * Linux route (cmake with the Ninja generator), so this profile reuses the
 * shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/ninferDebian
 */

import type { EngineOsProfile } from './engineOs.ts'
import { NINFER_LINUX } from './ninferLinux.ts'

export const NINFER_DEBIAN: EngineOsProfile = NINFER_LINUX
