/**
 * The shared Get-steps routine both getEngine and launchEngine route through:
 * it runs, in order, (1) the engine's system-dependency install for the host
 * OS (gated by the Play/Run trust gate), (2) the git clone of the engine repo
 * (or the fork) plus the fetch/rebase of a clean checkout, (3) the source
 * build step (the compose engines carry no local build steps), (4) the hf
 * download of the selected model when it is not already present, and (5) the
 * hf download of any selected chat template when it is not already present.
 * Every step streams through the log sink as it lands, and an already-
 * satisfied step is skipped and logged as such, so a Launch that runs the
 * routine before the deploy is idempotent.
 * @module dsh-plugin-local-infer/ui/ops/get-steps
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config, LifecycleHost } from 'dsh-plugin-local-infer/core'
import {
  CHAT_TEMPLATE_FILE,
  checkDeps,
  hfChatTemplateCommand,
  hfDownloadCommand,
  modelArtifactPath,
} from '../../../core/lib/index.js'
import type { LocalInferService } from 'dsh-plugin-local-infer/service'
import {
  buildEngineRepo,
  defaultModelFor,
  ENGINES,
  infernixGetDownloads,
  syncEngineRepo,
} from '../../../providers/lib/index.js'
import type { StoredPlatformConfig } from '../config.ts'
import { isHfRepoReference } from '../viewmodels/summaryHelpers.ts'
import { resolveBuildMode } from '../viewmodels/deps.ts'
import { resolveModelDirectory } from './model.ts'

/**
 * GetStepsRequest names the run: the engine, the config the dep plan, build
 * mode, model, and chat template read from, the platform entry the checkout
 * directory and fork resolve against, the Play/Run trust gate that decides
 * whether the dependency install runs, and the lifecycle host the git and
 * build steps run through. `autoRebuild` false (the card's Auto Rebuild
 * checkbox off) skips the sync and build steps, so a launch reads the
 * checkout as-is, the same rule the adapter's deploy step applies.
 */
export interface GetStepsRequest {
  engineId: string
  config: Config
  platform?: StoredPlatformConfig
  allowRunDeps: boolean
  autoRebuild?: boolean
  host: LifecycleHost
}

/**
 * GetStepsResult reports the run: whether every step passed, a detail the
 * Logs section shows when one did not, and the captured log text (every step
 * line, in order) the caller persists or streams to the card.
 */
export interface GetStepsResult {
  ok: boolean
  logs: string
  detail?: string
}

/**
 * resolveEngineDirectory picks the checkout the Get step syncs: the Engine
 * Directory override when it names a path, else a per-engine folder inside
 * the model directory (the default model directory, or the config's
 * override), so a Get with no override still has a real place to live.
 */
export function resolveEngineDirectory(
  localInfer: LocalInferService,
  config: Config,
  engineId: string,
  platform: StoredPlatformConfig | undefined,
): string {
  const override = platform?.engineDirectory
  if (override !== undefined && override.trim() !== '') {
    return override
  }
  const rawModelDir = config.modelDirectory
  const modelDir =
    typeof rawModelDir === 'string' && rawModelDir.trim() !== ''
      ? rawModelDir
      : localInfer.defaultModelDirectory()
  return join(modelDir, engineId)
}

/**
 * runGetSteps is the shared Get-steps routine. It runs the five steps in
 * order, streaming each through log and collecting the same text as the
 * result's logs, so a caller can persist the run (a Get) or thread it into
 * the launch's persisted logs (a Launch) without re-running the steps. A
 * step that is already satisfied is skipped and logged as such; a failing
 * step stops the run and names the broken step in the detail.
 */
export async function runGetSteps(
  localInfer: LocalInferService,
  request: GetStepsRequest,
  log: (chunk: string) => void,
): Promise<GetStepsResult> {
  const { engineId, config, platform, allowRunDeps, host } = request
  const chunks: string[] = []
  const emit = (chunk: string): void => {
    chunks.push(chunk)
    log(chunk)
  }
  // ENGINES is a known non-empty constant, so the fallback is always defined.
  const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0]!
  const directory = resolveEngineDirectory(localInfer, config, engineId, platform)
  const fork = platform?.engineFork
  const modelDir = resolveModelDirectory(localInfer, config)
  const hardware = await localInfer.detectHardware()
  emit(`get ${engineId} in ${directory}\n`)

  // Step 1: the system dependencies the local build needs. The install only
  // runs while the Play/Run trust gate is on; with the gate off the deps are
  // re-checked and a missing one aborts the run with the copy/paste note.
  const buildMode = resolveBuildMode(engine, config)
  emit(`system dependencies (${buildMode})\n`)
  if (allowRunDeps === true) {
    const install = await localInfer.runInstall(engineId, buildMode, hardware)
    for (const entry of install.results) {
      emit(
        `  ${entry.id}: ${entry.status}${entry.detail !== undefined ? ` (${entry.detail})` : ''}\n`,
      )
    }
    if (!install.ok) {
      emit('!! a system dependency install failed; copy the install string from the panel\n')
      return { ok: false, logs: chunks.join(''), detail: 'a system dependency install failed' }
    }
  } else {
    const deps = await localInfer.deps(engineId, buildMode, hardware)
    const checks = await checkDeps(deps, hardware)
    let missing = false
    for (const check of checks) {
      emit(`  ${check.dep.id}: ${check.status}\n`)
      if (check.status !== 'satisfied') missing = true
    }
    if (missing) {
      emit(
        '!! a system dependency is missing and one-click install is off; copy the install string from the panel\n',
      )
      return { ok: false, logs: chunks.join(''), detail: 'a system dependency is missing' }
    }
  }

  // Step 2: the git clone (or the fork) of the engine repo, and the fetch and
  // rebase of a clean checkout. A checkout with local changes aborts, so the
  // user's work is never rebased away. Step 3: the source build step (the
  // compose engines carry no local build steps and pass through). The Auto
  // Rebuild checkbox off skips both, so a launch reads the checkout as-is.
  if (request.autoRebuild === false) {
    emit('engine sync and build: auto rebuild off, skipped\n')
  } else {
    const sync = await syncEngineRepo(
      host,
      { engineId, directory, ...(fork !== undefined && fork.trim() !== '' ? { fork } : {}) },
      emit,
    )
    if (!sync.ok) {
      // A dirty checkout already alerted in the sync step; any other failure
      // names its step here.
      if (sync.aborted !== true && sync.detail !== undefined) {
        emit(`!! ${sync.detail}\n`)
      }
      return {
        ok: false,
        logs: chunks.join(''),
        ...(sync.detail !== undefined ? { detail: sync.detail } : {}),
      }
    }
    // The user's local build command (the card's Build commands field)
    // overrides the engine's default build steps; absent runs the engine's
    // acquisition steps. The host OS picks the engine's OS profile (the
    // Windows vcpkg route and its pwsh.exe shell on a Windows host, the
    // cmake route elsewhere).
    const build = await buildEngineRepo(
      host,
      engineId,
      directory,
      emit,
      platform?.buildCommands,
      hardware.os,
    )
    if (!build.ok) {
      if (build.detail !== undefined) {
        emit(`!! ${build.detail}\n`)
      }
      return {
        ok: false,
        logs: chunks.join(''),
        ...(build.detail !== undefined ? { detail: build.detail } : {}),
      }
    }
  }

  // Step 4: the hf download of the selected model, skipped when the artifact
  // is already present in the model directory (the single presence check the
  // card's Model dropdown and the download route share). A download failure
  // aborts the run, so a launch never reads a missing model.
  const modelId = typeof config.model === 'string' ? config.model : undefined
  if (modelId !== undefined) {
    const entry = defaultModelFor(engineId, modelId)
    if (entry === undefined) {
      emit(`model download: ${modelId} has no registered default, skipped\n`)
    } else {
      const artifact = modelArtifactPath(entry, modelDir)
      if (existsSync(artifact)) {
        emit(`model download: ${modelId} is already present, skipped\n`)
      } else {
        emit(`$ ${hfDownloadCommand(entry, modelDir)}\n`)
        const download = await localInfer.downloadModel(entry, modelDir)
        if (!download.ok) {
          emit(`!! ${download.detail ?? 'model download failed'}\n`)
          return {
            ok: false,
            logs: chunks.join(''),
            detail: download.detail ?? 'a model download failed',
          }
        }
      }
    }
  } else {
    emit('model download: no model selected, skipped\n')
  }
  // The Infernix extras a Get leaves ready to launch: the selected DFlash2
  // drafter (when a preset is selected) and the PLE n-gram volume (when the
  // model key names one), pulled through the hf CLI into the model directory.
  if (engineId === 'infernix') {
    for (const command of infernixGetDownloads(config, modelDir)) {
      emit(`$ ${command}\n`)
      const outcome =
        host.runStream !== undefined
          ? await host.runStream(command, (chunk) => emit(chunk))
          : await host.run(command)
      if (!outcome.ok) {
        emit(`!! ${command} failed: ${outcome.detail ?? 'unknown'}\n`)
        return { ok: false, logs: chunks.join(''), detail: 'a model artifact download failed' }
      }
    }
  }

  // Step 5: the hf download of the selected chat template (an HF repo
  // reference the form's combo control offers), skipped when the template
  // file is already present in the model directory.
  const template = typeof config.chatTemplate === 'string' ? config.chatTemplate : ''
  if (template !== '' && isHfRepoReference(template)) {
    const localPath = join(modelDir, CHAT_TEMPLATE_FILE)
    if (existsSync(localPath)) {
      emit(`chat template: ${template} is already present, skipped\n`)
    } else {
      emit(`$ ${hfChatTemplateCommand(template, modelDir)}\n`)
      const download = await localInfer.downloadChatTemplate(template, modelDir)
      if (!download.ok) {
        emit(`!! ${download.detail ?? 'chat template download failed'}\n`)
        return {
          ok: false,
          logs: chunks.join(''),
          detail: download.detail ?? 'a chat template download failed',
        }
      }
    }
  }

  emit('get complete\n')
  return { ok: true, logs: chunks.join('') }
}
