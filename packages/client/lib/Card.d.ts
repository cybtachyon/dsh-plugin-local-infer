/**
 * The card composer: the browser card's single source of truth binding plus
 * the panel layout. It calls useCardStore (the only component that does),
 * renders every panel from the store snapshot, and wires every server
 * mutation through a performAction driver. The title-bar Launch/Stop control
 * renders from deriveLifecycleControl (the single lifecycle derivation), and
 * the debounced re-price (300 ms) is the only field-edit side effect.
 *
 * The card is a thin composer: the panels (the provider list, the deps panel,
 * the logs pane, the meter, the custom-args table, the chat-template field)
 * are their own components that take the store as a prop, and the form fields
 * (the renderField renderer) are drawn inline. Every panel and field renders
 * as a JSX element, never as a function call: a call would run the component's
 * hooks in the card's own hook context, and the card's hook count would vary
 * with the form model (a re-price that changes the field list then throws the
 * hook-order invariants 308/310). The card owns the store
 * binding, the field-edit callbacks (the draft edits and the debounced
 * re-price), and the action wiring (the save, discard, register, unregister,
 * launch, stop, download, and chat-template drivers).
 * @module dsh-plugin-local-infer/client/Card
 */
import type { ReactNode } from 'react';
import { type PrimitivesModule } from './render/primitives.tsx';
/**
 * LocaleService is the host locale seam the card reads the active locale
 * from. The dsh-client-locale plugin provides a LocaleRuntime under the
 * `locale` seam: getSnapshot().active is the active locale id, and subscribe
 * notifies on a locale switch so the card re-renders its label table.
 */
export interface LocaleService {
    getSnapshot(): {
        active: string;
    };
    subscribe(listener: () => void): () => void;
}
/**
 * LocaleRef is the locale handle the card reads the active locale from. The
 * bootstrap (plugin.ts) keeps it current through the locale seam and hands it
 * to the card, so the card draws the label table for the active locale.
 */
export interface LocaleRef {
    current: LocaleService | null;
}
/**
 * localeStores builds the useSyncExternalStore locale pair over the handle:
 * a subscribe that binds to the current seam (a no-op while it is null) and
 * a reader of the active locale id. Each card factory calls it once per
 * mount, so the closures stay stable across renders and the hook does not
 * re-subscribe.
 */
export declare function localeStores(localeRef: LocaleRef): {
    subscribeLocale: (onChange: () => void) => () => void;
    readLocale: () => string;
};
/**
 * card builds the browser card component factory. It has the same
 * (react, localeRef, primitives) shape as the placeholder the bootstrap used,
 * so plugin.ts swaps it in 1:1. The returned component calls useCardStore
 * (the only component that does), renders every panel from the store
 * snapshot, and wires every server mutation through a performAction driver.
 */
export declare function card(_react: unknown, localeRef: LocaleRef, _primitives: PrimitivesModule | null): () => ReactNode;
//# sourceMappingURL=Card.d.ts.map
