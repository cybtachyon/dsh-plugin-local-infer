/**
 * The shared Logs buffer helpers the provider and deps store modules both
 * write through: the run separator seed, the line append, the raw streamed
 * chunk append, and the "Canceled" line the abort paths write.
 *
 * The helpers live in a leaf module so deps.ts and providers.ts import them
 * from one place without an import edge between the two modules.
 * @module dsh-plugin-local-infer/client/store/logs
 */
import type { CardStore } from './sync.ts';
export declare function separatorLine(label: string): string;
export declare function seedProcessLog(store: CardStore, label: string): void;
export declare function appendProcessLog(store: CardStore, line: string): void;
export declare function appendLogChunk(store: CardStore, chunk: string): void;
export declare function appendCanceledLog(store: CardStore): void;
//# sourceMappingURL=logs.d.ts.map
