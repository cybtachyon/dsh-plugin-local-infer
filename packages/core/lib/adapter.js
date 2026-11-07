/**
 * LaunchStep is the phase of a launch the card's Launch control prices: the
 * system-dependency install (prereqs), the model and git checkout download
 * (download), the source build or image pull (build), and the health poll that
 * waits for the engine to come ready (launch). The service and the adapters
 * report the step as each phase begins, so the card's button reads the phase
 * that is actually running instead of a single "Launching..." for the whole
 * rebuild. The card times out only the launch step; the rebuild steps (prereqs,
 * download, build) run as long as they need to.
 */
/**
 * LAUNCH_STEPS is the step-name tuple the LaunchStep union derives from: the
 * one runtime home of the four phase names. The client machine mirrors the
 * tuple as its LAUNCH_PHASE_STATES (the card bundle carries no core code); the
 * ui suite pins the two sides equal so a name added on one side without the
 * other fails a test, not the button.
 */
export const LAUNCH_STEPS = ['prereqs', 'download', 'build', 'launch'];
/**
 * COMMAND_LOG_PREFIX leads the exec audit rule's command line in every run
 * log: `$ ` then the command, newline-terminated. Every exec site (the service
 * runners, the adapters' auditRun, the acquire step's echo, the Get steps'
 * extra-command emit) formats through commandLogLine, so the marker has one
 * home. The marker is also exported for the test stubs that replay a real
 * service or runner's writes.
 */
export const COMMAND_LOG_PREFIX = '$ ';
/**
 * commandLogLine formats one exec audit rule line: the COMMAND_LOG_PREFIX, the
 * command, and the newline. The `$ <command>` line reaches the run's log sink
 * before the child spawns.
 */
export function commandLogLine(command) {
    return `${COMMAND_LOG_PREFIX}${command}\n`;
}
/**
 * URL_LOG_PREFIX leads the URL audit rule's request line in every run log:
 * `> GET ` then the URL. The health polls format through urlLogLine, so the
 * marker has one home (the exec rule's URL twin).
 */
export const URL_LOG_PREFIX = '> GET ';
/**
 * urlLogLine formats one URL audit rule line: the URL_LOG_PREFIX, the URL, an
 * optional settled verdict word the poll appends after a space (`ready`,
 * `still downloading: ...`), and the newline. The bare line reaches the run's
 * log sink before the first request; the verdict line lands after the poll
 * returns.
 */
export function urlLogLine(url, verdict) {
    return `${URL_LOG_PREFIX}${url}${verdict === undefined ? '' : ` ${verdict}`}\n`;
}
/**
 * EngineAdapter is the abstract base one subclass implements per engine. It
 * owns the engine's parameter surface and turns a config into a launch plan,
 * deploys it, health-checks it, and stops it. NInfer is the canonical adapter
 * that supports both docker and local; the others follow the same shape.
 * `deploy` takes the platform config so it clones the fork into the engine
 * directory; `healthCheck` takes poll options so the service prices the poll
 * from the config.
 */
export class EngineAdapter {
    /**
     * planKey is the children-map key an adapter tracks a spawned engine
     * process under: the plan's engine id and port, the pair that identifies
     * one running engine. The base class owns the rule, so every adapter
     * tracks and stops the exact process it started.
     */
    planKey(plan) {
        return `${plan.engineId}:${plan.port}`;
    }
}
//# sourceMappingURL=adapter.js.map
