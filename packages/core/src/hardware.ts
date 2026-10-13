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
