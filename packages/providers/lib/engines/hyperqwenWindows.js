/**
 * The Hyper-Qwen Windows build profile. Hyper-Qwen is compose-driven (the
 * compose up pulls the vLLM image), so it carries no local build steps on any
 * platform; this profile reuses the shared Linux profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenWindows
 */
import { HYPERQWEN_LINUX } from "./hyperqwenLinux.js";
export const HYPERQWEN_WINDOWS = HYPERQWEN_LINUX;
//# sourceMappingURL=hyperqwenWindows.js.map