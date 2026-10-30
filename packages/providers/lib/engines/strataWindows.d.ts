/**
 * The Strata Windows build profile. The Windows source route is the engine's
 * own START-HERE.bat wrapper (docs/SOURCE_INSTALL.md, From source: Windows),
 * not the Linux setup.sh. `--yes` accepts the recommended answer to every
 * question, so the step runs unattended. The wrapper acquires a ready-made
 * engine when one fits the PC, and compiles one when it does not: the
 * compile needs the Visual Studio 2022 Build Tools with the C++ workload
 * (the sources are C++20, so VS2019 is too old). When setup cannot find the
 * toolchain, point STRATA_VCVARS at vcvars64.bat before running. The build
 * keeps its dependencies and products in the source install and writes the
 * launch scripts (run-<model>.bat) and run configs (strata-<model>.json)
 * into the checkout, so the profile carries no build directory. Updates run
 * through UPDATE.bat.
 * @module dsh-plugin-local-infer/providers/engines/strataWindows
 */
import type { EngineOsProfile } from './engineOs.ts';
import { type StrataSourceLaunchArgs } from './strata.ts';
export declare const STRATA_WINDOWS: EngineOsProfile;
/**
 * strataWindowsSourceLaunch renders the source-build launch argv for the
 * Windows route: the engine's own START-HERE.bat wrapper with --yes
 * (unattended) and the resolved model, family, vision, context, and port. The
 * wrapper acquires a ready-made engine when one fits the PC, and compiles one
 * (the Visual Studio 2022 C++ toolchain) when it does not.
 */
export declare function strataWindowsSourceLaunch(args: StrataSourceLaunchArgs): string[];
//# sourceMappingURL=strataWindows.d.ts.map