/**
 * The Infernix Fedora build profile. Fedora builds Infernix through the shared
 * Linux route (the engine's own cmake preset), so this profile reuses the
 * shared Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/infernixFedora
 */
import { INFERNIX_LINUX } from "./infernixLinux.js";
export const INFERNIX_FEDORA = INFERNIX_LINUX;
//# sourceMappingURL=infernixFedora.js.map