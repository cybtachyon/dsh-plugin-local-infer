import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * dsh/client.js is a generated artifact (scripts/build-client.mjs bundles
 * packages/client/src into the lazy-CJS carrier). The loader contract and
 * the bootstrap behavior it pins (apply/inject, the locale and slots seams,
 * the route probes, the primitives seed, the slot registrations) live in
 * packages/client/tests/carrier.spec.ts, the carrier behavior suite; the
 * two suites used to mirror each other's full harness.
 *
 * This suite adds the integration-level source pins: it reads strings out
 * of the generated artifact and pins the store-driven contracts the card
 * relies on: the single lifecycle derivation (deriveLifecycleControl), the
 * per-provider launch machine, the draft as the only form-value source, and
 * the performAction server-mutation path. The behavior these pins describe
 * is unit-tested in packages/client/tests/; the pins here are the
 * integration-level contract on the bundled artifact.
 */

// The carrier lives at the repo root, three levels above this test file.
const clientPath = new URL('../../../dsh/client.js', import.meta.url)

describe('dsh/client.js artifact source pins', () => {
  it('pins the route contract the card calls', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    for (const route of [
      '/local-infer/summary',
      '/local-infer/save',
      '/local-infer/deps',
      '/local-infer/install',
      '/local-infer/launch',
      '/local-infer/stop',
      '/local-infer/register',
      '/local-infer/unregister',
      '/local-infer/orchestrator',
      '/local-infer/orchestrator/save',
    ]) {
      expect(source).toContain(route)
    }
  })

  it('pins the help toggle contract the card persists', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The circular "?" button flips the ui.help state and persists the
    // preference through the save route (showHelp in the body), so the
    // descriptions-visible default survives a reload.
    expect(source).toContain('showHelp')
    expect(source).toContain('state.ui.help')
    expect(source).toContain('renderHelpRow')
    expect(source).toContain('HELP_BUTTON_STYLE')
  })

  it('pins the settings-only save the setting toggles send', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The help and allow-run toggles persist the global fields through the
    // save route with settingsOnly set, so the route keeps the provider list
    // intact and a toggle never mints a duplicate entry. The allow-run trust
    // gate persists through performAllowRun; the main Save omits the flag and
    // keeps the upsert contract.
    expect(source).toContain('settingsOnly')
    expect(source).toContain('performAllowRun')
  })

  it('pins the refresh button contract the card re-fetches through', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The circular refresh button sits next to the "?" help button in the card
    // header. It re-fetches the summary and deps from the host, so the card
    // re-prices after the harness pauses and re-activates the plugin's routes.
    // The glyph is a native arrow character (the seed's refresh icon is not
    // required for the mount).
    expect(source).toContain('t.refresh')
    expect(source).toContain('repriceSummary')
  })

  it('pins the provider list contract the card renders', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The card lists the saved providers as collapsed cards, each with a
    // status dot and Edit/Delete controls, and talks to the provider-delete
    // route to remove one. The list is the ProviderList component; the row
    // actions are the editProvider / deleteProvider / cancelProvider drivers.
    expect(source).toContain('/local-infer/provider-delete')
    expect(source).toContain('ProviderList')
    expect(source).toContain('editProvider')
    expect(source).toContain('deleteProvider')
    expect(source).toContain('editingProviderId')
  })

  it('pins the fork repo name the provider title bar renders', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The provider title bar renders the fork's owner/repo (Ninfer/ninfer-all)
    // when an entry names a fork, and falls back to the engine label when no
    // fork is set. The short name is parsed from the fork reference (a
    // protocol URL, an scp-style git@host:owner/repo, or a short form).
    expect(source).toContain('repoShortName')
    expect(source).toContain('repoShortName(provider.platform?.engineFork)')
    expect(source).toContain('titleLabel = forkName !== void 0 ? forkName : engineLabel')
  })

  it('pins the collapsible provider form and the New provider control', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Engine/Model form collapses by default while entries exist, and the
    // "New provider" control sits after the form: a button while a new
    // provider can be started, plain text while in new mode or with no
    // entries. The effective mode is derived (deriveProviderFormMode), and
    // Edit caches the current draft so a later New click restores it.
    expect(source).toContain('NewProviderControl')
    expect(source).toContain('providerFormMode')
    expect(source).toContain('deriveProviderFormMode')
    expect(source).toContain('cachedDraft')
    expect(source).toContain('deriveProviderFormMode(state) !== "new"')
  })

  it('pins the register gate the card enforces while unsaved', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Register button stays disabled while the register cell is pending or
    // the draft is dirty, and the help line explains the gate.
    expect(source).toContain('registerNeedsSave')
    expect(source).toContain('state.dirty && state.ui.help')
    expect(source).toContain('registerCell.status === "pending" || state.dirty')
  })

  it('pins the Logs section and the per-entry Launch control', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The card shows the last run's logs in a fixed-height text area plus a
    // log-location field, and each provider entry carries its own Launch
    // control: a Throbber while launching, Stop when healthy, a red Logs that
    // opens the entry for editing when the launch times out. The lifecycle
    // state lives in the per-provider launch map (state.launch), driven by the
    // performEntryLaunch / performEntryStop drivers. The main Launch is
    // performDraftLaunch, and the Auto Rebuild checkbox (checked by default)
    // rides the launch body: unchecked, the route skips the git sync and
    // launches the checkout as-is.
    expect(source).toContain('lastLogs')
    expect(source).toContain('logPath')
    expect(source).toContain('EntryLaunchButton')
    expect(source).toContain('renderThrobber')
    expect(source).toContain('performEntryLaunch')
    expect(source).toContain('performEntryStop')
    expect(source).toContain('state.launch')
    expect(source).toContain('performDraftLaunch')
    expect(source).toContain('autoRebuild')
    expect(source).toContain('autoRebuild: state.ui.autoRebuild')
  })

  it('pins the Logs auto-scroll and the vertical resize handle', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Logs text area auto-scrolls to the bottom while the scroll mode is
    // 'fresh' (the pane just opened) or 'scrolling'; a manual scroll up parks
    // the mode at 'manual' so content updates stop moving the view, and a
    // scroll back to the bottom re-arms 'scrolling'. The mode and the shared
    // displayed value live in the store's ui.logs, and drive the effect and
    // the textarea.
    expect(source).toContain('ui.logs.scrollMode')
    expect(source).toContain('scrollMode: "fresh"')
    expect(source).toContain('atBottom ? "scrolling" : "manual"')
    expect(source).toContain('onLogsScroll')
    expect(source).toContain('displayedLogs')
    // The diagonal chevron in the section's bottom-right corner drags the
    // height vertically only, through a pointer drag that clamps the height.
    // The glyph is the primitives seed's chevron; a host without the seed
    // keeps the native corner glyph.
    expect(source).toContain('logs.height')
    expect(source).toContain('onLogsResizeStart')
    expect(source).toContain('IconChevronDownOutlineRegular')
    expect(source).toContain('ns-resize')
  })

  it('pins the title-bar Launch control mirroring the edited provider entry state', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // While a provider is being edited, the title-bar Launch/Stop control
    // renders from the single lifecycle derivation (deriveLifecycleControl),
    // which reads that entry's per-provider launch machine, so clicking the
    // entry's Launch button drives both controls through the same lifecycle.
    expect(source).toContain('deriveLifecycleControl')
    expect(source).toContain('editedProvider')
    expect(source).toContain('performEntryStop')
  })

  it('pins the reusable process button and the Logs process separator', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // Every stateful process control (Get, Launch, Stop, Run, Download) shares
    // the Disable/Throbber/Reset lifecycle through renderProcessButton: a
    // disabled control with the spinner and the in-progress label while the
    // process is in flight, the idle action button when it settles.
    expect(source).toContain('renderProcessButton')
    // The provider process buttons write a "--- {{label}}" separator to the
    // Logs buffer when clicked (appendProcessLog), so a new process reads as a
    // fresh section that appends its commands and output to the buffer and the
    // log file. The separator is built by separatorLine from the "--- "
    // prefix constant. The Get button reads the "Getting engine and model..."
    // in-progress label.
    expect(source).toContain('appendProcessLog')
    expect(source).toContain('separatorLine')
    expect(source).toContain('"--- "')
    expect(source).toContain('"Getting engine and model..."')
  })

  it('pins the per-entry launch state machine and its phase labels', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The per-entry Launch control is a hardened state machine: a step event
    // from the live run stream sets the reported phase directly (the server
    // stream is authoritative; the phases are prereqs, download, build,
    // launch), a healthy result settles to running, a failed result settles
    // to failed, and a stop or a break resets to idle.
    expect(source).toContain('launchNextState')
    expect(source).toContain('LAUNCH_PHASE_STATES')
    // The button reads the phase that is running, not a single "Launching...".
    expect(source).toContain('entryPrereqs')
    expect(source).toContain('entryDownloading')
    expect(source).toContain('entryBuilding')
    expect(source).toContain('entryLaunching')
    // The launch stream is NDJSON: a step event as each phase begins, then a
    // final result event the card reads through the response body stream.
    expect(source).toContain('response.body.getReader')
    expect(source).toContain('event.step')
    expect(source).toContain('event.result')
    // The health-poll deadline arms only for the launch (health-poll) step; the
    // rebuild steps (prereqs, download, build) run without a timeout.
    expect(source).toContain('LAUNCH_HEALTH_DEADLINE_MS')
    expect(source).toContain('step === "launch"')
  })

  it('pins the downloading state the engine model fetch reports', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A launch that is still fetching its model files (the Strata download)
    // reads as a downloading throbber, not a failure: the result event's
    // downloading state drives the machine to the downloading state, and the
    // button renders a busy throbber the card re-polls. The label key comes
    // from the machine's LAUNCH_STATE_DISPLAY mapping (shared with the
    // download phase), resolved through phaseLabelFor, so the title bar and
    // the entry control read the same downloading label.
    expect(source).toContain('type: "downloading"')
    expect(source).toContain('case "downloading"')
    expect(source).toContain('result.state === "downloading"')
    expect(source).toContain('phaseLabelFor')
    expect(source).toContain('launchDisplayKeyFor')
    expect(source).toContain('downloading: "entryDownloading"')
  })

  it('pins the provider stop lifecycle the state machine drives', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A Stop click moves the entry to the stopping state (a disabled throbber,
    // the same display the launch phases show), then re-fetches the summary on
    // a fast cadence so the provider's status dot repaints the moment the
    // engine is down, instead of waiting out the host's 5-second cycle. The
    // stopping label key comes from the machine's LAUNCH_STATE_DISPLAY
    // mapping, resolved through phaseLabelFor, so the entry control and the
    // title bar read the same label.
    expect(source).toContain('STOP_POLL_MS')
    expect(source).toContain('stopping: "stopping"')
    expect(source).toContain('type: "stopped"')
    expect(source).toContain('stopping: "stopping..."')
    // A provider still running at the 10-second deadline settles to the red
    // Logs state (the same path a failed launch takes), marked with the cause
    // 'stop' so the Logs control's reset reads as Stop, not Launch.
    expect(source).toContain('STOP_HEALTH_DEADLINE_MS')
    expect(source).toContain('type: "stopFailed"')
    expect(source).toContain('cause === "stop" ? "running" : "idle"')
  })

  it('pins the launch record contract the restart re-link prices', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The card's launch and stop bodies carry the provider entry's id, so the
    // route persists (or clears) the launch record on that entry and a DSH
    // restart re-links a surviving engine to its config. The draft's launch
    // hands the editing provider id from the store's ui state.
    expect(source).toContain('providerId: provider.id')
    expect(source).toContain('body.providerId = state.ui.editingProviderId')
  })

  it('pins the provider Edit to Cancel swap while a provider is being edited', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The provider the editing form is open for shows a Cancel button (which
    // collapses the form back to Edit and discards its changes, the
    // cancelProvider driver); every other provider shows the Edit button that
    // opens it.
    expect(source).toContain('cancelProvider')
    expect(source).toContain('cancel: "Cancel"')
    expect(source).toContain('editingId === provider.id')
  })

  it('pins the port number entry without a range strip and the hardware-priced slider cap', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A slider control with slider:false (the port field) renders the number
    // entry alone; the range strip's cap is the hardware-priced sliderMax when
    // the form declares one (the host-KV pool caps at half the host RAM), else
    // the static max.
    expect(source).toContain('control.slider === false')
    expect(source).toContain('control.sliderMax')
  })

  it('pins the chat template preset plus custom split and the auto-download', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The chat template is split into a preset dropdown (shipped presets plus a
    // Custom entry) and a "Custom Chat template" text field that shows while the
    // preset is Custom. The auto-download pulls an absent template through the
    // /local-infer/chat-template route (downloadTemplate), and the System
    // dependencies box carries the download command when the CLI is
    // unavailable.
    expect(source).toContain('ChatTemplateField')
    expect(source).toContain('chatTemplatePreset')
    expect(source).toContain('customChatTemplate')
    expect(source).toContain('downloadTemplate')
    expect(source).toContain('chatTemplateStatus')
    expect(source).toContain('templateAbsent')
    expect(source).toContain('templateInstructions')
  })

  it('pins the Save handler clearing the editing provider so the button reverts to Edit', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A successful Save collapses the form and clears the editing provider id,
    // so the provider entry's button reverts from Cancel back to Edit, the
    // same rule the Discard handler applies.
    expect(source).toContain('editingProviderId: null')
  })

  it('pins the Remove handler keying off the same config as Register', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The unregister request carries draft.config, the same config the
    // register step sent, so the provider and model ids the removal derives
    // are identical to the ones the registration published, and the DSH
    // settings row is actually removed.
    expect(source).toContain('engine: draft.engine, config: draft.config')
  })

  it('pins the Discard handler collapsing the form back to the entry list', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A "New provider" then "Discard" sequence must not leave the form open in
    // 'new' mode. The Discard handler collapses the form back to the provider
    // entry list, the same rule the Save handler applies.
    expect(source).toContain('providerFormMode: "collapsed"')
  })

  it('pins the unsure banner with kill commands at the top of the card', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The "unsure" banner renders at the top of the card (before the section
    // title) when the summary's unsureBanner is present: the message and a
    // read-only text area with the bash kill commands for the engine processes
    // the detector saw holding VRAM.
    expect(source).toContain('summary.unsureBanner')
    expect(source).toContain('unsureBanner')
    expect(source).toContain('killCommands')
  })

  it('pins the Custom Arguments table the card renders before System dependencies', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The section is a key/value table (parameter, value, the + / - controls)
    // the user fills with extra launch flags. The rows live in the draft
    // config's customArgs field, so a Save persists them and the next engine
    // launch appends them to the command line. The row logic is the pure
    // nextCustomArgs function.
    expect(source).toContain('CustomArgsPanel')
    expect(source).toContain('nextCustomArgs')
    expect(source).toContain('customArgs')
    expect(source).toContain('customArgsTitle')
    expect(source).toContain('customArgKeyHeader')
    expect(source).toContain('customArgValueHeader')
    // The first row is cleared, not removed; a lower row is removed; + adds a
    // row. The action verbs pin that behavior.
    expect(source).toContain('"clear"')
    expect(source).toContain('"remove"')
    expect(source).toContain('"add"')
  })

  it('pins the build-method-dependent platform fields in the Engine platform section', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The Engine platform section shows the Build commands override in local
    // build mode and the Docker tag override in docker build mode, one at a
    // time, each seeded with the engine's own default as the placeholder. The
    // values ride the platform map, not the config.
    expect(source).toContain('t.buildCommands')
    expect(source).toContain('t.dockerTag')
    expect(source).toContain('buildMode === "local"')
    expect(source).toContain('buildMode === "docker"')
    expect(source).toContain('"buildCommands"')
    expect(source).toContain('"dockerTag"')
    expect(source).toContain('engineEntry.defaultBuildCommand')
    expect(source).toContain('engineEntry.defaultDockerTag')
  })

  it('pins the debounced re-price the field edits schedule', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // A field edit updates the draft config and schedules a debounced re-price
    // of the VRAM Est. meter and the deps panel. The draft update is pure; the
    // re-price runs only after typing pauses (the 300ms timeout), so a fast
    // keystroke stream is one round trip, not one per letter. The timeout is
    // reset on every field change (repriceTimerRef), and the fetch reads the
    // latest committed draft from a ref, not a stale closure.
    expect(source).toContain('scheduleReprice')
    expect(source).toContain('draftRef')
    expect(source).toContain('repriceTimerRef')
    // The field edit and the engine switch both schedule the debounced
    // re-price, and the draft update stays pure (no timer side effect inside
    // the state updater).
    expect(source).toContain('scheduleReprice()')
  })

  it('pins the draft-bound field value the free-text inputs read', () => {
    const source = readFileSync(fileURLToPath(clientPath), 'utf8')
    // The form field value binds to the local draft, not the server render
    // model, so a typed keystroke shows in the input immediately. The server
    // model (field.value) resolves the spec default and only surfaces after
    // the debounced re-price settles. A key the user has not edited is absent
    // from the draft, so it falls back to the model. This is what keeps the
    // free-text fields (the API key, the chat template, the path pickers)
    // from lagging a keystroke behind the server round trip.
    expect(source).toContain('effectiveField')
    expect(source).toContain('currentDraft.config[field.key]')
    expect(source).toContain('{ ...field, value: draftValue }')
  })
})
