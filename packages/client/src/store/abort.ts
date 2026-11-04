/**
 * The in-flight Get/Launch abort registry: the provider form's Cancel (the
 * t.cancel control) aborts the in-flight Get run and the entry's Launch run.
 * The abort closes the client stream, and the route's response close
 * interrupts the in-flight hf child on the host (SIGINT, then SIGTERM), so a
 * canceled download stops instead of running to the timeout, and the
 * hub-cache .incomplete blob resumes on the re-run. Each driver registers its
 * AbortController when the run starts and forgets it when the run settles, so
 * a settled run never reads as in flight.
 * @module dsh-plugin-local-infer/client/store/abort
 */

const activeGets = new Set<AbortController>()
const activeLaunches = new Map<string, AbortController>()

/** trackGetAbort registers an in-flight Get run's controller. */
export function trackGetAbort(controller: AbortController): void {
  activeGets.add(controller)
}

/** forgetGetAbort drops a settled Get run's controller. */
export function forgetGetAbort(controller: AbortController): void {
  activeGets.delete(controller)
}

/** trackLaunchAbort registers an in-flight Launch run's controller under the provider id. */
export function trackLaunchAbort(providerId: string, controller: AbortController): void {
  activeLaunches.set(providerId, controller)
}

/** forgetLaunchAbort drops a settled Launch run's controller. */
export function forgetLaunchAbort(providerId: string): void {
  activeLaunches.delete(providerId)
}

/**
 * cancelInFlightRuns aborts the in-flight Get runs and, when a provider id
 * is named, that provider's in-flight Launch run (every Launch run when it is
 * absent). It returns whether any run was aborted, so the caller knows the
 * "Canceled" line lands in the Logs buffer.
 */
export function cancelInFlightRuns(providerId?: string): boolean {
  let aborted = false
  for (const controller of activeGets) {
    controller.abort()
    aborted = true
  }
  activeGets.clear()
  if (providerId !== undefined) {
    const controller = activeLaunches.get(providerId)
    if (controller !== undefined) {
      controller.abort()
      activeLaunches.delete(providerId)
      aborted = true
    }
    return aborted
  }
  for (const controller of activeLaunches.values()) {
    controller.abort()
    aborted = true
  }
  activeLaunches.clear()
  return aborted
}
