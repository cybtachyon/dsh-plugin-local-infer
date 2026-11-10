/**
 * The Play/Run helper for the deps panel: runInstallFor refuses with a 409
 * while the trust gate is off (the copy/paste path is always the fallback),
 * runs the install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes.
 * @module dsh-plugin-local-infer/ui/viewmodels/depsHelpers
 */
import type { InstallResult } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { DepsModel } from '../deps.ts';
import type { DepsRequest } from '../request.ts';
/**
 * InstallResponse is the answer to a Play/Run: the install result and the
 * refreshed deps model, so the card re-renders the gate from the same
 * re-check the install ran.
 */
export interface InstallResponse {
    result: InstallResult;
    deps: DepsModel;
}
/**
 * runInstallFor is the Play/Run path: it refuses with a 409 while the
 * trust gate is off (the copy/paste path is always the fallback), runs the
 * install through the service, and refreshes the deps model from the
 * re-check, so the "Get" gate opens only after a re-check passes. A run that
 * actually starts brackets one live hub run under the runLogKey rule (the
 * stored entry matching the engine and model, else the engine id): the seed
 * is the "Installing deps..." separator, the service writes each install
 * command's `$ <command>` line into the run (through onLog) before its child
 * spawns, each per-dep install result appends in the Get step's
 * `  <id>: <status>` shape, and the run ends at settle, a throwing install
 * included. The settle text also folds through the shared run-section persister
 * (finishRunSection over the pre-run baseline), so the last install run
 * survives a card reload in the stored last-run logs and the log file, like
 * the other provider processes; the baseline close keeps the sudo note the
 * observer persists mid-run from landing twice. The run registers the sudo
 * hook the launch and Get paths register, so a guarded dependency install
 * waiting for a password on the CLI lands the shared SUDO_CLI_NOTE line in
 * the live run and the persisted run. A 409 refusal starts no run.
 */
export declare function runInstallFor(localInfer: LocalInferService, request: DepsRequest): Promise<InstallResponse>;
//# sourceMappingURL=depsHelpers.d.ts.map
