/**
 * The Strata shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Strata through the engine's own setup.sh: the README's
 * Build-from-source route, which downloads what it needs and installs the
 * `strata` Terminal to the path. `--yes` takes the recommended answer to every
 * question and `--no-start` builds and installs without starting the server,
 * which the adapter's launch step then does. There is no build directory,
 * because setup.sh installs the binary to the path. The distro profiles reuse
 * this profile.
 * @module dsh-plugin-local-infer/providers/engines/strata/strataLinux
 */

import type { EngineOsProfile } from '../engineOs.ts'
import { strataSourceLaunchArgs, type StrataSourceLaunchArgs } from './strata.ts'
import { SYSTEM_DEPS } from '../../systemDeps.ts'

export const STRATA_LINUX: EngineOsProfile = {
  buildSteps: ['cd {dir} && ./setup.sh --yes --no-start'],
  binary: 'strata',
  // The Strata source build git-clones the repo and runs setup.sh, which
  // downloads what it needs; the only host deps are git (the clone) and curl
  // (the model download).
  deps: [SYSTEM_DEPS.git, SYSTEM_DEPS.curl],
}

/**
 * strataLinuxSourceLaunch renders the source-build launch argv for the Linux
 * route: the engine's own setup.sh with --yes (unattended) and the resolved
 * model, family, vision, context, and port. macOS reuses this route.
 */
export function strataLinuxSourceLaunch(args: StrataSourceLaunchArgs): string[] {
  return strataSourceLaunchArgs('setup.sh', args)
}
