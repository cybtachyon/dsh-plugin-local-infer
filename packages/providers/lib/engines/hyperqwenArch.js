/**
 * The Hyper-Qwen Arch Linux build profile. Hyper-Qwen is compose-driven (the
 * compose up pulls the vLLM image), so it carries no local build steps; this
 * profile reuses the shared Linux profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenArch
 */
import { HYPERQWEN_LINUX } from "./hyperqwenLinux.js";
export const HYPERQWEN_ARCH = HYPERQWEN_LINUX;
//# sourceMappingURL=hyperqwenArch.js.map