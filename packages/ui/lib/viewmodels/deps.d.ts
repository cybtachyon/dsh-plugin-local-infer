/**
 * The deps panel view model: the detected hardware (with its package
 * manager), the dep plan the service resolves, the per-dep statuses, the
 * copy/paste install string, and the Play/Run trust gate the stored config
 * carries. resolveBuildMode picks the deploy mode the plan prices, the same
 * value the docker-not-installed guideline reads, so the panel and the
 * warning never disagree about the mode.
 * @module dsh-plugin-local-infer/ui/viewmodels/deps
 */
import type { Config } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { EngineInfo } from '../../../providers/lib/index.js';
import type { DepsModel } from '../deps.ts';
import type { DepsRequest } from '../request.ts';
/**
 * resolveBuildMode picks the deploy mode the dep plan prices: the config's
 * buildMode when the selected engine supports it, else the engine's default
 * (local when the engine can build locally, docker when it cannot). The
 * docker-not-installed guideline reads this same value, so the panel and the
 * warning never disagree about the mode.
 */
export declare function resolveBuildMode(engine: EngineInfo, config: Config): 'docker' | 'local';
/**
 * buildDeps assembles the deps panel read model for one engine and config:
 * the detected hardware (with its package manager), the dep plan the service
 * resolves, the per-dep statuses, the copy/paste install string, and the
 * Play/Run trust gate the stored config carries.
 */
export declare function buildDeps(localInfer: LocalInferService, request?: DepsRequest): Promise<DepsModel>;
//# sourceMappingURL=deps.d.ts.map