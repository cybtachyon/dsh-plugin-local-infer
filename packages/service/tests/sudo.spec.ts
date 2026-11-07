/**
 * The service sudo seam: sudoProbe, the sudoGuardFor binding, and the
 * guarded install runner. No test runs a real sudo or waits a real clock:
 * node:child_process is mocked (execFile answers the probe, spawn hands back
 * a fake child) and vitest's fake timers drive the 60 s password deadline and
 * the SIGINT-to-SIGTERM escalation of the shared signalChild rule. The rule
 * itself lives in core; these tests pin the wiring: the probe only runs for a
 * declared-sudo command, the announcement fires once per waiting command, the
 * deadline is armed and disarmed around the child, the deadline kill rides the
 * shared rule (the detached shell is group-killed through its negative pid),
 * and the published notify seam reaches the observer without breaking its
 * caller.
 */
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUDO_PROBE_COMMAND, sudoFailureDetail } from 'dsh-plugin-local-infer/core'
import type { EngineDepPlan, HardwareProfile, SystemDep } from 'dsh-plugin-local-infer/core'
import LocalInfer, { guardedShellRunner, sudoGuardFor, sudoProbe } from '../src/index.ts'

// The child-process mock: the suite owns execFile (the sudo probe) and spawn
// (the install child). Everything else in the namespace stays real, the same
// delegate-to-original shape the node:os mock uses in local-infer.spec.
const cpMock = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, execFile: cpMock.execFile, spawn: cpMock.spawn }
})

const HW: HardwareProfile = {
  dockerAvailable: false,
  wsl2: false,
  os: 'linux',
  cpuThreads: 4,
  packageManager: 'apt',
}

/** Arms the probe mock to answer that sudo holds cached credentials. */
function probeCached(): void {
  cpMock.execFile.mockImplementation((_cmd, _args, _opts, callback) => {
    callback(null, '', '')
  })
}

/** Arms the probe mock to answer that sudo is about to prompt on the CLI. */
function probePrompts(): void {
  cpMock.execFile.mockImplementation((_cmd, _args, _opts, callback) => {
    callback(new Error('sudo: a password is required'), '', '')
  })
}

interface FakeChild {
  /** The child's event emitter: tests emit 'close' to settle the run. */
  events: EventEmitter
  /** The direct-kill recorder: the signalChild fallback lands here. */
  kill: ReturnType<typeof vi.fn>
}

/**
 * Arms the spawn mock to hand back one fake child with kill and pipes. The
 * exit-state fields keep the shared signalChild rule reading the child alive
 * (so a SIGINT that does not exit escalates to SIGTERM); an optional pid
 * makes the child a process-group target for the group-kill test.
 */
function fakeChild(pid?: number): FakeChild {
  const events = new EventEmitter()
  const kill = vi.fn()
  cpMock.spawn.mockReturnValue(
    Object.assign(events, {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill,
      ...(pid === undefined ? {} : { pid }),
      killed: false,
      exitCode: null,
      signalCode: null,
    }),
  )
  return { events, kill }
}

/** A sudo-requiring dep whose one apt command is the named command line. */
function sudoDep(id: string, command: string, detect?: () => Promise<boolean>): SystemDep {
  return {
    id,
    purpose: 'a sudo toolchain',
    requiresSudo: true,
    ...(detect === undefined ? {} : { detect }),
    install: { apt: { commands: [command] } },
  }
}

function depPlan(dep: SystemDep): EngineDepPlan {
  return { docker: [], local: { linux: [dep] } }
}

/** Loads the service into a fresh Context through the published seam. */
async function seam(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LocalInfer)
  return ctx
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sudoProbe', () => {
  it('reads a clean sudo -n true exit as cached credentials', async () => {
    vi.useFakeTimers()
    probeCached()
    await expect(sudoProbe()).resolves.toBe(true)
    expect(cpMock.execFile).toHaveBeenCalledWith(
      SUDO_PROBE_COMMAND[0],
      [...SUDO_PROBE_COMMAND.slice(1)],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
  })

  it('reads a refused probe as a prompt coming', async () => {
    vi.useFakeTimers()
    probePrompts()
    await expect(sudoProbe()).resolves.toBe(false)
  })
})

describe('sudoGuardFor', () => {
  it('supplies the probe, announces once, and fires kill at the deadline', async () => {
    vi.useFakeTimers()
    probePrompts()
    const notify = vi.fn()
    const kill = vi.fn()
    const command = 'sudo ln -sf /usr/local/bin/llama-server /usr/bin/llama-server'
    const guard = await sudoGuardFor(command, notify, kill)
    expect(guard.announced).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(command)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kill).toHaveBeenCalledTimes(1)
    guard.disarm()
    // A disarm after the fire keeps the rule single-shot.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kill).toHaveBeenCalledTimes(1)
  })
})

describe('guardedShellRunner', () => {
  it('never probes or notifies a command the runner did not declare sudo for', async () => {
    vi.useFakeTimers()
    probeCached()
    const child = fakeChild()
    const notify = vi.fn()
    const runner = guardedShellRunner(notify)
    const undeclared = runner('apt-get install -y cmake')
    await vi.advanceTimersByTimeAsync(0)
    // The stdin-closed shell spawn is untouched for an unguarded command;
    // the shell spawns detached so the sudo guard's signalChild can reach a
    // compound line's whole process group.
    expect(cpMock.spawn).toHaveBeenCalledWith('apt-get install -y cmake', {
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.events.emit('close', 0)
    await expect(undeclared).resolves.toEqual({ ok: true })
    // A present-but-false declaration is equally unguarded.
    const second = fakeChild()
    const declined = runner('sudo -u builder make', { needsSudo: false })
    await vi.advanceTimersByTimeAsync(0)
    second.events.emit('close', 0)
    await expect(declined).resolves.toEqual({ ok: true })
    expect(cpMock.execFile).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('runs a declared-sudo command with cached credentials unguarded', async () => {
    vi.useFakeTimers()
    probeCached()
    const child = fakeChild()
    const notify = vi.fn()
    const runner = guardedShellRunner(notify)
    const command = 'sudo apt-get install -y cmake'
    const pending = runner(command, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(cpMock.execFile).toHaveBeenCalledTimes(1)
    child.events.emit('close', 0)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('notifies once and signals the child through the shared rule when the sudo deadline fires', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    const notify = vi.fn()
    const runner = guardedShellRunner(notify)
    const command = 'sudo apt-get install -y cuda-toolkit'
    const pending = runner(command, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(command)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    // The kill rides the shared signalChild rule: SIGINT first.
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    // A shell that survives SIGINT (the fake never exits) escalates to
    // SIGTERM after the grace period, the same rule the abort watch applies.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.events.emit('close', null)
    // The signal exit is replaced by the note-carrying sudo detail.
    await expect(pending).resolves.toEqual({ ok: false, detail: sudoFailureDetail(command) })
  })

  it('group-kills the detached shell through its negative pid at the sudo deadline', async () => {
    vi.useFakeTimers()
    probePrompts()
    const pid = 43_210
    const child = fakeChild(pid)
    const groupSignals: Array<[number, string]> = []
    // The detached spawn makes the shell a process-group leader: the guard's
    // kill signals the whole group, so a sudo survivor of a compound line
    // (`a && sudo b`) dies with the shell. The mock answers the SIGINT, then
    // reads ESRCH on the SIGTERM tick to exercise the direct-kill fallback.
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((target: number, signal: string) => {
        groupSignals.push([target as number, String(signal)])
        if (groupSignals.length > 1) {
          throw Object.assign(new Error('no such process group'), { code: 'ESRCH' })
        }
        return true
      }) as unknown as typeof process.kill)
    try {
      const runner = guardedShellRunner(vi.fn())
      const command = 'sudo apt-get install -y cuda-toolkit && sudo ln -sf x /usr/bin/x'
      const pending = runner(command, { needsSudo: true })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(groupSignals).toEqual([[-pid, 'SIGINT']])
      expect(child.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(groupSignals).toHaveLength(2)
      // The group read ESRCH: the escalation falls back to the direct kill.
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      child.events.emit('close', null)
      await expect(pending).resolves.toEqual({ ok: false, detail: sudoFailureDetail(command) })
    } finally {
      killSpy.mockRestore()
    }
  })

  it('disarms the deadline when the child settles early', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    const notify = vi.fn()
    const runner = guardedShellRunner(notify)
    const pending = runner('sudo apt-get install -y cmake', { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(notify).toHaveBeenCalledTimes(1)
    child.events.emit('close', 0)
    await expect(pending).resolves.toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('keeps the shell exit detail when a guarded command fails before the deadline', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    const runner = guardedShellRunner(vi.fn())
    const command = 'sudo apt-get install -y cmake'
    const pending = runner(command, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    child.events.emit('close', 1)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('exit 1')
    expect(outcome.detail).not.toBe(sudoFailureDetail(command))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('reports a child that fails to start as a failed command', async () => {
    vi.useFakeTimers()
    probeCached()
    const events = new EventEmitter()
    cpMock.spawn.mockReturnValue(
      Object.assign(events, { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() }),
    )
    const runner = guardedShellRunner(vi.fn())
    const pending = runner('apt-get install -y cmake')
    await vi.advanceTimersByTimeAsync(0)
    events.emit('error', new Error('spawn sh ENOENT'))
    const outcome = await pending
    expect(outcome).toEqual({ ok: false, detail: 'spawn sh ENOENT' })
  })
})

describe('ctx.localInfer notifySudoNeeded', () => {
  it('hands the command to the observer registered through the seam', async () => {
    const ctx = await seam()
    const observer = vi.fn()
    ctx.localInfer.registerSudoObserver('provider-a', observer)
    const command = 'sudo ln -sf /usr/local/bin/llama-server /usr/bin/llama-server'
    ctx.localInfer.notifySudoNeeded(command)
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenCalledWith(command)
  })

  it('keeps two concurrent runs\' observers independent: both hear, one dispose keeps the other', async () => {
    const ctx = await seam()
    // Two runs in flight register under their own keys (the runLogKey rule).
    const runA = vi.fn()
    const runB = vi.fn()
    const disposeA = ctx.localInfer.registerSudoObserver('provider-a', runA)
    ctx.localInfer.registerSudoObserver('provider-b', runB)
    const command = 'sudo ln -sf /usr/local/bin/llama-server /usr/bin/llama-server'
    ctx.localInfer.notifySudoNeeded(command)
    // The shared CLI password wait is announced to every run in flight.
    expect(runA).toHaveBeenCalledTimes(1)
    expect(runB).toHaveBeenCalledTimes(1)
    // The first settle clears only its own slot: the second run's note
    // routing survives and keeps hearing later announcements.
    disposeA()
    ctx.localInfer.notifySudoNeeded(command)
    expect(runA).toHaveBeenCalledTimes(1)
    expect(runB).toHaveBeenCalledTimes(2)
  })

  it('lets a re-launch take the key\'s slot, and the stale disposer keeps the live hook', async () => {
    const ctx = await seam()
    const first = vi.fn()
    const disposeFirst = ctx.localInfer.registerSudoObserver('provider-a', first)
    const second = vi.fn()
    ctx.localInfer.registerSudoObserver('provider-a', second)
    // The newer run owns the key's slot: the older hook hears nothing.
    ctx.localInfer.notifySudoNeeded('sudo apt-get install -y cmake')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    // The older run's finally firing late must not clear the live hook.
    disposeFirst()
    ctx.localInfer.notifySudoNeeded('sudo apt-get install -y cmake')
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('swallows a throwing observer so the caller is never broken', async () => {
    const ctx = await seam()
    const listener = vi.fn()
    ctx.localInfer.registerSudoObserver('broken', () => {
      throw new Error('the route is gone')
    })
    // The throwing observer shares the announce with a healthy one, whose
    // delivery the throw must not short-circuit.
    ctx.localInfer.registerSudoObserver('healthy', listener)
    expect(() => ctx.localInfer.notifySudoNeeded('sudo apt-get install -y cmake')).not.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reads as a no-op when nobody is listening', async () => {
    const ctx = await seam()
    // No registerSudoObserver call: the announce stays quiet, so a runner
    // outside this package can call the seam against a headless profile.
    expect(() => ctx.localInfer.notifySudoNeeded('sudo apt-get install -y cmake')).not.toThrow()
  })
})

describe('ctx.localInfer runInstall sudo seam', () => {
  it('announces a waiting install command to the sudo observer and fails at the deadline', async () => {
    const ctx = await seam()
    vi.useFakeTimers()
    const command = 'sudo apt-get install -y cmake'
    ctx.localInfer.registerDepPlan('sudoengine', depPlan(sudoDep('cmake', command)))
    const observer = vi.fn()
    ctx.localInfer.registerSudoObserver('install-engine', observer)
    probePrompts()
    const child = fakeChild()
    const pending = ctx.localInfer.runInstall('sudoengine', 'local', HW)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenCalledWith(command)
    await vi.advanceTimersByTimeAsync(1)
    // The deadline kill rides the shared signalChild rule: SIGINT, then
    // SIGTERM once the grace period finds the shell still alive.
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.events.emit('close', null)
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.results).toEqual([
      { id: 'cmake', status: 'failed', detail: sudoFailureDetail(command) },
    ])
  })

  it('survives a sudo observer that throws and settles the run normally', async () => {
    const ctx = await seam()
    vi.useFakeTimers()
    // The dep's probe answers unsatisfied once, then satisfied: the command
    // run sits between the two checks.
    let probed = 0
    const command = 'sudo apt-get install -y cuda-toolkit'
    ctx.localInfer.registerDepPlan(
      'sudoengine',
      depPlan(sudoDep('cuda', command, async () => ++probed > 1)),
    )
    ctx.localInfer.registerSudoObserver('install-engine', () => {
      throw new Error('the route is gone')
    })
    probePrompts()
    const child = fakeChild()
    const pending = ctx.localInfer.runInstall('sudoengine', 'local', HW)
    await vi.advanceTimersByTimeAsync(0)
    child.events.emit('close', 0)
    const result = await pending
    // The throwing observer was swallowed: the run reads as satisfied.
    expect(result).toEqual({ ok: true, results: [{ id: 'cuda', status: 'satisfied' }] })
  })

  it('caps a waiting command at the deadline even with no observer registered', async () => {
    const ctx = await seam()
    vi.useFakeTimers()
    const command = 'sudo apt-get install -y cmake'
    ctx.localInfer.registerDepPlan('sudoengine', depPlan(sudoDep('cmake', command)))
    // No registerSudoObserver call: the headless profile still guards and
    // kills.
    probePrompts()
    const child = fakeChild()
    const pending = ctx.localInfer.runInstall('sudoengine', 'local', HW)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.events.emit('close', null)
    const result = await pending
    expect(result.results).toEqual([
      { id: 'cmake', status: 'failed', detail: sudoFailureDetail(command) },
    ])
  })
})
