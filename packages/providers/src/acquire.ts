/**
 * The per-engine acquisition data and the Get step. Each engine declares its
 * git source (the upstream repo, the branch the rebase targets, and the build
 * steps the checkout runs) as data here; the adapters' deploy steps and the
 * /local-infer/get route both consume the same constants, so a build command
 * has one home. The sync step clones a missing checkout, and a clean existing
 * checkout is fetched and rebased onto the upstream branch; a checkout with
 * local changes aborts, because a rebase would eat the user's work.
 * @module dsh-plugin-local-infer/providers/acquire
 */

import type { CommandOutcome, LifecycleHost } from '../../core/lib/index.js'

/**
 * EngineSource is the per-engine acquisition data: the upstream git repo the
 * clone step uses when no fork is provided, the branch the fetch/rebase step
 * rebases onto, and the build steps run in the checkout after a clone or a
 * rebase. A build step is a shell command line; the `{dir}` placeholder is
 * replaced with the checkout directory before the step runs.
 */
export interface EngineSource {
  repo: string
  branch: string
  buildSteps: readonly string[]
}

/**
 * The remote name a user-provided fork is added under, so the checkout's own
 * origin (the upstream it was cloned from) survives the fork override.
 */
export const FORK_REMOTE = 'dsh-fork'

/**
 * The per-engine git sources, keyed by engine id. NInfer and Infernix build
 * through cmake (Infernix through its own preset); llama.cpp builds through
 * the same cmake shape as NInfer; Hyper-Qwen is the compose-driven vLLM
 * engine, so it carries no local build steps (the compose up pulls the
 * image); Strata is the placeholder engine, and its repo and pull step land
 * with the engine, the same way its docker image constant did.
 */
export const ENGINE_SOURCES: Record<string, EngineSource> = {
  ninfer: {
    repo: 'https://github.com/Neroued/ninfer',
    branch: 'master',
    buildSteps: [
      'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
    ],
  },
  hyperqwen: {
    repo: 'https://github.com/vllm-project/vllm',
    branch: 'main',
    buildSteps: [],
  },
  llamacpp: {
    repo: 'https://github.com/ggml-org/llama.cpp',
    branch: 'master',
    buildSteps: [
      'cmake -S {dir} -B {dir}/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build {dir}/build -j',
    ],
  },
  infernix: {
    repo: 'https://github.com/Wallawalla47/Infernix',
    branch: 'main',
    buildSteps: ['cd {dir} && cmake --preset release && cmake --build build -j'],
  },
  strata: {
    repo: 'https://github.com/strata/strata',
    branch: 'main',
    buildSteps: ['docker pull ghcr.io/strata/strata'],
  },
}

/**
 * AcquireLog receives one line (or chunk) of Get output as it lands, so the
 * route can stream it to the card's Logs section.
 */
export type AcquireLog = (chunk: string) => void

/**
 * EngineStepResult reports one Get step (sync or build): whether it passed,
 * whether it aborted on a rule (a dirty checkout), and a detail the Logs
 * section shows when it did not pass.
 */
export interface EngineStepResult {
  ok: boolean
  aborted?: boolean
  detail?: string
}

/**
 * engineSource reads the registered acquisition data for an engine id, or
 * undefined when none is registered.
 */
export function engineSource(engineId: string): EngineSource | undefined {
  return ENGINE_SOURCES[engineId]
}

/**
 * engineBuildSteps reads the build steps an engine runs in its checkout, so
 * the adapter's deploy step and the Get build step share one list.
 */
export function engineBuildSteps(engineId: string): readonly string[] {
  return ENGINE_SOURCES[engineId]?.buildSteps ?? []
}

/**
 * runLogged runs one shell command through the host's streaming surface when
 * it has one (echoing the command and streaming its output through log), and
 * through plain run otherwise. The streamed copy is also collected, so a
 * caller can price the command's stdout (the dirty-check, for one).
 */
async function runLogged(
  host: LifecycleHost,
  command: string,
  log: AcquireLog,
  options?: { echo?: boolean },
): Promise<CommandOutcome & { output: string }> {
  let output = ''
  const collect = (chunk: string): void => {
    output += chunk
    log(chunk)
  }
  if (options?.echo !== false) {
    log(`$ ${command}\n`)
  }
  if (host.runStream !== undefined) {
    const outcome = await host.runStream(command, collect)
    return { ...outcome, output }
  }
  const outcome = await host.run(command)
  return { ...outcome, output }
}

/**
 * syncEngineRepo brings the engine checkout to the listed source. A missing
 * checkout is a fresh clone of the fork (or the engine's upstream repo when
 * no fork is provided). An existing checkout with local changes aborts, so
 * the user's work is never rebased away; a clean checkout fetches the listed
 * fork (added as the named fork remote when provided, origin when not) and
 * rebases onto its branch. Every command echoes into log as it runs.
 */
export async function syncEngineRepo(
  host: LifecycleHost,
  request: { engineId: string; directory: string; fork?: string },
  log: AcquireLog,
): Promise<EngineStepResult> {
  const source = engineSource(request.engineId)
  if (source === undefined) {
    return {
      ok: false,
      detail: `no engine source is registered for "${request.engineId}"`,
    }
  }
  const directory = request.directory
  const fork = request.fork !== undefined && request.fork.trim() !== '' ? request.fork : undefined
  const present = await host.run(`[ -d ${directory}/.git ]`)
  if (present.ok) {
    const status = await runLogged(host, `git -C ${directory} status --short`, log)
    if (!status.ok) {
      return { ok: false, detail: `git status failed: ${status.detail ?? 'unknown'}` }
    }
    if (status.output.trim() !== '') {
      log(`!! ${directory} has local changes. Get aborted; commit or revert them first.\n`)
      return {
        ok: false,
        aborted: true,
        detail: 'the engine repository has local changes',
      }
    }
    if (fork !== undefined) {
      // Add the fork under its own remote name; re-Get updates the URL in
      // place so an edited Engine Fork field takes effect on the next run.
      const add = await runLogged(host, `git -C ${directory} remote add ${FORK_REMOTE} ${fork}`, log)
      if (!add.ok) {
        await runLogged(host, `git -C ${directory} remote set-url ${FORK_REMOTE} ${fork}`, log)
      }
    }
    const remote = fork !== undefined ? FORK_REMOTE : 'origin'
    const fetch = await runLogged(host, `git -C ${directory} fetch ${remote}`, log)
    if (!fetch.ok) {
      return { ok: false, detail: `git fetch ${remote} failed: ${fetch.detail ?? 'unknown'}` }
    }
    const rebase = await runLogged(
      host,
      `git -C ${directory} rebase ${remote}/${source.branch} || ` +
        `{ git -C ${directory} rebase --abort; exit 1; }`,
      log,
    )
    if (!rebase.ok) {
      return {
        ok: false,
        detail: `git rebase ${remote}/${source.branch} failed: ${rebase.detail ?? 'unknown'}`,
      }
    }
    return { ok: true }
  }
  const clone = await runLogged(host, `git clone ${fork ?? source.repo} ${directory}`, log)
  if (!clone.ok) {
    return { ok: false, detail: `git clone failed: ${clone.detail ?? 'unknown'}` }
  }
  return { ok: true }
}

/**
 * buildEngineRepo runs the engine's build steps in the checkout, streaming
 * each step's output through log. An engine with no build steps (the compose
 * engines) passes through with a note; a failing step stops the build with
 * the step's detail.
 */
export async function buildEngineRepo(
  host: LifecycleHost,
  engineId: string,
  directory: string,
  log: AcquireLog,
): Promise<EngineStepResult> {
  const source = engineSource(engineId)
  if (source === undefined) {
    return { ok: false, detail: `no engine source is registered for "${engineId}"` }
  }
  if (source.buildSteps.length === 0) {
    log(`no local build steps for ${engineId}\n`)
    return { ok: true }
  }
  for (const step of source.buildSteps) {
    const command = step.replaceAll('{dir}', directory)
    const outcome = await runLogged(host, command, log)
    if (!outcome.ok) {
      return { ok: false, detail: `build failed: ${outcome.detail ?? 'unknown'}` }
    }
  }
  return { ok: true }
}
