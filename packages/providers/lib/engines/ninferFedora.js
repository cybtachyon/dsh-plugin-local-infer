/**
 * The NInfer Fedora build profile. Fedora builds NInfer through the shared
 * Linux route (cmake with the Ninja generator), so this profile reuses the
 * shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/ninferFedora
 */
import { NINFER_LINUX } from "./ninferLinux.js";
export const NINFER_FEDORA = NINFER_LINUX;
//# sourceMappingURL=ninferFedora.js.map