/**
 * The in-flight Get/Launch abort registry: the provider form's Cancel (the
 * t.cancel control) aborts the in-flight Get run and the entry's Launch run.
 * The abort closes the client stream, and the route's response close
 * interrupts the in-flight hf child on the host (SIGINT, then SIGTERM), so a
 * canceled download stops instead of running to the timeout. Resume is
 * within-invocation only; a canceled/killed run re-downloads from zero on the
 * re-run (the orphaned .incomplete blob lingers until `hf cache prune`). Each
 * driver registers its
 * AbortController when the run starts and forgets it when the run settles, so
 * a settled run never reads as in flight.
 * @module dsh-plugin-local-infer/client/store/abort
 */
const activeGets = new Set();
const activeLaunches = new Map();
/** trackGetAbort registers an in-flight Get run's controller. */
export function trackGetAbort(controller) {
    activeGets.add(controller);
}
/** forgetGetAbort drops a settled Get run's controller. */
export function forgetGetAbort(controller) {
    activeGets.delete(controller);
}
/**
 * hasInFlightGet reports whether a Get run is in flight (registered and not
 * yet settled). A long download that outlived the idle cap and settled the get
 * cell keeps streaming in the background, so this stays true while the cell
 * reads as idle: a second Get click reads as a no-op, not a concurrent run.
 */
export function hasInFlightGet() {
    return activeGets.size > 0;
}
/**
 * clearInFlightRuns drops every registered Get and Launch controller without
 * aborting them, so a test starts from an empty registry (the module-level
 * sets outlive a single test).
 */
export function clearInFlightRuns() {
    activeGets.clear();
    activeLaunches.clear();
}
/** trackLaunchAbort registers an in-flight Launch run's controller under the provider id. */
export function trackLaunchAbort(providerId, controller) {
    activeLaunches.set(providerId, controller);
}
/** forgetLaunchAbort drops a settled Launch run's controller. */
export function forgetLaunchAbort(providerId) {
    activeLaunches.delete(providerId);
}
/**
 * cancelInFlightRuns aborts the in-flight Get runs and, when a provider id
 * is named, that provider's in-flight Launch run (every Launch run when it is
 * absent). It returns whether any run was aborted, so the caller knows the
 * "Canceled" line lands in the Logs buffer.
 */
export function cancelInFlightRuns(providerId) {
    let aborted = false;
    for (const controller of activeGets) {
        controller.abort();
        aborted = true;
    }
    activeGets.clear();
    if (providerId !== undefined) {
        const controller = activeLaunches.get(providerId);
        if (controller !== undefined) {
            controller.abort();
            activeLaunches.delete(providerId);
            aborted = true;
        }
        return aborted;
    }
    for (const controller of activeLaunches.values()) {
        controller.abort();
        aborted = true;
    }
    activeLaunches.clear();
    return aborted;
}
//# sourceMappingURL=abort.js.map
