/**
 * GpuUsageProbe is the card's live VRAM reading: the used and total MiB from
 * nvidia-smi. The detector feeds it to the reserve resolver, which prices a
 * busy card against its own usage rather than the 3 GiB default.
 */
export interface GpuUsageProbe {
    usedMiB: number;
    totalMiB: number;
}
/**
 * parseNvidiaSmiGpuUsage reads the first CSV line of
 * `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader`
 * (for example `4096 MiB, 24576 MiB`) into a GpuUsageProbe. It returns null
 * on any line it cannot parse, so a missing or broken nvidia-smi degrades to
 * "no usage reading" instead of a guess.
 */
export declare function parseNvidiaSmiGpuUsage(output: string): GpuUsageProbe | null;
/**
 * EngineLaunchSignature is the launch signature one engine's toArgv/toEnv
 * produce: the binary (or docker image) the engine runs under, the port it
 * binds, and the env keys it sets. A running process that carries the
 * signature is a local inference the plugin did not launch, and its VRAM
 * usage is what the reserve resolver prices.
 */
export interface EngineLaunchSignature {
    binary: string;
    port?: number;
    envKeys?: readonly string[];
}
/**
 * ProcessLine is one running-process row the detector feeds the matcher: the
 * process id, the full command line, and, when the detector read it (the
 * Linux /proc environ), the process's env. A line without env data degrades
 * the env-key element to neutral, so a host the detector cannot read never
 * reads as "no match". The pid names the process the kill command targets.
 */
export interface ProcessLine {
    pid: number;
    command: string;
    env?: Record<string, string>;
}
/**
 * matchLaunchSignature checks one process line against one engine's launch
 * signature. The binary marker must appear in the command line (the image
 * name for a docker plan, the engine binary for a local one); a declared port
 * must appear as a standalone number (the `--port N` flag or the docker
 * `-p host:port:port` mapping); a declared env key must be set when the line
 * carries env data, and is neutral when it does not.
 */
export declare function matchLaunchSignature(line: ProcessLine, signature: EngineLaunchSignature): boolean;
/**
 * The GPU-usage fallback threshold: at 75% or more of the card's VRAM in use
 * the card reads as busy, and the reserve rises to the used VRAM instead of
 * the 3 GiB default.
 */
export declare const GPU_USAGE_BUSY_THRESHOLD = 0.75;
/**
 * ReserveSource names where a resolved OS reserve came from: the 3 GiB
 * default, an explicit config value, a foreign engine detected by process,
 * or the 75%-usage fallback. The meter's readout renders the label.
 */
export type ReserveSource = 'default' | 'explicit' | 'foreign-process' | 'gpu-usage';
/**
 * ReserveResolution is the resolver's answer: the reserve in MiB and the
 * source that supplied it, so the meter, the verdict, and the DSH
 * contextWindow all price the same number.
 */
export interface ReserveResolution {
    reserveMiB: number;
    source: ReserveSource;
}
/**
 * resolveOsReserve is the Phase 10 resolution order for the OS reserve, a
 * pure function of the probe results:
 * 1. The plugin launched the engine itself, so its footprint is already
 *    priced by the estimator and the reserve stays at the 3 GiB default.
 * 2. A foreign engine is detected by process signature, so the reserve
 *    rises to the GPU's used VRAM, capped at the card's capacity.
 * 3. No process signature matched: the card is busy when its VRAM usage is
 *    at the 75% threshold or above, and the reserve rises to the used VRAM.
 *    Below the threshold, or with no usage reading, the 3 GiB default
 *    applies.
 */
export declare function resolveOsReserve(input: {
    pluginLaunched: boolean;
    foreignProcess?: boolean;
    gpuUsage?: GpuUsageProbe | null;
}): ReserveResolution;
//# sourceMappingURL=reserve.d.ts.map