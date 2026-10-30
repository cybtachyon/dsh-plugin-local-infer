/**
 * The NInfer shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds NInfer through this one route: cmake with the Ninja generator
 * into the `build` directory, which is where the `ninfer-serve` binary lands.
 * The distro profiles reuse this profile, so a distro carries no build steps of
 * its own.
 * @module dsh-plugin-local-infer/providers/engines/ninferLinux
 */
import type { EngineOsProfile } from './engineOs.ts';
export declare const NINFER_LINUX: EngineOsProfile;
/**
 * ninferLinuxBinary returns the NInfer engine binary name on Linux: the plain
 * `ninfer-serve` (no .exe). The name comes from the shared Linux profile, so
 * the spelling has one home.
 */
export declare function ninferLinuxBinary(): string;
//# sourceMappingURL=ninferLinux.d.ts.map