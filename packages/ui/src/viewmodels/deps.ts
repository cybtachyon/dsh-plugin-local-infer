/**
 * The deps panel view model: the detected hardware (with its package
 * manager), the dep plan the service resolves, the per-dep statuses, the
 * copy/paste install string, and the Play/Run trust gate the stored config
 * carries. resolveBuildMode picks the deploy mode the plan prices, the same
 * value the docker-not-installed guideline reads, so the panel and the
 * warning never disagree about the mode.
 * @module dsh-plugin-local-infer/ui/viewmodels/deps
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from 'dsh-plugin-local-infer/core'
import {
  CHAT_TEMPLATE_FILE,
  checkDeps,
  hfChatTemplateCommand,
  renderInstallString,
} from '../../../core/lib/index.js'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import { ENGINES } from '../../../providers/lib/index.js'
import type { EngineInfo } from '../../../providers/lib/index.js'
import { readConfig } from '../config.ts'
import type { ChatTemplateDepModel, DepsModel } from '../deps.ts'
import { renderDeps } from '../deps.ts'
import type { DepsRequest } from '../request.ts'
import { isHfRepoReference } from './summaryHelpers.ts'

/**
 * resolveBuildMode picks the deploy mode the dep plan prices: the config's
 * buildMode when the selected engine supports it, else the engine's default
 * (local when the engine can build locally, docker when it cannot). The
 * docker-not-installed guideline reads this same value, so the panel and the
 * warning never disagree about the mode.
 */
export function resolveBuildMode(engine: EngineInfo, config: Config): 'docker' | 'local' {
  const defaultMode: 'docker' | 'local' = engine.supports.local ? 'local' : 'docker'
  const requested = typeof config.buildMode === 'string' ? config.buildMode : undefined
  if ((requested === 'docker' || requested === 'local') && engine.supports[requested]) {
    return requested
  }
  return defaultMode
}

/**
 * buildDeps assembles the deps panel read model for one engine and config:
 * the detected hardware (with its package manager), the dep plan the service
 * resolves, the per-dep statuses, the copy/paste install string, and the
 * Play/Run trust gate the stored config carries.
 */
export async function buildDeps(
  localInfer: LocalInferService,
  request?: DepsRequest,
): Promise<DepsModel> {
  const stored = readConfig()
  const engineId = request?.engine ?? stored.engine
  const config = request?.config ?? stored.config
  // ENGINES is a known non-empty constant, so the fallback is always defined.
  const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0]!
  const buildMode = resolveBuildMode(engine, config)
  const hardware = await localInfer.detectHardware()
  const deps = await localInfer.deps(engine.id, buildMode, hardware)
  const checks = await checkDeps(deps, hardware)
  // The chat-template row: when a selected template is an HF repo reference
  // and its file is not in the model directory, the System dependencies box
  // shows the download command (the auto-download's fallback when the CLI is
  // missing or the fetch failed). A present template, a local path, or no
  // template leaves the row off.
  const modelDirectory = localInfer.defaultModelDirectory()
  const rawModelDir = config.modelDirectory
  const modelDir =
    typeof rawModelDir === 'string' && rawModelDir.trim() !== '' ? rawModelDir : modelDirectory
  const chatTemplateValue = typeof config.chatTemplate === 'string' ? config.chatTemplate : ''
  let chatTemplate: ChatTemplateDepModel | undefined
  if (isHfRepoReference(chatTemplateValue) && !existsSync(join(modelDir, CHAT_TEMPLATE_FILE))) {
    chatTemplate = {
      repo: chatTemplateValue,
      present: false,
      hfCli: (await localInfer.hfCliAvailable()) !== null,
      downloadCommand: hfChatTemplateCommand(chatTemplateValue, modelDir),
    }
  }
  // exactOptionalPropertyTypes: the chat-template row only lands while a
  // selected template is missing, so the key is included conditionally.
  const depsInput: Parameters<typeof renderDeps>[0] = {
    engineId: engine.id,
    buildMode,
    packageManager: hardware.packageManager ?? null,
    checks,
    installString: renderInstallString(deps, hardware),
    runAllowed: stored.allowRunDeps,
  }
  if (chatTemplate !== undefined) {
    depsInput.chatTemplate = chatTemplate
  }
  return renderDeps(depsInput)
}
