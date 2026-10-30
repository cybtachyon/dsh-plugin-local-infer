/**
 * The Strata Arch Linux build profile. Arch builds Strata through the shared
 * Linux route (the engine's own setup.sh), so this profile reuses the shared
 * Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/strataArch
 */
import { STRATA_LINUX } from "./strataLinux.js";
export const STRATA_ARCH = STRATA_LINUX;
//# sourceMappingURL=strataArch.js.map