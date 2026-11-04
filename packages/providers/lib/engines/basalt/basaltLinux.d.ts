/**
 * The Basalt shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Basalt through the engine's own CMake route: configure a
 * Release build into the `build` directory, then compile it. CMake sets the
 * target's RUNTIME_OUTPUT_DIRECTORY to the repo's `bin` folder, so the
 * `basalt` binary lands in `bin/`, not the CMake `build/` tree. The distro
 * profiles reuse this profile, so a distro carries no build steps of its own.
 *
 * Basalt is Blackwell-only (sm_120): the engine is compiled for the NVIDIA
 * Blackwell GPU, so the CUDA 13 toolkit and a C++20 compiler are hard
 * requirements. The serve/ server's pip requirements install into the system
 * Python, and the hf CLI downloads the .basalt model artifact.
 * @module dsh-plugin-local-infer/providers/engines/basalt/basaltLinux
 */
import type { EngineOsProfile } from '../engineOs.ts';
export declare const BASALT_LINUX: EngineOsProfile;
/**
 * basaltLinuxBinary returns the Basalt engine binary name on Linux: the plain
 * `basalt` (no .exe). The name comes from the shared Linux profile, so the
 * spelling has one home.
 */
export declare function basaltLinuxBinary(): string;
//# sourceMappingURL=basaltLinux.d.ts.map
