/**
 * The shared Logs buffer helpers the provider and deps store modules both
 * write through: the line append, the raw streamed chunk append, the
 * whole-buffer replace, and the "Canceled" line the abort paths write. The
 * run's own seed separator is the host's (beginRun seeds the hub, whose
 * runBegin/snapshot replaces the buffer), so no client seed helper remains.
 *
 * The helpers live in a leaf module so deps.ts and providers.ts import them
 * from one place without an import edge between the two modules.
 * @module dsh-plugin-local-infer/client/store/logs
 */
import type { CardStore } from './sync.ts';
/**
 * SUDO_NOTE_LINE is the client's copy of the host's core SUDO_CLI_NOTE (the
 * client bundle cannot import the node-side core package, so the two copies
 * change together by hand). The launch stream's sudo event appends it to the
 * Logs buffer, the same line the host persists to the log file, so the
 * textarea tells the user where to type the password.
 */
export declare const SUDO_NOTE_LINE = "Check your CLI for a sudo prompt";
export declare function separatorLine(label: string): string;
export declare function appendProcessLog(store: CardStore, line: string): void;
export declare function appendLogChunk(store: CardStore, chunk: string): void;
export declare function replaceLogBuffer(store: CardStore, text: string): void;
export declare function appendCanceledLog(store: CardStore): void;
//# sourceMappingURL=logs.d.ts.map
