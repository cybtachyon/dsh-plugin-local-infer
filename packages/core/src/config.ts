/**
 * Config is the resolved parameter configuration for one engine and model.
 * core stays framework-free, so it is a plain record. The service layer
 * validates a concrete config with a schemastery schema before it reaches the
 * estimator, adapters, or guidelines.
 */
export type Config = Record<string, unknown>
