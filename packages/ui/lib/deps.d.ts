/**
 * DepsModel is the render model the Web panel draws the "System dependencies"
 * section from: the per-dep status list (each with its purpose and sudo
 * flag), the copy/paste install string, the Play/Run trust gate, and the
 * "Get" gate the plan names (disabled until every dep reports satisfied).
 * The model is pure data the card draws, so the mapping stays unit-testable
 * here.
 * @module @dsh/dsh-plugin-local-infer/ui/deps
 */
import type { DepCheck, DepStatus } from '@dsh/dsh-plugin-local-infer/core';
/**
 * DepItemModel is one row of the panel's dep list: the dep id, the purpose
 * the user reads, the current status, and whether installing it needs sudo.
 */
export interface DepItemModel {
    id: string;
    purpose: string;
    status: DepStatus;
    requiresSudo: boolean;
}
/**
 * DepsModel is the whole panel: the dep list, the install string the Copy
 * button hands to the clipboard, the package manager the string was rendered
 * for (null when none was detected), the Play/Run trust gate (allowRunDeps),
 * and the "Get" gate (allSatisfied).
 */
export interface DepsModel {
    engineId: string;
    buildMode: 'docker' | 'local';
    packageManager: string | null;
    deps: DepItemModel[];
    allSatisfied: boolean;
    installString: string;
    runAllowed: boolean;
}
/**
 * renderDeps maps the checkDeps results and the rendered install string to
 * the panel model. The "Get" gate is the plan's contract: it opens only when
 * every required dep reports satisfied, and an empty plan (nothing to
 * install) opens it, because there is nothing left to install.
 */
export declare function renderDeps(input: {
    engineId: string;
    buildMode: 'docker' | 'local';
    packageManager: string | null;
    checks: DepCheck[];
    installString: string;
    runAllowed: boolean;
}): DepsModel;
//# sourceMappingURL=deps.d.ts.map