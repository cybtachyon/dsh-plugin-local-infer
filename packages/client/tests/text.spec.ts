import { afterEach, describe, expect, it } from 'vitest'
import { TEXT, labels } from '../src/text.ts'

/**
 * The locale selector reads document.documentElement.lang and
 * navigator.language, which the node test environment only half provides:
 * there is no document, and Node 21+ defines navigator as a getter-only
 * global. Each fallback test therefore installs stubs on globalThis and the
 * teardown removes them.
 */

function stubDocument(lang: string): void {
  ;(globalThis as Record<string, unknown>).document = {
    documentElement: { lang },
  }
}

function stubNavigator(language: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language },
    configurable: true,
  })
}

describe('client text (text.ts)', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document
    delete (globalThis as Record<string, unknown>).navigator
  })

  it('selects the zh table for a zh-prefix locale', () => {
    expect(labels('zh-CN')).toBe(TEXT.zh)
    expect(labels('zh')).toBe(TEXT.zh)
    // The selector lowercases before the prefix check.
    expect(labels('ZH-TW')).toBe(TEXT.zh)
  })

  it('selects the en table for a non-zh locale', () => {
    expect(labels('en-US')).toBe(TEXT.en)
    expect(labels('fr')).toBe(TEXT.en)
  })

  it('falls back to the document lang when the active locale is empty', () => {
    stubDocument('zh-CN')
    expect(labels()).toBe(TEXT.zh)
    expect(labels(null)).toBe(TEXT.zh)
    stubDocument('en-US')
    expect(labels(undefined)).toBe(TEXT.en)
  })

  it('falls back to the browser language when the document lang is empty', () => {
    stubDocument('')
    stubNavigator('zh-TW')
    expect(labels()).toBe(TEXT.zh)
    stubNavigator('en-US')
    expect(labels()).toBe(TEXT.en)
  })

  it('defaults to en when no locale source is available', () => {
    stubDocument('')
    stubNavigator('')
    expect(labels()).toBe(TEXT.en)
  })

  it('keeps the zh table key-complete against en', () => {
    expect(Object.keys(TEXT.zh).sort()).toEqual(Object.keys(TEXT.en).sort())
  })

  it('reads the Get separator as "Getting engine and model..."', () => {
    // The separator the Get button seeds and the get route persists to the
    // log file, so the Logs section and the log file read the run as a fresh
    // process section.
    expect(TEXT.en.getting).toBe('Getting engine and model...')
    expect(TEXT.zh.getting).toBe('获取引擎和模型中…')
  })
})
