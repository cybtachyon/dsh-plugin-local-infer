/**
 * The lifecycle host's sudo wiring (TASK-003): createNodeLifecycleHost's
 * optional sudo hook around core's guardSudoCommand. No test runs a real sudo
 * or waits a real clock: node:child_process is mocked (execFile answers the
 * probe, exec and spawn hand back fake children) and vitest's fake timers
 * drive the 60 s password deadline and the SIGINT-to-SIGTERM escalation. The
 * rule itself lives in core; these tests pin the host wiring: a declared run
 * probes, announces once, signals the child through the shared rule at the
 * deadline (the detached streaming shell through its negative group pid), and
 * settles with the sudo failure detail; undeclared runs and a hookless host
 * never touch the guard. The file is separate from
 * adapters.spec.ts because that suite drives real child processes and this
 * one replaces node:child_process module-wide, the same split the service's
 * sudo seam test made (packages/service/tests/sudo.spec.ts).
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUDO_PROBE_COMMAND, sudoFailureDetail } from 'dsh-plugin-local-infer/core'
import { createNodeLifecycleHost } from '../src/adapters.ts'

// The child-process mock: the suite owns execFile (the sudo probe), exec
// (the plain run's child), and spawn (the streaming child). Everything else
// in the namespace stays real, the same delegate-to-original shape the
// service's sudo suite uses.
const cpMock = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, exec: cpMock.exec, execFile: cpMock.execFile, spawn: cpMock.spawn }
})

const LINK = 'sudo ln -sf /src/ninfer/build/ninfer-serve /usr/local/bin/ninfer-serve'

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
  /** The direct-kill recorder: the shared signalChild rule lands here. */
  kill: ReturnType<typeof vi.fn>
  /** The object handed back by the exec/spawn mocks. */
  node: EventEmitter & {
    kill: ReturnType<typeof vi.fn>
    killed: boolean
    exitCode: number | null
    signalCode: string | null
    stdout: EventEmitter
    stderr: EventEmitter
  }
}

/**
 * A fake child the signal rule can read: exitCode and signalCode stay null
 * (so a SIGINT-ignoring child escalates to SIGTERM) until a test settles it.
 * An optional pid makes the child a process-group target for the group-kill
 * test; without one, signalChild delivers the direct kill.
 */
function fakeChild(pid?: number): FakeChild {
  const events = new EventEmitter()
  const kill = vi.fn()
  const node = Object.assign(events, {
    kill,
    ...(pid === undefined ? {} : { pid }),
    killed: false,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  return { events, kill, node }
}

/**
 * Arms the exec mock to hand back one fake child and returns a settle that
 * drives the exec callback (the plain run's only settle path). Marking the
 * child exited mirrors the real shell after its callback fires, so a later
 * escalation tick finds a dead child.
 */
function fakeExec(child: FakeChild): (error: Error | null) => void {
  let settle:
    | ((error: Error | null, stdout: string, stderr: string) => void)
    | undefined
  cpMock.exec.mockImplementation((_cmd, _opts, callback) => {
    settle = callback
    return child.node
  })
  return (error) => {
    child.node.exitCode = error === null ? 0 : 1
    settle?.(error, '', '')
  }
}

/** Arms the spawn mock (the streaming child) to hand back one fake child. */
function fakeSpawn(child: FakeChild): void {
  cpMock.spawn.mockReturnValue(child.node)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createNodeLifecycleHost sudo hook', () => {
  it('never probes or notifies a run the caller did not declare sudo for', async () => {
    vi.useFakeTimers()
    probeCached()
    const notify = vi.fn()
    const host = createNodeLifecycleHost(undefined, { notify })
    // The plain run: a bare command line settles through the exec callback.
    const child = fakeChild()
    const settle = fakeExec(child)
    const plain = host.run('make install')
    await vi.advanceTimersByTimeAsync(0)
    settle(null)
    await expect(plain).resolves.toEqual({ ok: true })
    // The streamed run: a present-but-false declaration is equally unguarded.
    const streamChild = fakeChild()
    fakeSpawn(streamChild)
    const streamed = host.runStream('cmake --build build', () => {}, {
      needsSudo: false,
    })
    await vi.advanceTimersByTimeAsync(0)
    streamChild.events.emit('close', 0)
    await expect(streamed).resolves.toEqual({ ok: true })
    expect(cpMock.execFile).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('runs a declared-sudo command with cached credentials unannounced', async () => {
    vi.useFakeTimers()
    probeCached()
    const child = fakeChild()
    fakeSpawn(child)
    const notify = vi.fn()
    const host = createNodeLifecycleHost(undefined, { notify })
    const pending = host.runStream(LINK, () => {}, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(cpMock.execFile).toHaveBeenCalledTimes(1)
    expect(cpMock.execFile).toHaveBeenCalledWith(
      SUDO_PROBE_COMMAND[0],
      [...SUDO_PROBE_COMMAND.slice(1)],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
    child.events.emit('close', 0)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('announces once and signals the child through the shared escalation (runStream)', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    fakeSpawn(child)
    const notify = vi.fn()
    const host = createNodeLifecycleHost(undefined, { notify })
    // The short grace keeps the SIGTERM escalation off the 5 s production
    // constant, the same seam the abort tests use.
    const pending = host.runStream(LINK, () => {}, { needsSudo: true, graceMs: 100 })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(LINK)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    // A child that survives SIGINT (the fake never exits on its own) gets
    // SIGTERM after the grace period, the shared watchChildAbort rule.
    await vi.advanceTimersByTimeAsync(99)
    expect(child.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    // The sudo failure detail wins over the exit the killed child reports,
    // even a nominally clean one.
    child.events.emit('close', 0)
    await expect(pending).resolves.toEqual({ ok: false, detail: sudoFailureDetail(LINK) })
  })

  it('group-kills the detached streaming shell through its negative pid at the deadline', async () => {
    vi.useFakeTimers()
    probePrompts()
    const pid = 43_210
    const child = fakeChild(pid)
    fakeSpawn(child)
    // The build shell spawns detached (a process-group leader), so the
    // guard's kill signals the whole group and a sudo survivor of a
    // compound line dies with the shell. The mock answers the SIGINT, then
    // reads ESRCH on the SIGTERM tick to exercise the direct-kill fallback.
    const groupSignals: Array<[number, string]> = []
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
      const host = createNodeLifecycleHost(undefined, { notify: vi.fn() })
      const pending = host.runStream(LINK, () => {}, { needsSudo: true, graceMs: 100 })
      await vi.advanceTimersByTimeAsync(60_000)
      // The streaming host spawns the shell detached so the guard's signal
      // can reach the whole process group.
      expect(cpMock.spawn).toHaveBeenCalledWith(
        LINK,
        expect.objectContaining({ detached: true, shell: true }),
      )
      expect(groupSignals).toEqual([[-pid, 'SIGINT']])
      expect(child.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(groupSignals).toHaveLength(2)
      // The group read ESRCH: the escalation falls back to the direct kill.
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      child.events.emit('close', null)
      await expect(pending).resolves.toEqual({ ok: false, detail: sudoFailureDetail(LINK) })
    } finally {
      killSpy.mockRestore()
    }
  })

  it('settles a plain run with the sudo detail when the deadline fires', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    const settle = fakeExec(child)
    const notify = vi.fn()
    const host = createNodeLifecycleHost(undefined, { notify })
    const pending = host.run(LINK, { needsSudo: true, graceMs: 100 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    // The shell reports the killed run as an error exit; the outcome is
    // replaced by the note-carrying sudo detail regardless.
    settle(new Error('Command failed: sudo'))
    await expect(pending).resolves.toEqual({ ok: false, detail: sudoFailureDetail(LINK) })
    // The deadline was disarmed on the settle: no further signals land.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('disarms the deadline when the child settles before it fires', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    fakeSpawn(child)
    const host = createNodeLifecycleHost(undefined, { notify: vi.fn() })
    const pending = host.runStream(LINK, () => {}, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    child.events.emit('close', 0)
    await expect(pending).resolves.toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('keeps the shell exit detail when a guarded command fails before the deadline', async () => {
    vi.useFakeTimers()
    probePrompts()
    const child = fakeChild()
    fakeSpawn(child)
    const host = createNodeLifecycleHost(undefined, { notify: vi.fn() })
    const pending = host.runStream(LINK, () => {}, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    child.events.emit('close', 1)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('exit 1')
    expect(outcome.detail).not.toBe(sudoFailureDetail(LINK))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('never probes on a host built without the sudo hook', async () => {
    vi.useFakeTimers()
    probeCached()
    const child = fakeChild()
    const settle = fakeExec(child)
    // No hook: today's behavior exactly, even for a declared-sudo run.
    const host = createNodeLifecycleHost()
    const pending = host.run(LINK, { needsSudo: true })
    await vi.advanceTimersByTimeAsync(0)
    settle(null)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(cpMock.execFile).not.toHaveBeenCalled()
  })
})
