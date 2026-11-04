/**
 * The shared SystemDep install command catalog. Every engine OS profile and
 * the per-engine dep plans compose their lists from these named deps, so the
 * install blocks (the copy/paste commands the user runs) and the which/version
 * probes have one home. The engine OS profiles import this catalog directly,
 * which keeps them free of a circular edge back through the per-engine plans.
 *
 * Each dep declares its purpose, the which/version probe that reads "already
 * installed", and its install block keyed by package manager, mirroring the
 * qwen-ninfer launcher header (apt and the CUDA keyring on Debian/Ubuntu,
 * pacman on Arch). The dnf and brew blocks are the plan's "flagged when
 * untested" sets: they name the right packages but have not been run on a live
 * host.
 * @module dsh-plugin-local-infer/providers/systemDeps
 */
import type { HardwareProfile } from 'dsh-plugin-local-infer/core';
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
            winget: {
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
            winget: {
                commands: string[];
            };
        };
    };
    visualStudio: {
        id: string;
        purpose: string;
        requiresSudo: false;
        detect: (hw: HardwareProfile) => Promise<boolean>;
        install: {
            winget: {
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
            winget: {
                commands: string[];
            };
        };
    };
    git: {
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
            winget: {
                commands: string[];
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
            winget: {
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
            winget: {
                commands: string[];
            };
        };
    };
};
//# sourceMappingURL=systemDeps.d.ts.map
