/**
 * The Strata shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Strata through the engine's own setup.sh: the README's
 * Build-from-source route, which downloads what it needs and installs the
 * `strata` Terminal to the path. `--yes` takes the recommended answer to every
 * question and `--no-start` builds and installs without starting the server,
 * which the adapter's launch step then does. There is no build directory,
 * because setup.sh installs the binary to the path. The distro profiles reuse
 * this profile.
 * @module dsh-plugin-local-infer/providers/engines/strataLinux
 */
import { strataSourceLaunchArgs } from "./strata.js";
export const STRATA_LINUX = {
    buildSteps: ['cd {dir} && ./setup.sh --yes --no-start'],
    binary: 'strata',
};
/**
 * strataLinuxSourceLaunch renders the source-build launch argv for the Linux
 * route: the engine's own setup.sh with --yes (unattended) and the resolved
 * model, family, vision, context, and port. macOS reuses this route.
 */
export function strataLinuxSourceLaunch(args) {
    return strataSourceLaunchArgs('setup.sh', args);
}
//# sourceMappingURL=strataLinux.js.map