/**
 * The Strata Debian build profile. Debian builds Strata through the shared
 * Linux route (the engine's own setup.sh), so this profile reuses the shared
 * Linux profile and carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/strataDebian
 */
import { STRATA_LINUX } from "./strataLinux.js";
export const STRATA_DEBIAN = STRATA_LINUX;
//# sourceMappingURL=strataDebian.js.map