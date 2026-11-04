/**
 * The per-engine dep plans, keyed by engine id. The local build-mode list is
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
import { HYPERQWEN_LINUX } from "./engines/hyperqwen/hyperqwenLinux.js";
import { INFERNIX_LINUX } from "./engines/infernix/infernixLinux.js";
import { INFERNIX_WINDOWS } from "./engines/infernix/infernixWindows.js";
import { LLAMACPP_LINUX } from "./engines/llamacpp/llamacppLinux.js";
import { NINFER_LINUX } from "./engines/ninfer/ninferLinux.js";
import { NINFER_WINDOWS } from "./engines/ninfer/ninferWindows.js";
import { STRATA_LINUX } from "./engines/strata/strataLinux.js";
import { SYSTEM_DEPS } from "./systemDeps.js";
export { SYSTEM_DEPS } from "./systemDeps.js";
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
 * The local lists are read from the engine OS profile's deps, so the
 * per-platform toolchain (the apt/dnf/pacman/brew route on Linux, the
 * winget/MSVC route on Windows) has one home in the profiles. The Windows
 * variant of a build mode's list is the Windows profile's deps; an engine
 * with no Windows profile of its own (hyperqwen, llamacpp, strata) falls
 * back to the shared Linux profile's deps.
 */
export const ENGINE_DEP_PLANS = {
    ninfer: {
        local: NINFER_LINUX.deps ?? [],
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit, SYSTEM_DEPS.hfCli],
        // The Windows local build is the vcpkg route: the winget toolchain (CMake,
        // Ninja, the MSVC compiler, the CUDA toolkit) plus the hf CLI and git. The
        // vcpkg manifest pulls the ffmpeg and curl dev libraries, so the Linux
        // pkg-config/ffmpeg/curl deps do not ride the Windows list.
        windows: {
            local: NINFER_WINDOWS.deps ?? [],
        },
    },
    hyperqwen: {
        local: HYPERQWEN_LINUX.deps ?? [],
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit, SYSTEM_DEPS.hfCli],
    },
    llamacpp: {
        local: LLAMACPP_LINUX.deps ?? [],
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.hfCli],
    },
    infernix: {
        local: INFERNIX_LINUX.deps ?? [],
        docker: [],
        // Infernix builds through the engine's own cmake preset, so its Windows
        // local list is the same winget toolchain as NInfer's.
        windows: {
            local: INFERNIX_WINDOWS.deps ?? [],
        },
    },
    strata: {
        // The source build git-clones the repo and runs setup.sh, which downloads
        // what it needs; the binary install is the one-line curl script; the docker
        // mode needs the container runtime plus the GPU toolkit (the model downloads
        // inside the container, so no hf CLI).
        local: STRATA_LINUX.deps ?? [],
        docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit],
        binary: [SYSTEM_DEPS.curl],
    },
};
//# sourceMappingURL=deps.js.map
