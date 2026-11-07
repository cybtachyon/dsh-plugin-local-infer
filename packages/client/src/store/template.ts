/**
 * The chat-template download driver: downloadTemplate pulls the selected
 * template (the summary's chatTemplateStatus repo) into the model directory
 * through the /local-infer/chat-template route, running the round trip as a
 * pending -> ack | timeout transition over the store's template cell.
 *
 * The driver reads the draft for the engine and the model directory, and
 * guards the round trip: no draft, an empty repo, and a download already in
 * flight all read as no-ops. The cell's pending guard is the double-fire
 * protection the hand-written card kept in a requested-repos ref, and a
 * failed download settles the cell to error, so a later retry (the
 * button, or a re-select) can start again.
 * @module dsh-plugin-local-infer/client/store/template
 */

import { postChatTemplate } from '../api/routes.ts'
import { beginRun, clientRunLogKey, endRun } from './logs-stream.ts'
import { performTemplateAction, TEMPLATE_DOWNLOAD_TIMEOUT, type CardStore } from './sync.ts'

/**
 * downloadTemplate pulls the named template repo into the model directory.
 * It no-ops while the draft is absent, the repo is empty, or a download is
 * already in flight. The ack detail stays neutral ('ok'): the component
 * maps the cell to the localized note, the way the action cells map
 * ACTION_TIMEOUT_DETAIL. The pull brackets one run-log stream: the host keys
 * it on the request's engine and the STORED config's model (the route reads
 * the stored pair, not the draft's), per the mirrored runLogKey rule, and
 * the stream detaches when the round trip settles.
 */
export function downloadTemplate(store: CardStore, repo: string): Promise<void> {
  const state = store.getSnapshot()
  if (state.draft === null || repo === '') {
    return Promise.resolve()
  }
  if (state.templateActions.download.status === 'pending') {
    return Promise.resolve()
  }
  const draft = state.draft
  const runKey = clientRunLogKey(
    state.summary?.providers ?? [],
    draft.engine,
    state.summary?.config ?? {},
  )
  beginRun(store, runKey)
  // The directory key is omitted, not undefined: the route reads an absent
  // key as "the host's model directory".
  const directory =
    typeof draft.config.modelDirectory === 'string' ? draft.config.modelDirectory : undefined
  return performTemplateAction(
    store,
    () =>
      postChatTemplate({
        engine: draft.engine,
        template: repo,
        ...(directory !== undefined ? { directory } : {}),
      }).then(
        () => 'ok',
        (error: unknown) => {
          throw new Error(error instanceof Error ? error.message : String(error))
        },
      ),
    TEMPLATE_DOWNLOAD_TIMEOUT,
  ).then(() => {
    endRun(store, runKey)
  })
}
