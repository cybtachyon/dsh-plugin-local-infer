/**
 * The System dependencies panel: the per-dep status list, the copy/paste
 * install block, the allow-run trust gate, the Play/Run arrow (only while
 * the trust gate is on), and the "Get" gate that stays disabled until every
 * dep reports satisfied. The panel is a pure draw of the store's deps model
 * (the /local-infer/deps route's answer); the copy, allow-run, install, and
 * Get actions ride the store's deps + notes cells through the store/deps.ts
 * drivers, so the panel keeps no state of its own.
 * @module dsh-plugin-local-infer/client/render/DepsPanel
 */
import type { ReactNode } from 'react';
import type { TextTable } from '../text.ts';
import type { CardStore } from '../store/sync.ts';
export interface DepsPanelProps {
    store: CardStore;
    t: TextTable;
}
/**
 * DepsPanel renders the System dependencies section from the store's deps
 * model. A null model (no route, or a re-price failure) renders nothing, so
 * a host that predates the deps route keeps the card usable. The copy
 * button hands the install block to the clipboard (the copy note reports
 * it); the allow-run checkbox persists the trust gate through a
 * settings-only save; the Play/Run arrow runs the install route and
 * re-checks the gate; the Get gate runs the build stream and stays disabled
 * until every dep is satisfied.
 */
export declare function DepsPanel(props: DepsPanelProps): ReactNode;
//# sourceMappingURL=DepsPanel.d.ts.map
