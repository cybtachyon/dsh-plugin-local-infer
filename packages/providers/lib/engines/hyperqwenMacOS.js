/**
 * The Hyper-Qwen macOS build profile. Hyper-Qwen is compose-driven (the
 * compose up pulls the vLLM image), so it carries no local build steps on any
 * platform; this profile reuses the shared Linux profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenMacOS
 */
import { HYPERQWEN_LINUX } from "./hyperqwenLinux.js";
export const HYPERQWEN_MACOS = HYPERQWEN_LINUX;
//# sourceMappingURL=hyperqwenMacOS.js.map