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
