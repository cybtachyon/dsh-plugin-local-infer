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

import type { ReactNode } from 'react'
import { DEPS_ROW_STYLE, INSTALL_BLOCK_STYLE, SECTION_STYLE } from '../styles.ts'
import type { TextTable } from '../text.ts'
import {
  copyInstallString,
  performAllowRun,
  performGet,
  performInstall,
} from '../store/deps.ts'
import type { CardStore } from '../store/sync.ts'
import {
  renderButton,
  renderCheckbox,
  renderProcessButton,
  renderStateDot,
  type StateDotState,
} from './primitives.tsx'
import { react } from './react.ts'

// stateForStatus maps a dep's status onto the DSH state-dot semantics the
// inventory cards use: a satisfied dep is done, a missing one asks
// attention, a failed one is an error, and an install in flight is the
// ongoing spinner.
const STATE_FOR_STATUS: Record<string, StateDotState> = {
  satisfied: 'done',
  missing: 'warning',
  failed: 'error',
  installing: 'ongoing',
}

export interface DepsPanelProps {
  store: CardStore
  t: TextTable
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
export function DepsPanel(props: DepsPanelProps): ReactNode {
  const { store, t } = props
  const state = store.getSnapshot()
  const deps = state.deps
  if (deps === null) {
    return null
  }
  const installCell = state.actions.install
  const getCell = state.actions.get
  // The deps note line: a failed install cell reads as the route's own
  // message (or the timeout marker), the way the hand-written card's
  // catch path overwrote the note; else the install ack's result note (the
  // satisfied line, or the unsatisfied dep list).
  const note = installCell.status === 'error' ? installCell.detail : state.notes.deps
  const rows = deps.deps.map((dep) => (
    <div key={dep.id} style={DEPS_ROW_STYLE}>
      {renderStateDot(STATE_FOR_STATUS[dep.status] ?? 'idle')}
      <span style={{ fontWeight: 600 }}>{dep.id}</span>
      <span
        style={{
          color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
        }}
      >
        // The sudo hint is a Linux/macOS concept; a winget (Windows) host
        // installs without elevation, so the hint is suppressed there.
        {dep.purpose + (dep.requiresSudo && deps.packageManager !== 'winget' ? ' (sudo)' : '')}
      </span>
    </div>
  ))
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={SECTION_STYLE}>{t.depsTitle}</div>
        {deps.packageManager === null ? (
          <span
            style={{
              fontSize: 11,
              color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
            }}
          >
            {t.pmUnknown}
          </span>
        ) : null}
      </div>
      {deps.deps.length > 0 ? (
        <div>{rows}</div>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{t.depsNone}</div>
      )}
      {deps.installString !== '' ? (
        <div>
          <pre style={INSTALL_BLOCK_STYLE}>{deps.installString}</pre>
          {renderButton(
            'ghost',
            {
              onClick: () => copyInstallString(store, t),
            },
            state.notes.copy !== '' ? state.notes.copy : t.copy,
          )}
        </div>
      ) : null}
      {deps.chatTemplate !== undefined ? (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
            }}
          >
            {t.templateAbsent}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{t.templateInstructions}</div>
          <pre style={INSTALL_BLOCK_STYLE}>{deps.chatTemplate.downloadCommand}</pre>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {renderCheckbox({
          checked: deps.runAllowed === true,
          onChange: (checked) => {
            void performAllowRun(store, checked)
          },
          label: t.allowRun,
        })}
        {deps.runAllowed && !deps.allSatisfied
          ? renderProcessButton({
              busy: installCell.status === 'pending',
              label: '▶ ' + t.run,
              busyLabel: t.running,
              variant: 'ghost',
              onClick: () => {
                void performInstall(store, t)
              },
            })
          : null}
        {renderProcessButton({
          busy: getCell.status === 'pending',
          label: t.get,
          busyLabel: t.getting,
          variant: 'primary',
          onClick: () => {
            void performGet(store, t)
          },
          disabled: !deps.allSatisfied,
        })}
      </div>
      {note !== '' ? (
        <div
          style={{
            fontSize: 12,
            marginTop: 4,
            color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}
