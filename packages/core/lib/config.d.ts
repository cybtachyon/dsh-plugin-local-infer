/**
 * Config is the resolved parameter configuration for one engine and model.
 * core stays framework-free, so it is a plain record. The service layer
 * validates a concrete config with a schemastery schema before it reaches the
 * estimator, adapters, or guidelines.
 */
export type Config = Record<string, unknown>;
/**
 * CustomArg is one row of the card's Custom Arguments table: a parameter or
 * flag the user adds to the engine's launch command, and the optional value it
 * takes. A row with a key and no value is a bare flag; a row with a value is a
 * flag-plus-argument pair. The card stores these under `config.customArgs` and
 * the adapters append them to the launch argv (or the compose env) on the next
 * engine launch.
 */
export interface CustomArg {
    key: string;
    value?: string;
}
//# sourceMappingURL=config.d.ts.map