/**
 * The Strata macOS build profile. macOS builds Strata through the engine's own
 * setup.sh, the same route as Linux (the README's setup walks both), so this
 * profile reuses the shared Linux build steps; the binary keeps its plain
 * name (no .exe on macOS).
 * @module dsh-plugin-local-infer/providers/engines/strataMacOS
 */
import type { EngineOsProfile } from './engineOs.ts';
import type { StrataSourceLaunchArgs } from './strata.ts';
export declare const STRATA_MACOS: EngineOsProfile;
/**
 * strataMacOSSourceLaunch reuses the Linux source-build launch: macOS builds
 * through the same setup.sh route, so the argv is identical.
 */
export declare function strataMacOSSourceLaunch(args: StrataSourceLaunchArgs): string[];
//# sourceMappingURL=strataMacOS.d.ts.map