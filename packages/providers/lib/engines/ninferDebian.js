/**
 * The NInfer Debian build profile. Debian builds NInfer through the shared
 * Linux route (cmake with the Ninja generator), so this profile reuses the
 * shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/ninferDebian
 */
import { NINFER_LINUX } from "./ninferLinux.js";
export const NINFER_DEBIAN = NINFER_LINUX;
//# sourceMappingURL=ninferDebian.js.map