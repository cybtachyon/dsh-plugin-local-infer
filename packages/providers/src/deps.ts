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

import { execFile } from 'node:child_process'
import type { EngineDepPlan, HardwareProfile, SystemDep } from '@dsh/dsh-plugin-local-infer/core'

/**
 * The probe timeout. A hung version probe must not hang the panel, so every
 * detect command is killed after this many milliseconds and read as missing.
 */
const PROBE_TIMEOUT_MS = 5000

/**
 * probe builds a dep's detect function from a binary and its version args.
 * A missing binary, a non-zero exit, and a timeout all read as not installed,
 * which the checkDeps rule degrades to the missing status.
 */
function probe(binary: string, args: string[]): (hw: HardwareProfile) => Promise<boolean> {
  return async (_hw: HardwareProfile): Promise<boolean> => {
    try {
      await execFile(binary, args, { timeout: PROBE_TIMEOUT_MS })
      return true
    } catch {
      return false
    }
  }
}

/**
 * The named host deps every engine plan composes. The install blocks are the
 * copy/paste commands the user runs; envAfter carries the per-manager export
 * lines (the CUDA paths differ between Debian and Arch).
 */
export const SYSTEM_DEPS = {
  cmake: {
    id: 'cmake',
    purpose: 'compiles the local engine',
    requiresSudo: true,
    detect: probe('cmake', ['--version']),
    install: {
      apt: { commands: ['sudo apt install cmake'] },
      dnf: { commands: ['sudo dnf install cmake'] },
      pacman: { commands: ['sudo pacman -S --noconfirm cmake'] },
      brew: { commands: ['brew install cmake'] },
    },
  },
  ninja: {
    id: 'ninja',
    purpose: 'drives the cmake build',
    requiresSudo: true,
    detect: probe('ninja', ['--version']),
    install: {
      apt: { commands: ['sudo apt install ninja-build'] },
      dnf: { commands: ['sudo dnf install ninja'] },
      pacman: { commands: ['sudo pacman -S --noconfirm ninja'] },
      brew: { commands: ['brew install ninja'] },
    },
  },
  pkgConfig: {
    id: 'pkg-config',
    purpose: 'links the ffmpeg and curl dev libraries',
    requiresSudo: true,
    detect: probe('pkg-config', ['--version']),
    install: {
      apt: { commands: ['sudo apt install pkg-config'] },
      dnf: { commands: ['sudo dnf install pkgconf-pkg-config'] },
      pacman: { commands: ['sudo pacman -S --noconfirm pkgconf'] },
      brew: { commands: ['brew install pkgconf'] },
    },
  },
  ffmpeg: {
    id: 'ffmpeg',
    purpose: 'links the media codecs the vision tower needs',
    requiresSudo: true,
    detect: probe('ffmpeg', ['-version']),
    install: {
      apt: {
        commands: ['sudo apt install libavformat-dev libavcodec-dev libavutil-dev libswscale-dev'],
      },
      dnf: { commands: ['sudo dnf install ffmpeg-devel'] },
      pacman: { commands: ['sudo pacman -S --noconfirm ffmpeg'] },
      brew: { commands: ['brew install ffmpeg'] },
    },
  },
  curl: {
    id: 'curl',
    purpose: 'links the HTTP client dev headers',
    requiresSudo: true,
    detect: probe('curl', ['--version']),
    install: {
      apt: { commands: ['sudo apt install libcurl4-openssl-dev'] },
      dnf: { commands: ['sudo dnf install libcurl-devel'] },
      pacman: { commands: ['sudo pacman -S --noconfirm curl'] },
      brew: { commands: ['brew install curl'] },
    },
  },
  cudaToolkit: {
    id: 'cuda-toolkit',
    purpose: 'compiles the CUDA kernels',
    requiresSudo: true,
    detect: probe('nvcc', ['--version']),
    install: {
      // The qwen-ninfer header, verbatim: the ubuntu2604 CUDA keyring plus the
      // toolkit, then the nvcc export the build reads.
      apt: {
        commands: [
          'wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2604/x86_64/cuda-keyring_1.1-1_all.deb',
          'sudo dpkg -i cuda-keyring_1.1-1_all.deb',
          'sudo apt-get update',
          'sudo apt-get -y install cuda-toolkit-13-4',
        ],
        envAfter: { CUDACXX: '/usr/local/cuda/bin/nvcc' },
      },
      dnf: {
        commands: ['sudo dnf install cuda-toolkit'],
        envAfter: { CUDACXX: '/usr/bin/nvcc' },
      },
      pacman: {
        commands: ['sudo pacman -S --noconfirm cuda'],
        envAfter: {
          CUDAToolkit_ROOT: '/opt/cuda',
          CUDACXX: '/opt/cuda/bin/nvcc',
          TORCH_CUDA_ARCH_LIST: '12.0',
        },
      },
      brew: {
        commands: ['brew install --cask nvidia-cuda'],
        envAfter: { CUDACXX: '/usr/local/cuda/bin/nvcc' },
      },
    },
  },
  docker: {
    id: 'docker',
    purpose: 'runs the engine in a container',
    requiresSudo: true,
    detect: probe('docker', ['--version']),
    install: {
      apt: { commands: ['sudo apt install docker.io'] },
      dnf: { commands: ['sudo dnf install docker'] },
      pacman: { commands: ['sudo pacman -S --noconfirm docker'] },
      brew: { commands: ['brew install --cask docker'] },
    },
  },
  nvidiaContainerToolkit: {
    id: 'nvidia-container-toolkit',
    purpose: 'lets the container see the GPU',
    requiresSudo: true,
    detect: probe('nvidia-ctk', ['--version']),
    install: {
      // The NVIDIA-published apt setup. Untested on a live host, so it rides
      // the plan's "flagged when untested" rule.
      apt: {
        commands: [
          'curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg',
          'curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed \'s#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#\' | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list',
          'sudo apt-get update',
          'sudo apt-get install -y nvidia-container-toolkit',
        ],
      },
      dnf: { commands: ['sudo dnf install nvidia-container-toolkit'] },
      pacman: { commands: ['sudo pacman -S --noconfirm nvidia-container-toolkit'] },
      // macOS has no NVIDIA GPU toolkit; the by-hand note renders instead.
      brew: { commands: [] },
    },
  },
  hfCli: {
    id: 'hf-cli',
    purpose: 'downloads the model artifact',
    requiresSudo: false,
    detect: probe('hf', ['--version']),
    install: {
      // The hf CLI installs through its own script, not a package manager, so
      // every manager keys the same block.
      apt: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      dnf: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      pacman: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      brew: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
    },
  },
} satisfies Record<string, SystemDep>

/**
 * The per-engine dep plans, keyed by engine id. The local NInfer list is the
 * qwen-ninfer header's toolchain plus the CUDA toolkit and the hf CLI; the
 * docker lists are the container runtime plus the GPU toolkit plus the hf
 * CLI. llama.cpp and Strata carry the specified-not-verified lists until
 * their adapters land in Phase 5.
 */
export const ENGINE_DEP_PLANS: Record<string, EngineDepPlan> = {
  ninfer: {
    local: [
      SYSTEM_DEPS.cmake,
      SYSTEM_DEPS.ninja,
      SYSTEM_DEPS.pkgConfig,
      SYSTEM_DEPS.ffmpeg,
      SYSTEM_DEPS.curl,
      SYSTEM_DEPS.cudaToolkit,
      SYSTEM_DEPS.hfCli,
    ],
    docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit, SYSTEM_DEPS.hfCli],
  },
  hyperqwen: {
    local: [],
    docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.nvidiaContainerToolkit, SYSTEM_DEPS.hfCli],
  },
  llamacpp: {
    local: [SYSTEM_DEPS.cmake, SYSTEM_DEPS.hfCli],
    docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.hfCli],
  },
  strata: {
    local: [],
    docker: [SYSTEM_DEPS.docker, SYSTEM_DEPS.hfCli],
  },
}
