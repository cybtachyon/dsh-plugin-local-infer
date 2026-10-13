import { describe, expect, it } from 'vitest'
import { detectHardware, parseNvidiaSmiGpu } from '../src/index.ts'

describe('parseNvidiaSmiGpu', () => {
  it('reads a 3090 CSV line into name, VRAM, and compute capability', () => {
    const probe = parseNvidiaSmiGpu('NVIDIA GeForce RTX 3090, 24576 MiB, 8.6\n')
    expect(probe).toEqual({ name: 'NVIDIA GeForce RTX 3090', vramMiB: 24576, computeCap: 8.6 })
  })

  it('reads a Blackwell line and keeps the first GPU of a multi-GPU host', () => {
    const probe = parseNvidiaSmiGpu(
      'NVIDIA GeForce RTX 5090, 32768 MiB, 12.0\nNVIDIA GeForce RTX 3090, 24576 MiB, 8.6\n',
    )
    expect(probe).toEqual({ name: 'NVIDIA GeForce RTX 5090', vramMiB: 32768, computeCap: 12 })
  })

  it('degrades to null on empty or unparseable output', () => {
    expect(parseNvidiaSmiGpu('')).toBeNull()
    expect(parseNvidiaSmiGpu('\n\n')).toBeNull()
    expect(parseNvidiaSmiGpu('NVIDIA GeForce RTX 3090\n')).toBeNull()
    expect(parseNvidiaSmiGpu('GPU 0, N/A, N/A\n')).toBeNull()
  })
})

describe('detectHardware', () => {
  it('turns a full probe set into a profile with the SM number times ten', () => {
    const profile = detectHardware({
      os: 'linux',
      cpuThreads: 16,
      dockerAvailable: true,
      wsl2: false,
      hostRamGiB: 64,
      gpu: { name: 'NVIDIA GeForce RTX 3090', vramMiB: 24576, computeCap: 8.6 },
    })
    expect(profile).toEqual({
      gpu: { name: 'NVIDIA GeForce RTX 3090', vramGiB: 24, sm: 86 },
      hostRamGiB: 64,
      dockerAvailable: true,
      wsl2: false,
      os: 'linux',
      cpuThreads: 16,
    })
  })

  it('omits the gpu and hostRamGiB fields when the probes found nothing', () => {
    const profile = detectHardware({
      os: 'macos',
      cpuThreads: 10,
      dockerAvailable: false,
      wsl2: false,
      gpu: null,
    })
    expect(profile).toEqual({
      dockerAvailable: false,
      wsl2: false,
      os: 'macos',
      cpuThreads: 10,
    })
    expect('gpu' in profile).toBe(false)
    expect('hostRamGiB' in profile).toBe(false)
  })

  it('maps a 12.0 capability to SM 120 and a 8.9 to SM 89', () => {
    const blackwell = detectHardware({
      os: 'linux',
      cpuThreads: 4,
      dockerAvailable: false,
      wsl2: false,
      gpu: { name: 'RTX 5090', vramMiB: 32768, computeCap: 12.0 },
    })
    const ada = detectHardware({
      os: 'linux',
      cpuThreads: 4,
      dockerAvailable: false,
      wsl2: false,
      gpu: { name: 'RTX 4090', vramMiB: 24576, computeCap: 8.9 },
    })
    expect(blackwell.gpu?.sm).toBe(120)
    expect(ada.gpu?.sm).toBe(89)
  })
})
