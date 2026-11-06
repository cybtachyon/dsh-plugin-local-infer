import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, afterAll, describe, expect, it } from 'vitest'
import {
  CHAT_TEMPLATE_FILE,
  chatTemplateArtifactPath,
  chatTemplatePresent,
  hfChatTemplateCommand,
  hfDownloadCommand,
  hubCacheModelDirectory,
  hubCacheSnapshotFilePath,
  isModelDirectoryOverridden,
  modelArtifactPath,
  modelArtifactPresent,
  modelCacheEntriesForEngine,
  modelEntriesForEngine,
  repoIdFromUrl,
  repoNameFromUrl,
} from '../src/models.ts'
import type {
  DefaultModel,
  ModelCacheEntry,
  ModelDirectoryEntry,
} from '../src/models.ts'

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

  it('resolves into the per-model cache dir blobs folder with the hub-cache layout', () => {
    expect(modelArtifactPath(ENTRY, '/hub', true)).toBe(
      join('/hub', 'models--neroued--Qwen3.8-27B-nvfp4-NInfer', 'blobs'),
    )
    // A whole-repo entry (no file) resolves to the same per-model blobs folder.
    expect(modelArtifactPath(NO_FILE, '/hub', true)).toBe(
      join('/hub', 'models--born2bewild--Qwen3.8-27B-W4A16-AutoRound-fast', 'blobs'),
    )
  })
})

describe('hfDownloadCommand', () => {
  it('renders the repo, file, and local-dir for an entry with a file', () => {
    expect(hfDownloadCommand(ENTRY, '/home/user/.dsh/models')).toBe(
      'hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --local-dir /home/user/.dsh/models --format human',
    )
  })

  it('renders a whole-repo download for an entry without a file', () => {
    expect(hfDownloadCommand(NO_FILE, '/models')).toBe(
      'hf download born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast --local-dir /models --format human',
    )
  })

  it('drops the local-dir for the hub-cache layout (the default model directory)', () => {
    expect(hfDownloadCommand(ENTRY, '/hub', true)).toBe(
      'hf download neroued/Qwen3.8-27B-nvfp4-NInfer qwen3_8_27b_nvfp4.ninfer --format human',
    )
    expect(hfDownloadCommand(NO_FILE, '/hub', true)).toBe(
      'hf download born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast --format human',
    )
  })
})

describe('hfChatTemplateCommand', () => {
  it('renders the repo, the template file, and the local-dir target', () => {
    expect(hfChatTemplateCommand('froggeric/Qwen-Fixed-Chat-Templates', '/models')).toBe(
      `hf download froggeric/Qwen-Fixed-Chat-Templates ${CHAT_TEMPLATE_FILE} --local-dir /models --format human`,
    )
  })

  it('targets a custom repo reference into the model directory', () => {
    expect(hfChatTemplateCommand('acme/my-templates', '/home/user/.dsh/models')).toBe(
      `hf download acme/my-templates ${CHAT_TEMPLATE_FILE} --local-dir /home/user/.dsh/models --format human`,
    )
  })

  it('drops the local-dir for the hub-cache layout (the default model directory)', () => {
    expect(hfChatTemplateCommand('froggeric/Qwen-Fixed-Chat-Templates', '/hub', true)).toBe(
      `hf download froggeric/Qwen-Fixed-Chat-Templates ${CHAT_TEMPLATE_FILE} --format human`,
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

describe('hubCacheModelDirectory', () => {
  it('encodes the repo id into the models--{ns}--{name} directory', () => {
    expect(hubCacheModelDirectory('neroued/Qwen3.8-27B-nvfp4-NInfer')).toBe(
      'models--neroued--Qwen3.8-27B-nvfp4-NInfer',
    )
  })

  it('reads a repo id without an owner/name pair as an empty directory', () => {
    expect(hubCacheModelDirectory('no-slash')).toBe('')
    expect(hubCacheModelDirectory('')).toBe('')
  })
})

describe('isModelDirectoryOverridden', () => {
  it('reads a non-blank string as an override', () => {
    expect(isModelDirectoryOverridden('/models')).toBe(true)
  })

  it('reads a blank string, undefined, and a non-string as no override', () => {
    expect(isModelDirectoryOverridden('')).toBe(false)
    expect(isModelDirectoryOverridden('   ')).toBe(false)
    expect(isModelDirectoryOverridden(undefined)).toBe(false)
    expect(isModelDirectoryOverridden(42)).toBe(false)
  })
})

describe('chatTemplateArtifactPath', () => {
  it('joins the template file into the directory for the flat layout', () => {
    expect(chatTemplateArtifactPath('/models')).toBe(join('/models', CHAT_TEMPLATE_FILE))
  })
})

describe('modelArtifactPresent', () => {
  // A scratch hub cache laid out like the hf CLI's per-model store, plus a
  // flat model directory, so both presence layouts resolve against real
  // paths.
  const root = mkdtempSync(join(tmpdir(), 'models-present-'))
  const flat = join(root, 'models')
  const hub = join(root, 'hub')
  const modelRoot = join(hub, 'models--neroued--Qwen3.8-27B-nvfp4-NInfer')
  const repoRoot = join(hub, 'models--born2bewild--Qwen3.8-27B-W4A16-AutoRound-fast')
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('checks the flat join under the flat layout', () => {
    mkdirSync(flat, { recursive: true })
    expect(modelArtifactPresent(ENTRY, flat)).toBe(false)
    writeFileSync(join(flat, 'qwen3_8_27b_nvfp4.ninfer'), 'w')
    expect(modelArtifactPresent(ENTRY, flat)).toBe(true)
  })

  it('checks the repo-name directory for a whole-repo entry under the flat layout', () => {
    mkdirSync(flat, { recursive: true })
    expect(modelArtifactPresent(NO_FILE, flat)).toBe(false)
    mkdirSync(join(flat, 'Qwen3.8-27B-W4A16-AutoRound-fast'), { recursive: true })
    expect(modelArtifactPresent(NO_FILE, flat)).toBe(true)
  })

  it('reads a bare blobs folder as absent under the hub-cache layout', () => {
    // The coarse blobs marker is gone: blobs from another file's download do
    // not carry the selected artifact, so the model reads absent.
    mkdirSync(join(modelRoot, 'blobs'), { recursive: true })
    expect(modelArtifactPresent(ENTRY, hub, true)).toBe(false)
  })

  it('resolves the deterministic snapshot for the selected file under the hub-cache layout', () => {
    const snapshot = join(modelRoot, 'snapshots', 'cafebabe')
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'qwen3_8_27b_nvfp4.ninfer'), 'cached')
    expect(modelArtifactPresent(ENTRY, hub, true)).toBe(true)
  })

  it('reads a snapshot directory for a whole-repo entry under the hub-cache layout', () => {
    expect(modelArtifactPresent(NO_FILE, hub, true)).toBe(false)
    mkdirSync(join(repoRoot, 'snapshots', 'deadbeef'), { recursive: true })
    expect(modelArtifactPresent(NO_FILE, hub, true)).toBe(true)
  })
})

describe('chatTemplatePresent', () => {
  const REPO = 'froggeric/Qwen-Fixed-Chat-Templates'
  const root = mkdtempSync(join(tmpdir(), 'template-present-'))
  const flat = join(root, 'models')
  const hub = join(root, 'hub')
  const snapshots = join(hub, 'models--froggeric--Qwen-Fixed-Chat-Templates', 'snapshots')
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('checks the flat file join under the flat layout', () => {
    mkdirSync(flat, { recursive: true })
    expect(chatTemplatePresent(REPO, flat)).toBe(false)
    writeFileSync(join(flat, CHAT_TEMPLATE_FILE), 'tpl')
    expect(chatTemplatePresent(REPO, flat)).toBe(true)
  })

  it('reads a bare snapshots folder as absent under the hub-cache layout', () => {
    mkdirSync(join(snapshots, 'cafebabe'), { recursive: true })
    expect(chatTemplatePresent(REPO, hub, true)).toBe(false)
  })

  it('resolves the deterministic snapshot for the template file under the hub-cache layout', () => {
    writeFileSync(join(snapshots, 'cafebabe', CHAT_TEMPLATE_FILE), 'tpl')
    expect(chatTemplatePresent(REPO, hub, true)).toBe(true)
  })
})

describe('modelCacheEntriesForEngine', () => {
  const cache: ModelCacheEntry[] = [
    { repoId: 'jesdga/Qwen3.8-Flash-Next-Basalt', files: ['Qwen3.8-FN-NVFP4-DQ6_K.basalt'] },
    { repoId: 'neroued/Qwen3.8-27B-nvfp4-NInfer', files: ['qwen3_8_27b_nvfp4.ninfer'] },
    {
      repoId: 'Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix',
      files: [
        'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00001-of-00003.infernix',
        'Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix-00002-of-00003.infernix',
      ],
    },
    { repoId: 'ggml-org/Qwen3.8-27B-GGUF', files: ['Qwen3.8-27B-Q4_K_M.gguf'] },
    {
      repoId: 'born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
      files: ['model-00001-of-00002.safetensors', 'model.safetensors.index.json'],
    },
    { repoId: 'alesha-pro/Strata-GGUF', files: ['qwen3-8-27b-gguf-q4_k_m.gguf'] },
    { repoId: 'acme/weights-only', files: ['model.safetensors'] },
  ]

  it('offers the .basalt model to Basalt', () => {
    expect(modelCacheEntriesForEngine(cache, 'basalt')).toEqual([
      'jesdga/Qwen3.8-Flash-Next-Basalt',
    ])
  })

  it('offers the .ninfer model to NInfer', () => {
    expect(modelCacheEntriesForEngine(cache, 'ninfer')).toEqual([
      'neroued/Qwen3.8-27B-nvfp4-NInfer',
    ])
  })

  it('offers the .ninfer and .infernix models to Infernix', () => {
    expect(modelCacheEntriesForEngine(cache, 'infernix')).toEqual([
      'Wallawalla47/Qwen3.8-Flash-Next-NVIDIA-NVFP4-Dense8-Infernix',
      'neroued/Qwen3.8-27B-nvfp4-NInfer',
    ])
  })

  it('offers the .gguf models to llama.cpp', () => {
    expect(modelCacheEntriesForEngine(cache, 'llamacpp')).toEqual([
      'alesha-pro/Strata-GGUF',
      'ggml-org/Qwen3.8-27B-GGUF',
    ])
  })

  it('offers the weight-bearing repo to Hyper-Qwen', () => {
    expect(modelCacheEntriesForEngine(cache, 'hyperqwen')).toEqual([
      'acme/weights-only',
      'born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
    ])
  })

  it('offers the .gguf and .safetensors models to Strata', () => {
    expect(modelCacheEntriesForEngine(cache, 'strata')).toEqual([
      'acme/weights-only',
      'alesha-pro/Strata-GGUF',
      'born2bewild/Qwen3.8-27B-W4A16-AutoRound-fast',
      'ggml-org/Qwen3.8-27B-GGUF',
    ])
  })

  it('lists none for an engine with no matching cached model', () => {
    expect(modelCacheEntriesForEngine([], 'basalt')).toEqual([])
  })
})

describe('hubCacheSnapshotFilePath', () => {
  const REPO = 'catthehacker/Mixtral-v1'
  const MODEL_DIR = 'models--catthehacker--Mixtral-v1'
  const FILE = 'mixtral-Q4_K_M.gguf'
  const COMMIT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const COMMIT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const COMMIT_C = 'cccccccccccccccccccccccccccccccccccccccc'

  // Each case gets a fresh scratch hub cache rooted under its own temp dir,
  // laid out as the hf CLI's per-model cache: snapshots/{commit}/{file} plus
  // the optional refs/main branch ref, so no ref leaks between cases.
  const scratch: string[] = []

  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  // seedHubCache builds a per-model cache holding `commits` (ordered oldest
  // to newest by mtime), writing the artifact file into the names in
  // `holders` and writing the refs/main branch ref when `ref` is non-blank.
  // Returns the hub cache root to pass to hubCacheSnapshotFilePath.
  function seedHubCache(commits: string[], holders: string[], ref = ''): string {
    const hubCache = mkdtempSync(join(tmpdir(), 'models-snap-'))
    scratch.push(hubCache)
    const root = join(hubCache, MODEL_DIR)
    commits.forEach((commit, i) => {
      const dir = join(root, 'snapshots', commit)
      mkdirSync(dir, { recursive: true })
      if (holders.includes(commit)) writeFileSync(join(dir, FILE), 'gguf')
      // Stagger mtimes ~1s apart along the ordered commits list.
      const when = new Date(1700000000000 + i * 1000)
      utimesSync(dir, when, when)
    })
    if (ref !== '') {
      mkdirSync(join(root, 'refs'), { recursive: true })
      writeFileSync(join(root, 'refs', 'main'), `${ref}\n`)
    }
    return hubCache
  }

  it('returns null when the per-model dir name is empty', () => {
    const hubCache = seedHubCache([COMMIT_A], [COMMIT_A])
    expect(hubCacheSnapshotFilePath(hubCache, 'no-slash', FILE)).toBeNull()
  })

  it('returns null when the snapshots dir does not exist', () => {
    const hubCache = seedHubCache([], [])
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBeNull()
  })

  it('picks the sole snapshot that holds the file', () => {
    const hubCache = seedHubCache([COMMIT_A], [COMMIT_A])
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBe(
      join(hubCache, MODEL_DIR, 'snapshots', COMMIT_A, FILE),
    )
  })

  it('prefers the ref/main commit snapshot over a newer one by mtime', () => {
    // commits ordered oldest-to-newest: COMMIT_A oldest, COMMIT_B newest.
    // The ref names COMMIT_A (older), so it wins over the newer COMMIT_B.
    const hubCache = seedHubCache([COMMIT_A, COMMIT_B], [COMMIT_A, COMMIT_B], COMMIT_A)
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBe(
      join(hubCache, MODEL_DIR, 'snapshots', COMMIT_A, FILE),
    )
  })

  it('falls back to newest mtime when there is no ref', () => {
    const hubCache = seedHubCache([COMMIT_A, COMMIT_B], [COMMIT_A, COMMIT_B])
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBe(
      join(hubCache, MODEL_DIR, 'snapshots', COMMIT_B, FILE),
    )
  })

  it('falls back to newest mtime when the ref names an absent commit', () => {
    // Snapshots COMMIT_A (older) and COMMIT_B (newer) hold the file; the ref
    // names COMMIT_C, which has no snapshot dir, so mtime decides on COMMIT_B.
    const hubCache = seedHubCache([COMMIT_A, COMMIT_B], [COMMIT_A, COMMIT_B], COMMIT_C)
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBe(
      join(hubCache, MODEL_DIR, 'snapshots', COMMIT_B, FILE),
    )
  })

  it('falls back to newest mtime when the ref snapshot lacks the file', () => {
    // COMMIT_C's snapshot exists but holds no file; the ref names it, so
    // mtime decides among the file-holding snapshots and COMMIT_B wins.
    const hubCache = seedHubCache(
      [COMMIT_A, COMMIT_B, COMMIT_C],
      [COMMIT_A, COMMIT_B],
      COMMIT_C,
    )
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBe(
      join(hubCache, MODEL_DIR, 'snapshots', COMMIT_B, FILE),
    )
  })

  it('returns null when no snapshot holds the file', () => {
    const hubCache = seedHubCache([COMMIT_A, COMMIT_B], [])
    expect(hubCacheSnapshotFilePath(hubCache, REPO, FILE)).toBeNull()
  })
})
