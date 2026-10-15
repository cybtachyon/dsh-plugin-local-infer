import type { LaunchPlan } from './adapter.ts'

/**
 * ProviderLaunchRecord is the persisted launch record one provider config
 * entry carries: the engine process the launch started (pid), when it
 * started (startedAt, an ISO timestamp), the launch arguments (argv), and the
 * DSH process pid that launched it (parentPid). previousPids is the list of
 * DSH process pids that previously launched the engine for this config, so a
 * DSH restart can re-link a surviving engine to its config: the engine's
 * parent is a previous DSH pid that is no longer running (the DSH that
 * launched it died, and the engine re-parented to init), not a live clone of
 * DSH on the same system. A stopped provider clears the whole record, so a
 * recycled pid cannot be re-linked to a config that stopped its engine.
 */
export interface ProviderLaunchRecord {
  pid: number
  startedAt: string
  argv: string[]
  parentPid?: number
  previousPids: number[]
  engineId: string
  modelId?: string
  port?: number
}

/**
 * ReLinkOutcome is the answer to one record's re-link attempt: 'adopted' when
 * the engine is alive and its parent reads as a DSH that launched it (the
 * current DSH, or a previous DSH pid that is no longer running), 'dead' when
 * the engine process is gone (the caller clears the record), and 'foreign'
 * when the engine is alive but its parent is not a known-dead DSH (a user- or
 * clone-launched engine the detector must read as unsure, not adopt).
 */
export type ReLinkOutcome = 'adopted' | 'dead' | 'foreign'

/**
 * ReLinkInput is the probe surface one re-link attempt runs against: the
 * record, the current DSH process pid, and the process probes the rule
 * prices. The probes are injectable, so a test prices a live or dead engine
 * without a live process table.
 */
export interface ReLinkInput {
  record: ProviderLaunchRecord
  currentDshPid: number
  processAlive: (pid: number) => boolean
  commandLine: (pid: number) => string | undefined
}

/**
 * reLinkRecord resolves one stored launch record against the running process
 * table. The order is the resilience contract:
 * 1. The engine pid is not alive: 'dead', so the caller clears the record
 *    (including the previous-pid list) and a recycled pid cannot re-link.
 * 2. The engine pid is alive but its command line no longer carries the
 *    record's launch arguments: 'foreign', a pid a different process
 *    recycled. A command line the probe cannot read degrades to a match, the
 *    same neutral rule the launch-signature matcher applies to a missing env
 *    element.
 * 3. The parent rule: the record's parentPid is the current DSH pid (this
 *    DSH launched the engine), or it is one of the record's previous DSH
 *    pids that is no longer running (a previous DSH launched the engine and
 *    has died, so the engine is an orphan this DSH adopts). A previous pid
 *    that is still running reads as a live DSH clone that owns the engine,
 *    and a parent pid no list names reads as a user-launched engine: both
 *    are 'foreign'.
 */
export function reLinkRecord(input: ReLinkInput): ReLinkOutcome {
  const record = input.record
  if (!input.processAlive(record.pid)) return 'dead'
  const command = input.commandLine(record.pid)
  if (command !== undefined && !commandMatchesArgv(command, record.argv)) return 'foreign'
  if (record.parentPid !== undefined && record.parentPid === input.currentDshPid) {
    return 'adopted'
  }
  if (
    record.parentPid !== undefined &&
    record.previousPids.includes(record.parentPid) &&
    !input.processAlive(record.parentPid)
  ) {
    return 'adopted'
  }
  return 'foreign'
}

/**
 * commandMatchesArgv reports whether a running process's command line carries
 * the launch arguments a record stored: every argv token must appear in the
 * command line as a substring. The tokens are the plan's own argv (the engine
 * binary, the model path, the port flag), so a recycled pid that now runs a
 * different program fails the match. An empty argv matches any command line,
 * which reads as "no arguments to confirm" rather than a mismatch.
 */
export function commandMatchesArgv(command: string, argv: readonly string[]): boolean {
  if (argv.length === 0) return true
  return argv.every((token) => command.includes(token))
}

/**
 * launchRecordFromPlan builds the launch record a successful launch persists
 * for a provider config entry: the deploy step's process pid, the current
 * time, the plan's argv, the DSH process pid that launched the engine (only
 * when the process identified as DSH, so a non-DSH host never writes a
 * parent the re-link rule cannot price), and the previous-pid list capped at
 * the last eight entries (a long-lived config accumulates one pid per DSH
 * restart, and the cap keeps the record bounded).
 */
export function launchRecordFromPlan(
  plan: LaunchPlan,
  pid: number,
  parentPid: number | undefined,
  previousPids: readonly number[],
): ProviderLaunchRecord {
  // A launch whose parent did not identify as DSH adds no pid to the list:
  // the re-link rule cannot price a parent it never saw, and the record
  // degrades to 'foreign' after a restart rather than a wrong adoption.
  const record: ProviderLaunchRecord = {
    pid,
    startedAt: new Date().toISOString(),
    argv: plan.argv ?? [],
    previousPids: [...previousPids, ...(parentPid !== undefined ? [parentPid] : [])].slice(-8),
    engineId: plan.engineId,
  }
  if (parentPid !== undefined) {
    record.parentPid = parentPid
  }
  if (plan.modelId !== undefined) {
    record.modelId = plan.modelId
  }
  if (plan.port !== undefined) {
    record.port = plan.port
  }
  return record
}
