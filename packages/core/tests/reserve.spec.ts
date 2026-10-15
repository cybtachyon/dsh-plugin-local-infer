import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OS_RESERVE_MIB,
  GPU_USAGE_BUSY_THRESHOLD,
  matchLaunchSignature,
  parseNvidiaSmiGpuUsage,
  resolveOsReserve,
} from '../src/index.ts'
import type {
  EngineLaunchSignature,
  GpuUsageProbe,
  ProcessLine,
} from '../src/index.ts'

const GPU_BUSY: GpuUsageProbe = { usedMiB: 18000, totalMiB: 24576 }
const GPU_IDLE: GpuUsageProbe = { usedMiB: 2048, totalMiB: 24576 }

describe('parseNvidiaSmiGpuUsage', () => {
  it('reads the used and total MiB out of the nvidia-smi CSV line', () => {
    const probe = parseNvidiaSmiGpuUsage('4096 MiB, 24576 MiB')
    expect(probe).toEqual({ usedMiB: 4096, totalMiB: 24576 })
  })

  it('reads the first non-empty line of a multi-line answer', () => {
    const probe = parseNvidiaSmiGpuUsage('\n  8192 MiB, 16384 MiB  \n')
    expect(probe).toEqual({ usedMiB: 8192, totalMiB: 16384 })
  })

  it('degrades to null on a line it cannot parse', () => {
    expect(parseNvidiaSmiGpuUsage('')).toBeNull()
    expect(parseNvidiaSmiGpuUsage('N/A, N/A')).toBeNull()
    expect(parseNvidiaSmiGpuUsage('4096 MiB')).toBeNull()
  })
})

describe('matchLaunchSignature', () => {
  const signature: EngineLaunchSignature = { binary: 'ninfer-serve', port: 18020 }

  it('matches a local engine process by binary and port', () => {
    const line: ProcessLine = {
      pid: 1,
      command: 'ninfer-serve /models/model.ninfer --host 127.0.0.1 --port 18020',
    }
    expect(matchLaunchSignature(line, signature)).toBe(true)
  })

  it('rejects a process whose command line lacks the binary marker', () => {
    const line: ProcessLine = { pid: 2, command: 'llama-server --port 18020' }
    expect(matchLaunchSignature(line, signature)).toBe(false)
  })

  it('rejects a process on a different port', () => {
    const line: ProcessLine = { pid: 3, command: 'ninfer-serve model.ninfer --port 18021' }
    expect(matchLaunchSignature(line, signature)).toBe(false)
  })

  it('reads a port inside a docker -p mapping as a standalone number', () => {
    const docker: EngineLaunchSignature = { binary: 'ghcr.io/iamwavecut/ninfer-all', port: 18020 }
    const line: ProcessLine = {
      pid: 4,
      command:
        'docker run --rm --gpus all -p 127.0.0.1:18020:8080 ghcr.io/iamwavecut/ninfer-all serve',
    }
    expect(matchLaunchSignature(line, docker)).toBe(true)
  })

  it('does not read a longer port number as the signature port', () => {
    const line: ProcessLine = { pid: 5, command: 'ninfer-serve model.ninfer --port 180200' }
    expect(matchLaunchSignature(line, signature)).toBe(false)
  })

  it('matches on the binary alone when the signature declares no port', () => {
    const bare: EngineLaunchSignature = { binary: 'docker compose' }
    const line: ProcessLine = {
      pid: 6,
      command: 'docker compose -f docker-compose.yml --profile single up',
    }
    expect(matchLaunchSignature(line, bare)).toBe(true)
  })

  it('requires a declared env key when the line carries env data', () => {
    const withEnv: EngineLaunchSignature = {
      binary: 'vllm',
      envKeys: ['VLLM_USE_V1', 'VLLM_WORKER_MULTIPROC_METHOD'],
    }
    const hit: ProcessLine = {
      pid: 7,
      command: 'vllm serve model',
      env: { VLLM_USE_V1: '1' },
    }
    const miss: ProcessLine = { pid: 8, command: 'vllm serve model', env: { PATH: '/usr/bin' } }
    expect(matchLaunchSignature(hit, withEnv)).toBe(true)
    expect(matchLaunchSignature(miss, withEnv)).toBe(false)
  })

  it('treats the env element as neutral when the line carries no env data', () => {
    const withEnv: EngineLaunchSignature = { binary: 'vllm', envKeys: ['VLLM_USE_V1'] }
    const noEnv: ProcessLine = { pid: 9, command: 'vllm serve model' }
    expect(matchLaunchSignature(noEnv, withEnv)).toBe(true)
  })
})

describe('resolveOsReserve', () => {
  it('keeps the 3 GiB default when the plugin launched the engine', () => {
    // The plugin-launched check wins over everything: a busy card and a
    // matching foreign process both stay priced at the default, because the
    // estimator already prices the plugin engine's footprint.
    const resolution = resolveOsReserve({
      pluginLaunched: true,
      foreignProcess: true,
      gpuUsage: GPU_BUSY,
    })
    expect(resolution).toEqual({ reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' })
  })

  it('raises the reserve to the used VRAM when a foreign engine is detected by process', () => {
    const resolution = resolveOsReserve({
      pluginLaunched: false,
      foreignProcess: true,
      gpuUsage: GPU_BUSY,
    })
    expect(resolution).toEqual({ reserveMiB: 18000, source: 'foreign-process' })
  })

  it('caps the foreign-process reserve at the card capacity', () => {
    const overshot: GpuUsageProbe = { usedMiB: 30000, totalMiB: 24576 }
    const resolution = resolveOsReserve({ pluginLaunched: false, foreignProcess: true, gpuUsage: overshot })
    expect(resolution).toEqual({ reserveMiB: 24576, source: 'foreign-process' })
  })

  it('reads a foreign process without a GPU usage reading as the default', () => {
    const resolution = resolveOsReserve({
      pluginLaunched: false,
      foreignProcess: true,
      gpuUsage: null,
    })
    expect(resolution).toEqual({ reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' })
  })

  it('raises the reserve through the 75% usage fallback when no process matched', () => {
    // 18000/24576 is 73.2%, under the threshold: the default applies.
    const under: GpuUsageProbe = { usedMiB: 18000, totalMiB: 24576 }
    expect(resolveOsReserve({ pluginLaunched: false, gpuUsage: under })).toEqual({
      reserveMiB: DEFAULT_OS_RESERVE_MIB,
      source: 'default',
    })
    // 24576/24576 is 100%, over: the used VRAM becomes the reserve.
    const busy: GpuUsageProbe = { usedMiB: 24576, totalMiB: 24576 }
    expect(resolveOsReserve({ pluginLaunched: false, gpuUsage: busy })).toEqual({
      reserveMiB: 24576,
      source: 'gpu-usage',
    })
  })

  it('fires the fallback exactly at the 75% threshold', () => {
    // 9000/12000 is exactly 0.75: the card reads as busy.
    const at: GpuUsageProbe = { usedMiB: 9000, totalMiB: 12000 }
    expect(resolveOsReserve({ pluginLaunched: false, gpuUsage: at })).toEqual({
      reserveMiB: 9000,
      source: 'gpu-usage',
    })
    expect(GPU_USAGE_BUSY_THRESHOLD).toBe(0.75)
  })

  it('keeps the default below the threshold and with no usage reading', () => {
    const idle = resolveOsReserve({ pluginLaunched: false, gpuUsage: GPU_IDLE })
    expect(idle).toEqual({ reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' })
    const none = resolveOsReserve({ pluginLaunched: false, gpuUsage: null })
    expect(none).toEqual({ reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' })
    const absent = resolveOsReserve({ pluginLaunched: false })
    expect(absent).toEqual({ reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' })
  })
})
