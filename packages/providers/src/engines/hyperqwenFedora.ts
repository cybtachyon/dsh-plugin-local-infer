/**
 * The Hyper-Qwen Fedora build profile. Hyper-Qwen is compose-driven (the
 * compose up pulls the vLLM image), so it carries no local build steps; this
 * profile reuses the shared Linux profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenFedora
 */

import type { EngineOsProfile } from './engineOs.ts'
import { HYPERQWEN_LINUX } from './hyperqwenLinux.ts'

export const HYPERQWEN_FEDORA: EngineOsProfile = HYPERQWEN_LINUX
