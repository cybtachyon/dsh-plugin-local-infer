import type { PackageManager } from './deps.ts';
/**
 * GpuProfile is the detected graphics card: its name, VRAM in GiB, and the SM
 * architecture number that gates certain KV formats and speculation backends.
 */
export interface GpuProfile {
    name: string;
    vramGiB: number;
    sm: number;
    driver?: string;
}
/**
 * HardwareProfile is the capability side of every parameter-to-hardware
 * relationship. It feeds the estimator (vramGiB to usable bytes), the
 * guideline engine (SM arch gates KV formats and specs), and the adapters
 * (docker versus local, WSL2 pin-memory). Detection is a service.
 */
export interface HardwareProfile {
    gpu?: GpuProfile;
    hostRamGiB?: number;
    dockerAvailable: boolean;
    wsl2: boolean;
    os: 'linux' | 'windows' | 'macos';
    cpuThreads: number;
    packageManager?: PackageManager;
}
/**
 * GpuProbe is the raw GPU reading the detector feeds: the card name, the VRAM
 * in MiB, and the CUDA compute capability (8.6 reads as SM 86).
 */
export interface GpuProbe {
    name: string;
    vramMiB: number;
    computeCap: number;
}
/**
 * HardwareProbes are the raw probe results a detection run collects: the OS,
 * CPU thread count, host RAM, docker availability, WSL2, and the GPU reading
 * when one exists. The probes are the service's job; turning them into a
 * HardwareProfile is this pure function's, so the mapping stays unit-testable
 * without spawning a single process.
 */
export interface HardwareProbes {
    os: 'linux' | 'windows' | 'macos';
    cpuThreads: number;
    dockerAvailable: boolean;
    wsl2: boolean;
    hostRamGiB?: number;
    gpu?: GpuProbe | null;
    packageManager?: PackageManager | null;
}
/**
 * parseNvidiaSmiGpu reads the first CSV line of
 * `nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader`
 * (for example `NVIDIA GeForce RTX 3090, 24576 MiB, 8.6`) into a GpuProbe.
 * It returns null on any line it cannot parse, so a missing or broken nvidia-
 * smi degrades to "no GPU" instead of a guess.
 */
export declare function parseNvidiaSmiGpu(output: string): GpuProbe | null;
/**
 * detectHardware turns probe results into a HardwareProfile. The SM number is
 * the compute capability times ten (8.6 to 86, 12.0 to 120); an unknown
 * capability degrades to the conservative 0, which gates the SM-gated KV
 * formats off.
 */
export declare function detectHardware(probes: HardwareProbes): HardwareProfile;
//# sourceMappingURL=hardware.d.ts.map