import { describe, expect, it } from 'vitest'
import {
  checkDeps,
  detectPackageManager,
  EngineAdapter,
  osLabel,
  planDeps,
  planDepsForOs,
  renderInstallString,
  runInstall,
} from '../src/index.ts'
import type { EngineDepPlan } from '../src/index.ts'
import type {
  CommandOutcome,
  CommandRunner,
  HardwareProfile,
  SystemDep,
} from '../src/index.ts'
import type {
  Config,
  DeployResult,
  HealthResult,
  LaunchPlan,
  ParameterSpec,
} from '../src/index.ts'

const HW: HardwareProfile = {
  os: 'linux',
  cpuThreads: 8,
  dockerAvailable: true,
  wsl2: false,
  packageManager: 'apt',
}

/** A stub dep whose probe and install block the suites control. */
function dep(overrides: Partial<SystemDep> & { id: string }): SystemDep {
  return {
    purpose: 'a purpose',
    requiresSudo: true,
    install: {},
    ...overrides,
  }
}

function recordingRunner(outcomes: CommandOutcome[]): {
  runner: CommandRunner
  calls: string[]
} {
  const calls: string[] = []
  const runner: CommandRunner = async (command: string): Promise<CommandOutcome> => {
    calls.push(command)
    return outcomes[calls.length - 1] ?? { ok: true }
  }
  return { runner, calls }
}

describe('detectPackageManager', () => {
  it('keys a macOS host on brew', () => {
    expect(
      detectPackageManager({ os: 'macos', apt: false, dnf: false, pacman: false, brew: true, winget: false }),
    ).toBe('brew')
    expect(
      detectPackageManager({ os: 'macos', apt: false, dnf: false, pacman: false, brew: false, winget: false }),
    ).toBeUndefined()
  })

  it('keys a Windows host on winget', () => {
    expect(
      detectPackageManager({ os: 'windows', apt: false, dnf: false, pacman: false, brew: false, winget: true }),
    ).toBe('winget')
    expect(
      detectPackageManager({ os: 'windows', apt: false, dnf: false, pacman: false, brew: false, winget: false }),
    ).toBeUndefined()
  })

  it('tries the linux managers in the plan order, apt first', () => {
    expect(
      detectPackageManager({ os: 'linux', apt: true, dnf: true, pacman: true, brew: false, winget: false }),
    ).toBe('apt')
    expect(
      detectPackageManager({ os: 'linux', apt: false, dnf: true, pacman: true, brew: false, winget: false }),
    ).toBe('dnf')
    expect(
      detectPackageManager({ os: 'linux', apt: false, dnf: false, pacman: true, brew: false, winget: false }),
    ).toBe('pacman')
    expect(
      detectPackageManager({ os: 'linux', apt: false, dnf: false, pacman: false, brew: false, winget: false }),
    ).toBeUndefined()
  })
})

describe('planDeps', () => {
  class DeclaringAdapter extends EngineAdapter {
    readonly id = 'stub'
    readonly supports = { docker: true, local: true }

    parameters(): ParameterSpec[] {
      return []
    }

    renderLaunch(_config: Config, _hw: HardwareProfile): LaunchPlan {
      return { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
    }

    async healthCheck(_plan: LaunchPlan): Promise<HealthResult> {
      return { healthy: true }
    }

    async deploy(_plan: LaunchPlan): Promise<DeployResult> {
      return { ok: true }
    }

    async stop(_plan: LaunchPlan): Promise<void> {
      /* nothing to stop */
    }

    systemDeps(buildMode: 'docker' | 'local', _hw: HardwareProfile): readonly SystemDep[] {
      return [dep({ id: buildMode === 'docker' ? 'docker' : 'cmake' })]
    }
  }

  class SilentAdapter extends EngineAdapter {
    readonly id = 'silent'
    readonly supports = { docker: true, local: true }

    parameters(): ParameterSpec[] {
      return []
    }

    renderLaunch(_config: Config, _hw: HardwareProfile): LaunchPlan {
      return { kind: 'process', port: 8080, healthUrl: 'http://127.0.0.1:8080/health' }
    }

    async healthCheck(_plan: LaunchPlan): Promise<HealthResult> {
      return { healthy: true }
    }

    async deploy(_plan: LaunchPlan): Promise<DeployResult> {
      return { ok: true }
    }

    async stop(_plan: LaunchPlan): Promise<void> {
      /* nothing to stop */
    }
  }

  it('returns the deps an adapter declares for the build mode', () => {
    const deps = planDeps(new DeclaringAdapter(), 'docker', HW)
    expect(deps.map((entry) => entry.id)).toEqual(['docker'])
    expect(planDeps(new DeclaringAdapter(), 'local', HW).map((entry) => entry.id)).toEqual(['cmake'])
  })

  it('plans an empty list for an adapter that declares none', () => {
    expect(planDeps(new SilentAdapter(), 'local', HW)).toEqual([])
  })
})

describe('planDepsForOs', () => {
  const localDep = dep({ id: 'cmake' })
  const windowsDep = dep({ id: 'visual-studio' })
  const plan: EngineDepPlan = {
    local: [localDep],
    docker: [],
    windows: { local: [windowsDep] },
  }

  it('reads the windows variant for a Windows host when present', () => {
    expect(planDepsForOs(plan, 'local', 'windows').map((entry) => entry.id)).toEqual(['visual-studio'])
  })

  it('falls back to the base list for a Windows host with no windows variant', () => {
    expect(planDepsForOs({ local: [localDep], docker: [] }, 'local', 'windows').map((entry) => entry.id)).toEqual([
      'cmake',
    ])
  })

  it('reads the base list for a Linux host even when a windows variant exists', () => {
    expect(planDepsForOs(plan, 'local', 'linux').map((entry) => entry.id)).toEqual(['cmake'])
  })

  it('reads an empty list for a mode the plan does not carry', () => {
    expect(planDepsForOs(plan, 'binary', 'linux')).toEqual([])
  })
})

describe('osLabel', () => {
  it('names WSL on a WSL2 kernel and Linux on every other Linux host', () => {
    expect(osLabel({ os: 'linux', wsl2: true })).toBe('WSL')
    expect(osLabel({ os: 'linux', wsl2: false })).toBe('Linux')
    expect(osLabel({ os: 'linux' })).toBe('Linux')
  })

  it('names Windows and OSX for their hosts', () => {
    expect(osLabel({ os: 'windows' })).toBe('Windows')
    expect(osLabel({ os: 'macos' })).toBe('OSX')
  })
})

describe('checkDeps', () => {
  it('reports a satisfied probe as satisfied and a failed probe as missing', async () => {
    const present = dep({
      id: 'present',
      detect: async () => true,
    })
    const absent = dep({
      id: 'absent',
      detect: async () => false,
    })
    const checks = await checkDeps([present, absent], HW)
    expect(checks.map((check) => check.status)).toEqual(['satisfied', 'missing'])
  })

  it('reads a dep with no probe as missing, the documented degrade-to-missing rule', async () => {
    const checks = await checkDeps([dep({ id: 'unprobed' })], HW)
    expect(checks[0]?.status).toBe('missing')
  })
})

describe('renderInstallString', () => {
  const aptDep = dep({
    id: 'cuda-toolkit',
    purpose: 'compiles the CUDA kernels',
    install: {
      apt: {
        commands: [
          'wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2604/x86_64/cuda-keyring_1.1-1_all.deb',
          'sudo dpkg -i cuda-keyring_1.1-1_all.deb',
          'sudo apt-get -y install cuda-toolkit-13-4',
        ],
        envAfter: { CUDACXX: '/usr/local/cuda/bin/nvcc' },
      },
      pacman: {
        commands: ['sudo pacman -S --noconfirm cuda'],
        envAfter: { CUDAToolkit_ROOT: '/opt/cuda', CUDACXX: '/opt/cuda/bin/nvcc' },
      },
    },
  })
  const noPacmanDep = dep({
    id: 'nvidia-container-toolkit',
    purpose: 'lets the container see the GPU',
    install: {
      apt: { commands: ['sudo apt-get install -y nvidia-container-toolkit'] },
      brew: { commands: [] },
    },
  })

  it('renders the detected manager block with the purpose header and the envAfter exports', () => {
    const block = renderInstallString([aptDep, noPacmanDep], HW)
    expect(block).toBe(
      [
        '# System dependencies on Linux',
        '# Package manager: apt',
        '# cuda-toolkit: compiles the CUDA kernels',
        'wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2604/x86_64/cuda-keyring_1.1-1_all.deb',
        'sudo dpkg -i cuda-keyring_1.1-1_all.deb',
        'sudo apt-get -y install cuda-toolkit-13-4',
        'export CUDACXX=/usr/local/cuda/bin/nvcc',
        '# nvidia-container-toolkit: lets the container see the GPU',
        'sudo apt-get install -y nvidia-container-toolkit',
      ].join('\n'),
    )
  })

  it('writes a by-hand note for a dep the detected manager has no commands for', () => {
    const block = renderInstallString([noPacmanDep], { ...HW, packageManager: 'pacman' })
    expect(block).toContain('# no pacman install commands for nvidia-container-toolkit; install it by hand')
  })

  it('groups the blocks by manager when no package manager is detected', () => {
    const block = renderInstallString([aptDep], { ...HW, packageManager: undefined })
    expect(block).toContain('# No package manager detected; blocks are grouped by manager.')
    expect(block).toContain('# --- apt ---')
    expect(block).toContain('# --- pacman ---')
    // The apt block keeps its envAfter exports next to its own commands.
    expect(block.indexOf('export CUDACXX=/usr/local/cuda/bin/nvcc')).toBeLessThan(
      block.indexOf('# --- pacman ---'),
    )
  })

  it('renders the pacman block with the Arch export lines', () => {
    const block = renderInstallString([aptDep], { ...HW, packageManager: 'pacman' })
    expect(block).toContain('sudo pacman -S --noconfirm cuda')
    expect(block).toContain('export CUDAToolkit_ROOT=/opt/cuda')
    expect(block).toContain('export CUDACXX=/opt/cuda/bin/nvcc')
  })
})

describe('runInstall', () => {
  it('skips a dep the probe already reads as satisfied and runs no commands for it', async () => {
    const { runner, calls } = recordingRunner([])
    const result = await runInstall(
      [dep({ id: 'present', detect: async () => true, install: { apt: { commands: ['cmd'] } } })],
      HW,
      runner,
    )
    expect(result).toEqual({ ok: true, results: [{ id: 'present', status: 'satisfied' }] })
    expect(calls).toEqual([])
  })

  it('runs the commands in order and confirms the dep with the probe', async () => {
    // The probe reads missing before the run and satisfied after it.
    let installed = false
    const depToInstall = dep({
      id: 'cmake',
      detect: async () => installed,
      install: { apt: { commands: ['sudo apt install cmake'] } },
    })
    const { runner, calls } = recordingRunner([])
    const before = await runInstall([depToInstall], HW, runner)
    expect(before).toEqual({
      ok: false,
      results: [
        {
          id: 'cmake',
          status: 'failed',
          detail: 'commands finished but the probe still reports missing; re-check by hand',
        },
      ],
    })
    installed = true
    const after = await runInstall([depToInstall], HW, runner)
    expect(after.ok).toBe(true)
    expect(after.results).toEqual([{ id: 'cmake', status: 'satisfied' }])
    // The second run sees the probe read satisfied and runs no command.
    expect(calls).toEqual(['sudo apt install cmake'])
  })

  it('stops a dep at its first failed command and captures the detail', async () => {
    const { runner, calls } = recordingRunner([{ ok: true }, { ok: false, detail: 'exit 100: E: unable to locate package' }])
    const result = await runInstall(
      [dep({ id: 'cmake', install: { apt: { commands: ['one', 'two', 'three'] } } })],
      HW,
      runner,
    )
    expect(result.ok).toBe(false)
    expect(result.results).toEqual([
      { id: 'cmake', status: 'failed', detail: 'exit 100: E: unable to locate package' },
    ])
    // The commands after the failure never run.
    expect(calls).toEqual(['one', 'two'])
  })

  it('reads a clean run the probe cannot confirm as failed', async () => {
    const { runner } = recordingRunner([])
    const result = await runInstall(
      [dep({ id: 'mystery', install: { apt: { commands: ['cmd'] } } })],
      HW,
      runner,
    )
    expect(result.ok).toBe(false)
    expect(result.results[0]?.status).toBe('failed')
    expect(result.results[0]?.detail).toContain('re-check by hand')
  })

  it('reads a dep with no commands for the detected manager as missing', async () => {
    const { runner, calls } = recordingRunner([])
    const result = await runInstall([dep({ id: 'brewless', install: { brew: { commands: ['brew install x'] } } })], HW, runner)
    expect(result).toEqual({
      ok: false,
      results: [{ id: 'brewless', status: 'missing', detail: 'no apt install commands' }],
    })
    expect(calls).toEqual([])
  })

  it('names the missing-package-manager state when the profile carries none', async () => {
    const { runner } = recordingRunner([])
    const result = await runInstall(
      [dep({ id: 'cmake', install: { apt: { commands: ['cmd'] } } })],
      { ...HW, packageManager: undefined },
      runner,
    )
    expect(result.results[0]).toEqual({ id: 'cmake', status: 'missing', detail: 'no package manager detected' })
  })
})
