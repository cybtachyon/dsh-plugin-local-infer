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
import type { EngineDepPlan } from 'dsh-plugin-local-infer/core';
export { SYSTEM_DEPS } from './systemDeps.ts';
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
export declare const ENGINE_DEP_PLANS: Record<string, EngineDepPlan>;
//# sourceMappingURL=deps.d.ts.map
