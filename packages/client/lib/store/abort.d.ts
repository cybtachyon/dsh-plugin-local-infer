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
/** trackGetAbort registers an in-flight Get run's controller. */
export declare function trackGetAbort(controller: AbortController): void;
/** forgetGetAbort drops a settled Get run's controller. */
export declare function forgetGetAbort(controller: AbortController): void;
/** trackLaunchAbort registers an in-flight Launch run's controller under the provider id. */
export declare function trackLaunchAbort(providerId: string, controller: AbortController): void;
/** forgetLaunchAbort drops a settled Launch run's controller. */
export declare function forgetLaunchAbort(providerId: string): void;
/**
 * cancelInFlightRuns aborts the in-flight Get runs and, when a provider id
 * is named, that provider's in-flight Launch run (every Launch run when it is
 * absent). It returns whether any run was aborted, so the caller knows the
 * "Canceled" line lands in the Logs buffer.
 */
export declare function cancelInFlightRuns(providerId?: string): boolean;
//# sourceMappingURL=abort.d.ts.map
