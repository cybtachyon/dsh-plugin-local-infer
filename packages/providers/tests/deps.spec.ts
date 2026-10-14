import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { renderInstallString } from '@dsh/dsh-plugin-local-infer/core'
import type { HardwareProfile } from '@dsh/dsh-plugin-local-infer/core'
import LocalInfer from '@dsh/dsh-plugin-local-infer/service'
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
    expect(SYSTEM_DEPS.hfCli.requiresSudo).toBe(false)
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
    const ids = ENGINE_DEP_PLANS.ninfer.local.map((dep) => dep.id)
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
    expect(ENGINE_DEP_PLANS.hyperqwen.local).toEqual([])
  })

  it('leaves the specified-not-verified engines their thin lists', () => {
    expect(ENGINE_DEP_PLANS.llamacpp.local.map((dep) => dep.id)).toEqual(['cmake', 'hf-cli'])
    expect(ENGINE_DEP_PLANS.strata.local).toEqual([])
  })

  it('renders the NInfer local apt block over the qwen-ninfer package set', () => {
    const block = renderInstallString(ENGINE_DEP_PLANS.ninfer.local, APT)
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
    const block = renderInstallString(ENGINE_DEP_PLANS.ninfer.local, PACMAN)
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
})

describe('dep plan registration', () => {
  it('registers a plan for every engine the card offers', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalInfer)
    const { apply } = await import('../src/index.ts')
    apply(ctx)
    expect([...ctx.localInfer.registeredDepPlans().keys()].sort()).toEqual([
      'hyperqwen',
      'llamacpp',
      'ninfer',
      'strata',
    ])
  })
})
