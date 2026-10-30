import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHAT_TEMPLATE_FILE,
  hfChatTemplateCommand,
  hfDownloadCommand,
  modelArtifactPath,
  modelEntriesForEngine,
  repoIdFromUrl,
  repoNameFromUrl,
} from '../src/models.ts'
import type { DefaultModel, ModelDirectoryEntry } from '../src/models.ts'

const ENTRY: DefaultModel = {
  engineId: 'ninfer',
  modelId: 'qwen3-27b',
  label: 'Ninfer Qwen3.8-27B',
  url: 'https://huggingface.co/neroued/Qwen3.8-27B-nvfp4-NInfer',
  file: 'qwen3_8_27b_nvfp4.ninfer',
}

const NO_FILE: DefaultModel = {
  engineId: 'hyperqwen',
  modelId: 'qwen3-27b',
  label: 'HyperQwen Qwen3.8-27B',
  url: 'https://huggingface.co/born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
}

describe('repoIdFromUrl', () => {
  it('parses the owner/name repo id from a huggingface.co URL', () => {
    expect(repoIdFromUrl(ENTRY.url)).toBe('neroued/Qwen3.8-27B-nvfp4-NInfer')
    expect(repoIdFromUrl(NO_FILE.url)).toBe('born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast')
  })

  it('reads a URL without an owner/name pair as an empty id', () => {
    expect(repoIdFromUrl('https://huggingface.co/only-one-segment')).toBe('')
    expect(repoIdFromUrl('not a url at all')).toBe('')
  })
})

describe('repoNameFromUrl', () => {
  it('is the last path segment of the repo id', () => {
    expect(repoNameFromUrl(ENTRY.url)).toBe('Qwen3.8-27B-nvfp4-NInfer')
  })

  it('degrades with the empty repo id', () => {
    expect(repoNameFromUrl('no url')).toBe('')
  })
})

describe('modelArtifactPath', () => {
  it('joins the entry file into the directory when the entry names one', () => {
    // The builder joins with the host path separator, so the expectation joins
    // the same way: /models/file on Linux, \models\file on Windows.
    expect(modelArtifactPath(ENTRY, '/models')).toBe(join('/models', 'qwen3_8_27b_nvfp4.ninfer'))
  })

  it('falls back to the repo-name directory when the entry names no file', () => {
    expect(modelArtifactPath(NO_FILE, '/models')).toBe(
      join('/models', 'Qwen3.8-27B-W4A16-AutoRound-fast'),
    )
  })
})

describe('hfDownloadCommand', () => {
  it('renders the repo, file, and local-dir for an entry with a file', () => {
    expect(hfDownloadCommand(ENTRY, '/home/user/.dsh/models')).toBe(
      'hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --local-dir /home/user/.dsh/models',
    )
  })

  it('renders a whole-repo download for an entry without a file', () => {
    expect(hfDownloadCommand(NO_FILE, '/models')).toBe(
      'hf download born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast --local-dir /models',
    )
  })
})

describe('hfChatTemplateCommand', () => {
  it('renders the repo, the template file, and the local-dir target', () => {
    expect(hfChatTemplateCommand('froggeric/Qwen-Fixed-Chat-Templates', '/models')).toBe(
      `hf download froggeric/Qwen-Fixed-Chat-Templates ${CHAT_TEMPLATE_FILE} --local-dir /models`,
    )
  })

  it('targets a custom repo reference into the model directory', () => {
    expect(hfChatTemplateCommand('acme/my-templates', '/home/user/.dsh/models')).toBe(
      `hf download acme/my-templates ${CHAT_TEMPLATE_FILE} --local-dir /home/user/.dsh/models`,
    )
  })
})

describe('modelEntriesForEngine', () => {
  const entries: ModelDirectoryEntry[] = [
    { name: 'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer', isDirectory: false },
    { name: 'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix', isDirectory: false },
    { name: 'Qwen3.8-27B-Q4_K_M.gguf', isDirectory: false },
    { name: 'Qwen3.8-27B-W4A16-AutoRound-fast', isDirectory: true, hasSafetensors: true },
    { name: 'froggeric_Qwen-Fixed-Chat-Templates', isDirectory: true, hasSafetensors: false },
    { name: 'notes.txt', isDirectory: false },
  ]

  it('offers the .ninfer artifacts to NInfer', () => {
    expect(modelEntriesForEngine(entries, 'ninfer')).toEqual([
      'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
    ])
  })

  it('offers the .ninfer and .infernix artifacts to Infernix', () => {
    expect(modelEntriesForEngine(entries, 'infernix')).toEqual([
      'Qwen3.8-Flash-Next-DFlash2-Infernix.infernix',
      'qwen3_8_27b_swift15abl_nvfp4full-dflash2.ninfer',
    ])
  })

  it('offers the .gguf files to llama.cpp', () => {
    expect(modelEntriesForEngine(entries, 'llamacpp')).toEqual(['Qwen3.8-27B-Q4_K_M.gguf'])
  })

  it('offers the weight-bearing repo directories to Hyper-Qwen', () => {
    expect(modelEntriesForEngine(entries, 'hyperqwen')).toEqual([
      'Qwen3.8-27B-W4A16-AutoRound-fast',
    ])
  })

  it('offers nothing to every other engine', () => {
    expect(modelEntriesForEngine(entries, 'strata')).toEqual([])
  })

  it('reads an empty listing as an empty list', () => {
    expect(modelEntriesForEngine([], 'ninfer')).toEqual([])
  })
})
