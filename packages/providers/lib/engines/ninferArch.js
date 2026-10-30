/**
 * The NInfer Arch Linux build profile. Arch builds NInfer through the shared
 * Linux route (cmake with the Ninja generator), so this profile reuses the
 * shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/ninferArch
 */
import { NINFER_LINUX } from "./ninferLinux.js";
export const NINFER_ARCH = NINFER_LINUX;
//# sourceMappingURL=ninferArch.js.map