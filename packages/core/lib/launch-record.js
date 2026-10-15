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
export function reLinkRecord(input) {
    const record = input.record;
    if (!input.processAlive(record.pid))
        return 'dead';
    const command = input.commandLine(record.pid);
    if (command !== undefined && !commandMatchesArgv(command, record.argv))
        return 'foreign';
    if (record.parentPid !== undefined && record.parentPid === input.currentDshPid) {
        return 'adopted';
    }
    if (record.parentPid !== undefined &&
        record.previousPids.includes(record.parentPid) &&
        !input.processAlive(record.parentPid)) {
        return 'adopted';
    }
    return 'foreign';
}
/**
 * commandMatchesArgv reports whether a running process's command line carries
 * the launch arguments a record stored: every argv token must appear in the
 * command line as a substring. The tokens are the plan's own argv (the engine
 * binary, the model path, the port flag), so a recycled pid that now runs a
 * different program fails the match. An empty argv matches any command line,
 * which reads as "no arguments to confirm" rather than a mismatch.
 */
export function commandMatchesArgv(command, argv) {
    if (argv.length === 0)
        return true;
    return argv.every((token) => command.includes(token));
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
export function launchRecordFromPlan(plan, pid, parentPid, previousPids) {
    // A launch whose parent did not identify as DSH adds no pid to the list:
    // the re-link rule cannot price a parent it never saw, and the record
    // degrades to 'foreign' after a restart rather than a wrong adoption.
    const record = {
        pid,
        startedAt: new Date().toISOString(),
        argv: plan.argv ?? [],
        previousPids: [...previousPids, ...(parentPid !== undefined ? [parentPid] : [])].slice(-8),
        engineId: plan.engineId,
    };
    if (parentPid !== undefined) {
        record.parentPid = parentPid;
    }
    if (plan.modelId !== undefined) {
        record.modelId = plan.modelId;
    }
    if (plan.port !== undefined) {
        record.port = plan.port;
    }
    return record;
}
//# sourceMappingURL=launch-record.js.map