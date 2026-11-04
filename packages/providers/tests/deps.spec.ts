import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { renderInstallString } from 'dsh-plugin-local-infer/core'
import type { HardwareProfile } from 'dsh-plugin-local-infer/core'
import LocalInfer from 'dsh-plugin-local-infer/service'
import { ENGINE_DEP_PLANS, SYSTEM_DEPS } from '../src/deps.ts'

const APT: HardwareProfile = {
  os: 'linux',
  cpuThreads: 8,
  dockerAvailable: true,
  wsl2: false,
  packageManager: 'apt',
}
const PACMAN: HardwareProfile = {
  ...APT,
  packageManager: 'pacman',
}

describe('SystemDep install data', () => {
  it('carries a probe, a purpose, and at least one manager block for every dep', () => {
    for (const dep of Object.values(SYSTEM_DEPS)) {
      expect(dep.id.trim().length).toBeGreaterThan(0)
      expect(dep.purpose.trim().length).toBeGreaterThan(0)
      expect(typeof dep.requiresSudo).toBe('boolean')
      expect(typeof dep.detect).toBe('function')
      const managers = Object.keys(dep.install)
      expect(managers.length).toBeGreaterThan(0)
      for (const manager of managers) {
        expect(dep.install[manager]?.commands.length ?? -1).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keys the hf CLI on every manager with its own install script', () => {
    const script = 'curl -LsSf https://hf.co/cli/install.sh | bash'
    for (const manager of ['apt', 'dnf', 'pacman', 'brew']) {
      expect(SYSTEM_DEPS.hfCli.install[manager]?.commands).toEqual([script])
    }
    // The Windows installer is the PowerShell script, not the bash one.
    expect(SYSTEM_DEPS.hfCli.install.winget?.commands).toEqual([
      'powershell -ExecutionPolicy ByPass -c "irm https://hf.co/cli/install.ps1 | iex"',
    ])
    expect(SYSTEM_DEPS.hfCli.requiresSudo).toBe(false)
  })

  it('probes and installs the basalt serve pip requirements in the system python', async () => {
    // The basalt serve CLI resolves its python as <src_dir>/.venv/bin/python if
    // present, else the system python3 (python_interpreter in basalt's
    // src/platform/system.cpp), so the probe and the install target the system
    // python the CLI falls back to, not a uv environment.
    const dep = SYSTEM_DEPS.basaltPip
    expect(dep.id).toBe('basalt-pip')
    expect(dep.requiresSudo).toBe(true)
    // The probe shells out to the host python3, so the answer is
    // environment-specific; the assertion is that it degrades to a boolean
    // (the checkDeps contract) instead of throwing.
    expect(typeof (await dep.detect!(APT))).toBe('boolean')
    const install = 'python3 -m pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil'
    // The Linux managers bootstrap pip through their python-pip package first,
    // because the system python3 may lack the pip module (Arch without
    // python-pip).
    expect(dep.install.apt?.commands).toEqual([
      `sudo apt-get install -y python3-pip && sudo ${install}`,
    ])
    expect(dep.install.dnf?.commands).toEqual([
      `sudo dnf install -y python3-pip && sudo ${install}`,
    ])
    expect(dep.install.pacman?.commands).toEqual([
      `sudo pacman -S --noconfirm python-pip && sudo ${install}`,
    ])
    // The brew host runs the pip install without sudo, on python3.
    expect(dep.install.brew?.commands).toEqual([install])
    // The winget host uses the python alias, not python3, because the Windows
    // interpreter is named python.
    expect(dep.install.winget?.commands).toEqual([
      'python -m pip install numpy jinja2 markupsafe regex pyyaml tqdm pillow psutil',
    ])
  })

  it('carries the winget toolchain blocks the Windows NInfer build needs', () => {
    expect(SYSTEM_DEPS.cmake.install.winget?.commands).toEqual(['winget install Kitware.CMake'])
    expect(SYSTEM_DEPS.ninja.install.winget?.commands).toEqual(['winget install -e --id Ninja-build.Ninja'])
    expect(SYSTEM_DEPS.cudaToolkit.install.winget?.commands).toEqual(['winget install --id=Nvidia.CUDA -e'])
    expect(SYSTEM_DEPS.visualStudio.install.winget?.commands).toEqual([
      'winget install --id Microsoft.VisualStudio.Community --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    ])
  })

  it('mirrors the qwen-ninfer CUDA keyring header on apt', () => {
    const commands = SYSTEM_DEPS.cudaToolkit.install.apt?.commands ?? []
    expect(commands).toContain(
      'wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2604/x86_64/cuda-keyring_1.1-1_all.deb',
    )
    expect(commands).toContain('sudo dpkg -i cuda-keyring_1.1-1_all.deb')
    expect(commands).toContain('sudo apt-get -y install cuda-toolkit-13-4')
    expect(SYSTEM_DEPS.cudaToolkit.install.apt?.envAfter).toEqual({ CUDACXX: '/usr/local/cuda/bin/nvcc' })
  })

  it('mirrors the qwen-ninfer Arch header on pacman', () => {
    const commands = SYSTEM_DEPS.cudaToolkit.install.pacman?.commands ?? []
    expect(commands).toEqual(['sudo pacman -S --noconfirm cuda'])
    expect(SYSTEM_DEPS.cudaToolkit.install.pacman?.envAfter).toEqual({
      CUDAToolkit_ROOT: '/opt/cuda',
      CUDACXX: '/opt/cuda/bin/nvcc',
      TORCH_CUDA_ARCH_LIST: '12.0',
    })
  })
})

describe('dep probes', () => {
  it('runs every detect probe and reads a boolean answer', async () => {
    // The probes shell out to the real host, so the answers are environment-
    // specific; the assertion is that every probe degrades to a boolean
    // instead of throwing, which is the checkDeps contract.
    const hw: HardwareProfile = {
      os: 'linux',
      cpuThreads: 4,
      dockerAvailable: true,
      wsl2: false,
    }
    for (const dep of Object.values(SYSTEM_DEPS)) {
      expect(dep.detect).toBeTypeOf('function')
      const present = await dep.detect!(hw)
      expect(typeof present).toBe('boolean')
    }
  })
})

describe('engine dep plans', () => {
  it('plans the NInfer local toolchain in the qwen-ninfer order, ending with the hf CLI', () => {
    const ids = ENGINE_DEP_PLANS.ninfer.local?.linux?.map((dep) => dep.id)
    expect(ids).toEqual([
      'cmake',
      'ninja',
      'pkg-config',
      'ffmpeg',
      'curl',
      'cuda-toolkit',
      'hf-cli',
    ])
  })

  it('plans the NInfer Windows local toolchain as the winget vcpkg route', () => {
    const ids = ENGINE_DEP_PLANS.ninfer.local?.windows?.map((dep) => dep.id)
    expect(ids).toEqual([
      'cmake',
      'ninja',
      'visual-studio',
      'cuda-toolkit',
      'hf-cli',
      'git',
    ])
  })

  it('plans the docker runtime plus the GPU toolkit plus the hf CLI for the docker engines', () => {
    expect(ENGINE_DEP_PLANS.ninfer.docker.map((dep) => dep.id)).toEqual([
      'docker',
      'nvidia-container-toolkit',
      'hf-cli',
    ])
    expect(ENGINE_DEP_PLANS.hyperqwen.docker.map((dep) => dep.id)).toEqual([
      'docker',
      'nvidia-container-toolkit',
      'hf-cli',
    ])
    // Hyper-Qwen is docker-only, so its local list is empty.
    expect(ENGINE_DEP_PLANS.hyperqwen.local?.linux).toEqual([])
  })

  it('leaves the specified-not-verified engines their thin lists', () => {
    expect(ENGINE_DEP_PLANS.llamacpp.local?.linux?.map((dep) => dep.id)).toEqual(['cmake', 'hf-cli'])
    // Strata carries one list per build mode: the source build needs git and
    // curl, the binary install needs curl, and the docker mode needs the
    // container runtime plus the GPU toolkit.
    expect(ENGINE_DEP_PLANS.strata.local?.linux?.map((dep) => dep.id)).toEqual(['git', 'curl'])
    expect(ENGINE_DEP_PLANS.strata.binary?.map((dep) => dep.id)).toEqual(['curl'])
    expect(ENGINE_DEP_PLANS.strata.docker.map((dep) => dep.id)).toEqual([
      'docker',
      'nvidia-container-toolkit',
    ])
  })

  it('renders the NInfer local apt block over the qwen-ninfer package set', () => {
    const block = renderInstallString(ENGINE_DEP_PLANS.ninfer.local?.linux ?? [], APT)
    expect(block).toContain('sudo apt install cmake')
    expect(block).toContain('sudo apt install ninja-build')
    expect(block).toContain('sudo apt install pkg-config')
    expect(block).toContain('sudo apt install libavformat-dev libavcodec-dev libavutil-dev libswscale-dev')
    expect(block).toContain('sudo apt install libcurl4-openssl-dev')
    expect(block).toContain('sudo apt-get -y install cuda-toolkit-13-4')
    expect(block).toContain('export CUDACXX=/usr/local/cuda/bin/nvcc')
    expect(block).toContain('curl -LsSf https://hf.co/cli/install.sh | bash')
  })

  it('renders the NInfer local pacman block over the Arch package set', () => {
    const block = renderInstallString(ENGINE_DEP_PLANS.ninfer.local?.linux ?? [], PACMAN)
    expect(block).toContain('sudo pacman -S --noconfirm cmake')
    expect(block).toContain('sudo pacman -S --noconfirm ninja')
    expect(block).toContain('sudo pacman -S --noconfirm pkgconf')
    expect(block).toContain('sudo pacman -S --noconfirm ffmpeg')
    expect(block).toContain('sudo pacman -S --noconfirm curl')
    expect(block).toContain('sudo pacman -S --noconfirm cuda')
    expect(block).toContain('export CUDAToolkit_ROOT=/opt/cuda')
    expect(block).toContain('export TORCH_CUDA_ARCH_LIST=12.0')
  })

  it('names the by-hand note for the GPU toolkit on brew, where no command set exists', () => {
    const block = renderInstallString(ENGINE_DEP_PLANS.ninfer.docker, {
      ...APT,
      packageManager: 'brew',
    })
    expect(block).toContain('# no brew install commands for nvidia-container-toolkit; install it by hand')
    expect(block).toContain('brew install --cask docker')
  })

  it('renders the NInfer Windows local winget block over the vcpkg toolchain', () => {
    const WINDOWS: HardwareProfile = {
      os: 'windows',
      cpuThreads: 8,
      dockerAvailable: true,
      wsl2: false,
      packageManager: 'winget',
    }
    const block = renderInstallString(ENGINE_DEP_PLANS.ninfer.local?.windows ?? [], WINDOWS)
    expect(block).toContain('# System dependencies on Windows')
    expect(block).toContain('# Package manager: winget')
    expect(block).toContain('winget install Kitware.CMake')
    expect(block).toContain('winget install -e --id Ninja-build.Ninja')
    expect(block).toContain('winget install --id=Nvidia.CUDA -e')
    expect(block).toContain('powershell -ExecutionPolicy ByPass -c "irm https://hf.co/cli/install.ps1 | iex"')
  })
})

describe('dep plan registration', () => {
  it('registers a plan for every engine the card offers', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    const { apply } = await import('../src/index.ts')
    apply(ctx)
    expect([...ctx.localInfer.registeredDepPlans().keys()].sort()).toEqual([
      'basalt',
      'hyperqwen',
      'infernix',
      'llamacpp',
      'ninfer',
      'strata',
    ])
  })

  it('resolves the per-platform local list for the host OS', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    const { apply } = await import('../src/index.ts')
    apply(ctx)
    const LINUX: HardwareProfile = { ...APT }
    const WINDOWS: HardwareProfile = {
      os: 'windows',
      cpuThreads: 8,
      dockerAvailable: true,
      wsl2: false,
      packageManager: 'winget',
    }
    const MACOS: HardwareProfile = { ...APT, os: 'macos', packageManager: 'brew' }
    // A Windows host reads the Windows profile's local deps (the winget route).
    expect((await ctx.localInfer.deps('ninfer', 'local', WINDOWS)).map((dep) => dep.id)).toEqual([
      'cmake',
      'ninja',
      'visual-studio',
      'cuda-toolkit',
      'hf-cli',
      'git',
    ])
    // A Linux host reads the Linux profile's local deps (the apt/dnf/pacman/brew route).
    expect((await ctx.localInfer.deps('ninfer', 'local', LINUX)).map((dep) => dep.id)).toEqual([
      'cmake',
      'ninja',
      'pkg-config',
      'ffmpeg',
      'curl',
      'cuda-toolkit',
      'hf-cli',
    ])
    // A macOS host reads the Linux profile's list (the fallback).
    expect((await ctx.localInfer.deps('ninfer', 'local', MACOS)).map((dep) => dep.id)).toEqual([
      'cmake',
      'ninja',
      'pkg-config',
      'ffmpeg',
      'curl',
      'cuda-toolkit',
      'hf-cli',
    ])
  })
})
