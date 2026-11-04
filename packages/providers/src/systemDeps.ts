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

import { execFile } from 'node:child_process'
import type { HardwareProfile, SystemDep } from 'dsh-plugin-local-infer/core'

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
      winget: { commands: ['winget install Kitware.CMake'] },
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
      winget: { commands: ['winget install -e --id Ninja-build.Ninja'] },
    },
  },
  // The MSVC compiler the Windows vcpkg build links against. The winget block
  // installs the Community edition with the C++ workload the build needs. The
  // probe reads the cl compiler, which is on the path only inside a Visual
  // Studio developer prompt, so a plain shell degrades to missing and the
  // user installs by hand.
  visualStudio: {
    id: 'visual-studio',
    purpose: 'provides the MSVC compiler the vcpkg build needs',
    requiresSudo: false,
    detect: probe('where', ['cl']),
    install: {
      winget: {
        commands: [
          'winget install --id Microsoft.VisualStudio.Community --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
        ],
      },
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
      // The NVIDIA CUDA toolkit the winget catalog ships. The build reads the
      // toolkit from the default install path, so no envAfter export is needed.
      winget: { commands: ['winget install --id=Nvidia.CUDA -e'] },
    },
  },
  // The C++20 compiler the local build links against (GCC on Debian/Arch/
  // Fedora, Clang on macOS). The winget block is empty: on Windows the C++20
  // compiler is the MSVC toolchain the visual-studio dep installs, so the
  // Windows profile rides that dep instead of this one.
  compiler: {
    id: 'compiler',
    purpose: 'compiles the C++20 engine sources',
    requiresSudo: true,
    detect: probe('g++', ['--version']),
    install: {
      apt: { commands: ['sudo apt install g++'] },
      dnf: { commands: ['sudo dnf install gcc-c++'] },
      pacman: { commands: ['sudo pacman -S --noconfirm gcc'] },
      brew: { commands: ['brew install gcc'] },
      winget: { commands: [] },
    },
  },
  // The Python 3.10+ interpreter the serve/ server and its pip requirements
  // need. The probe reads python3, which every distro and macOS ship or
  // install under that name.
  python: {
    id: 'python',
    purpose: 'runs the Python server and its pip requirements',
    requiresSudo: true,
    detect: probe('python3', ['--version']),
    install: {
      apt: { commands: ['sudo apt install python3 python3-pip'] },
      dnf: { commands: ['sudo dnf install python3 python3-pip'] },
      pacman: { commands: ['sudo pacman -S --noconfirm python python-pip'] },
      brew: { commands: ['brew install python'] },
      winget: { commands: ['winget install Python.Python.3.12'] },
    },
  },
  git: {
    id: 'git',
    purpose: 'clones the engine source',
    requiresSudo: true,
    detect: probe('git', ['--version']),
    install: {
      apt: { commands: ['sudo apt install git'] },
      dnf: { commands: ['sudo dnf install git'] },
      pacman: { commands: ['sudo pacman -S --noconfirm git'] },
      brew: { commands: ['brew install git'] },
      winget: { commands: ['winget install Git.Git'] },
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
      winget: { commands: ['winget install Docker.Docker-Desktop'] },
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
      // every manager keys the same block. Windows runs the PowerShell
      // installer through the OS's own irm alias.
      apt: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      dnf: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      pacman: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      brew: { commands: ['curl -LsSf https://hf.co/cli/install.sh | bash'] },
      winget: {
        commands: ['powershell -ExecutionPolicy ByPass -c "irm https://hf.co/cli/install.ps1 | iex"'],
      },
    },
  },
} satisfies Record<string, SystemDep>
