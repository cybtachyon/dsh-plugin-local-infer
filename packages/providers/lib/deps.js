/**
 * The per-engine dep plans, keyed by engine id. The local build-mode lists are
 * sourced from the engine OS profile's deps (the Windows profile carries the
 * winget/MSVC toolchain, the shared Linux profile the apt/dnf/pacman/brew
 * toolchain), so the per-platform local lists have one home in the profiles.
 * The docker and binary lists stay central here: they are build modes, not
 * platform-specific, so they do not ride the OS profiles.
 *
 * The shared SystemDep install command catalog (the named host deps every
 * list composes) lives in systemDeps.ts; it is re-exported here so the
 * catalog keeps its public home in this module.
 * @module dsh-plugin-local-infer/providers/deps
 */
import { engineOsProfile } from "./acquire.js";
import { SYSTEM_DEPS } from "./systemDeps.js";
export { SYSTEM_DEPS } from "./systemDeps.js";
/**
 * engineLocalDeps reads the host build deps an engine's local build needs on
 * an OS, from the engine OS profile's deps (the single home for the
 * per-platform toolchain). A Windows host reads the Windows profile (the
 * winget/MSVC route); every other host reads the shared Linux profile, so a
 * macOS host gets the Linux toolchain list.
 */
export function engineLocalDeps(engineId, os) {
    const profile = engineOsProfile(engineId, os === 'windows' ? 'windows' : 'linux');
    return profile?.deps ?? [];
}
/**
 * The per-engine dep plans, keyed by engine id. The local NInfer list is the
 * qwen-ninfer header's toolchain plus the CUDA toolkit and the hf CLI; the
 * docker lists are the container runtime plus the GPU toolkit plus the hf
 * CLI. Infernix builds through the engine's own cmake preset, so its local
 * list is the same toolchain as NInfer's, and its docker list stays empty
 * because the engine ships no container image. llama.cpp carries a thin
 * cmake-plus-hf list. Strata carries one list per build mode: the source
 * build needs git and curl, the binary install needs curl, and the docker
 * mode needs the container runtime plus the GPU toolkit.
 *
 * The local lists ride the plan as a per-OS record (the linux and windows
 * entries), read from the engine OS profile's deps through engineLocalDeps,
 * so the per-platform toolchain (the apt/dnf/pacman/brew route on Linux, the
 * winget/MSVC route on Windows) has one home in the profiles. An engine with
 * no dedicated Windows toolchain (hyperqwen, llamacpp, strata) reads the same
 * list for both entries: its Windows profile reuses the shared Linux profile
 * (hyperqwen, empty for the compose engine) or declares the identical list
 * (llamacpp, strata).
 */
export const ENGINE_DEP_PLANS = {
    ninfer: {
        local: {
            linux: engineLocalDeps('ninfer', 'linux'),
            windows: engineLocalDeps('ninfer', 'windows'),
        },
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit, SYSTEM_DEPS.hfCli],
    },
    hyperqwen: {
        local: {
            linux: engineLocalDeps('hyperqwen', 'linux'),
            windows: engineLocalDeps('hyperqwen', 'windows'),
        },
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit, SYSTEM_DEPS.hfCli],
    },
    llamacpp: {
        local: {
            linux: engineLocalDeps('llamacpp', 'linux'),
            windows: engineLocalDeps('llamacpp', 'windows'),
        },
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.hfCli],
    },
    infernix: {
        local: {
            linux: engineLocalDeps('infernix', 'linux'),
            windows: engineLocalDeps('infernix', 'windows'),
        },
        docker: [],
    },
    strata: {
        // The source build git-clones the repo and runs setup.sh, which downloads
        // what it needs; the binary install is the one-line curl script; the docker
        // mode needs the container runtime plus the GPU toolkit (the model downloads
        // inside the container, so no hf CLI).
        local: {
            linux: engineLocalDeps('strata', 'linux'),
            windows: engineLocalDeps('strata', 'windows'),
        },
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit],
        binary: [SYSTEM_DEPS.curl],
    },
    basalt: {
        // The CMake source build needs the C++/CUDA toolchain, the Python
        // interpreter plus the serve/ server's pip requirements, and the hf CLI
        // for the model artifact. Basalt ships no container image, so the docker
        // list stays empty.
        local: {
            linux: engineLocalDeps('basalt', 'linux'),
            windows: engineLocalDeps('basalt', 'windows'),
        },
        docker: [],
    },
};
//# sourceMappingURL=deps.js.map
