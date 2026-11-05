import { describe, expect, it } from 'vitest'
import {
  BANNER_STYLE,
  BUTTON_BASE,
  GHOST_BUTTON,
  HELP_BUTTON_STYLE,
  INLINE_WARNING_STYLE,
  PRIMARY_BUTTON,
  SEGMENT_COLORS,
  SUDO_STATE_LABEL_COLOR,
  WARNING_BANNER_STYLE,
  clampPercent,
} from '../src/styles.ts'

describe('client styles (styles.ts)', () => {
  it('pins the meter segment palette', () => {
    expect(SEGMENT_COLORS).toEqual({
      weights: '#4f8ff7',
      kv: '#34c38f',
      overhead: '#14b8a6',
      workspace: '#b07ff7',
      free: '#d9d9d9',
      reserve: '#1c1c1c',
    })
  })

  it('paints the verdict banner red only for an over budget', () => {
    const over = BANNER_STYLE('over')
    expect(over.background).toBe('var(--dsw-alias-fill-error, rgba(255,59,48,0.12))')
    expect(over.color).toBe('var(--dsw-alias-label-error, #ff3b30)')
    for (const status of ['fits', 'tight', 'not-measured']) {
      const style = BANNER_STYLE(status)
      expect(style.background).toBe('var(--dsw-alias-fill-warning, rgba(255,159,10,0.12))')
      expect(style.color).toBe('var(--dsw-alias-label-warning, #ff9f0a)')
    }
  })

  it('paints the warning banner per tone', () => {
    expect(WARNING_BANNER_STYLE('red').background).toBe(
      'var(--dsw-alias-fill-error, rgba(255,59,48,0.12))',
    )
    expect(WARNING_BANNER_STYLE('amber').background).toBe(
      'var(--dsw-alias-fill-warning, rgba(255,159,10,0.12))',
    )
    const neutral = WARNING_BANNER_STYLE('neutral')
    expect(neutral.background).toBe('var(--dsw-alias-fill-quaternary, rgba(128,128,128,0.08))')
    expect(neutral.color).toBe('inherit')
  })

  it('paints the inline warning per tone', () => {
    expect(INLINE_WARNING_STYLE('red').color).toBe('var(--dsw-alias-label-error, #ff3b30)')
    expect(INLINE_WARNING_STYLE('amber').color).toBe(
      'var(--dsw-alias-label-warning, #ff9f0a)',
    )
    expect(INLINE_WARNING_STYLE('neutral').color).toBe(
      'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    )
  })

  it('paints the sudo wait control label with the state-warn token pair', () => {
    expect(SUDO_STATE_LABEL_COLOR).toBe(
      'var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-warning, #ff9f0a))',
    )
  })

  it('paints the help button as an accent fill when active', () => {
    const active = HELP_BUTTON_STYLE(true)
    expect(active.background).toBe('var(--dsw-alias-accent, #0a84ff)')
    expect(active.color).toBe('#fff')
    const inactive = HELP_BUTTON_STYLE(false)
    expect(inactive.background).toBe('transparent')
    expect(inactive.color).toBe('var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))')
  })

  it('derives the button variants from the shared base', () => {
    for (const variant of [GHOST_BUTTON, PRIMARY_BUTTON]) {
      expect(variant.padding).toBe(BUTTON_BASE.padding)
      expect(variant.borderRadius).toBe(BUTTON_BASE.borderRadius)
      expect(variant.cursor).toBe(BUTTON_BASE.cursor)
    }
    expect(GHOST_BUTTON.background).toBe('transparent')
    expect(PRIMARY_BUTTON.border).toBe('none')
  })

  it('clamps the progress percent to the 0-100 range the strip spans', () => {
    expect(clampPercent(42)).toBe(42)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(-5)).toBe(0)
  })
})
