/**
 * The Strata Fedora build profile. Fedora builds Strata through the shared
 * Linux route (the engine's own setup.sh), so this profile reuses the shared
 * Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/strataFedora
 */
import { STRATA_LINUX } from "./strataLinux.js";
export const STRATA_FEDORA = STRATA_LINUX;
//# sourceMappingURL=strataFedora.js.map