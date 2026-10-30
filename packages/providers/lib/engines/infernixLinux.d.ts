/**
 * The Infernix shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Infernix through the engine's own cmake preset: configure the
 * release preset, then build into the `build` directory, which is where the
 * `infernix-serve` binary lands. The distro profiles reuse this profile, so a
 * distro carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/infernixLinux
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const INFERNIX_LINUX: EngineOsProfile;
/**
 * infernixLinuxBinary returns the Infernix engine binary name on Linux: the
 * plain `infernix-serve` (no .exe). The name comes from the shared Linux
 * profile, so the spelling has one home.
 */
export declare function infernixLinuxBinary(): string;
//# sourceMappingURL=infernixLinux.d.ts.map