/**
 * The per-OS SystemDep install command data. Each dep declares its purpose,
 * the which/version probe that reads "already installed", and its install
 * block keyed by package manager, mirroring the qwen-ninfer launcher header
 * (apt and the CUDA keyring on Debian/Ubuntu, pacman on Arch). The engine
 * dep plans map (engine, build mode) to these deps: a local NInfer build
 * needs the compile toolchain and the CUDA toolkit, a docker engine needs the
 * container runtime, and every engine downloads its model through the hf CLI.
 *
 * The dnf and brew blocks are the plan's "flagged when untested" sets: they
 * name the right packages but have not been run on a live host.
 * @module @dsh/dsh-plugin-local-infer/providers/deps
 */
import type { EngineDepPlan, HardwareProfile } from '@dsh/dsh-plugin-local-infer/core';
/**
 * The named host deps every engine plan composes. The install blocks are the
 * copy/paste commands the user runs; envAfter carries the per-manager export
 * lines (the CUDA paths differ between Debian and Arch).
 */
export declare const SYSTEM_DEPS: {
    cmake: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
    ninja: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
    pkgConfig: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
    ffmpeg: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
    curl: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
    cudaToolkit: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
                envAfter: {
                    CUDACXX: string;
                };
            };
            dnf: {
                commands: string[];
                envAfter: {
                    CUDACXX: string;
                };
            };
            pacman: {
                commands: string[];
                envAfter: {
                    CUDAToolkit_ROOT: string;
                    CUDACXX: string;
                    TORCH_CUDA_ARCH_LIST: string;
                };
            };
            brew: {
                commands: string[];
                envAfter: {
                    CUDACXX: string;
                };
            };
        };
    };
    docker: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
    nvidiaContainerToolkit: {
        id: string;
        purpose: string;
        requiresSudo: true;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: never[];
            };
        };
    };
    hfCli: {
        id: string;
        purpose: string;
        requiresSudo: false;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            apt: {
                commands: string[];
            };
            dnf: {
                commands: string[];
            };
            pacman: {
                commands: string[];
            };
            brew: {
                commands: string[];
            };
        };
    };
};
/**
 * The per-engine dep plans, keyed by engine id. The local NInfer list is the
 * qwen-ninfer header's toolchain plus the CUDA toolkit and the hf CLI; the
 * docker lists are the container runtime plus the GPU toolkit plus the hf
 * CLI. llama.cpp and Strata carry the specified-not-verified lists until
 * their adapters land in Phase 5.
 */
export declare const ENGINE_DEP_PLANS: Record<string, EngineDepPlan>;
//# sourceMappingURL=deps.d.ts.map