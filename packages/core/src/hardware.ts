/**
 * GpuProfile is the detected graphics card: its name, VRAM in GiB, and the SM
 * architecture number that gates certain KV formats and speculation backends.
 */
export interface GpuProfile {
  name: string
  vramGiB: number
  sm: number
  driver?: string
}

/**
 * HardwareProfile is the capability side of every parameter-to-hardware
 * relationship. It feeds the estimator (vramGiB to usable bytes), the
 * guideline engine (SM arch gates KV formats and specs), and the adapters
 * (docker versus local, WSL2 pin-memory). Detection is a service.
 */
export interface HardwareProfile {
  gpu?: GpuProfile
  hostRamGiB?: number
  dockerAvailable: boolean
  wsl2: boolean
  os: 'linux' | 'windows' | 'macos'
  cpuThreads: number
}

/**
 * GpuProbe is the raw GPU reading the detector feeds: the card name, the VRAM
 * in MiB, and the CUDA compute capability (8.6 reads as SM 86).
 */
export interface GpuProbe {
  name: string
  vramMiB: number
  computeCap: number
}

/**
 * HardwareProbes are the raw probe results a detection run collects: the OS,
 * CPU thread count, host RAM, docker availability, WSL2, and the GPU reading
 * when one exists. The probes are the service's job; turning them into a
 * HardwareProfile is this pure function's, so the mapping stays unit-testable
 * without spawning a single process.
 */
export interface HardwareProbes {
  os: 'linux' | 'windows' | 'macos'
  cpuThreads: number
  dockerAvailable: boolean
  wsl2: boolean
  hostRamGiB?: number
  gpu?: GpuProbe | null
}

/**
 * parseNvidiaSmiGpu reads the first CSV line of
 * `nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader`
 * (for example `NVIDIA GeForce RTX 3090, 24576 MiB, 8.6`) into a GpuProbe.
 * It returns null on any line it cannot parse, so a missing or broken nvidia-
 * smi degrades to "no GPU" instead of a guess.
 */
export function parseNvidiaSmiGpu(output: string): GpuProbe | null {
  const line = output
    .split('\n')
    .map(part => part.trim())
    .find(part => part.length > 0)
  if (line === undefined) return null
  const parts = line.split(',').map(part => part.trim())
  const name = parts[0]
  const vramField = parts[1]
  const capField = parts[2]
  if (name === undefined || vramField === undefined || capField === undefined) return null
  const vramMatch = vramField.match(/^(\d+(?:\.\d+)?)\s*MiB$/)
  const capMatch = capField.match(/^(\d+)(?:\.(\d+))?$/)
  if (vramMatch === null || capMatch === null) return null
  const minor = capMatch[2] !== undefined ? Number(`0.${capMatch[2]}`) : 0
  return {
    name,
    vramMiB: Number(vramMatch[1]),
    computeCap: Number(capMatch[1]) + minor,
  }
}

/**
 * detectHardware turns probe results into a HardwareProfile. The SM number is
 * the compute capability times ten (8.6 to 86, 12.0 to 120); an unknown
 * capability degrades to the conservative 0, which gates the SM-gated KV
 * formats off.
 */
export function detectHardware(probes: HardwareProbes): HardwareProfile {
  const profile: HardwareProfile = {
    dockerAvailable: probes.dockerAvailable,
    wsl2: probes.wsl2,
    os: probes.os,
    cpuThreads: probes.cpuThreads,
  }
  if (probes.gpu !== undefined && probes.gpu !== null) {
    profile.gpu = {
      name: probes.gpu.name,
      vramGiB: probes.gpu.vramMiB / 1024,
      sm: Math.round(probes.gpu.computeCap * 10),
    }
  }
  if (probes.hostRamGiB !== undefined) {
    profile.hostRamGiB = probes.hostRamGiB
  }
  return profile
}
