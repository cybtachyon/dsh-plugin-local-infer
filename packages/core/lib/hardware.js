/**
 * parseNvidiaSmiGpu reads the first CSV line of
 * `nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader`
 * (for example `NVIDIA GeForce RTX 3090, 24576 MiB, 8.6`) into a GpuProbe.
 * It returns null on any line it cannot parse, so a missing or broken nvidia-
 * smi degrades to "no GPU" instead of a guess.
 */
export function parseNvidiaSmiGpu(output) {
    const line = output
        .split('\n')
        .map(part => part.trim())
        .find(part => part.length > 0);
    if (line === undefined)
        return null;
    const parts = line.split(',').map(part => part.trim());
    const name = parts[0];
    const vramField = parts[1];
    const capField = parts[2];
    if (name === undefined || vramField === undefined || capField === undefined)
        return null;
    const vramMatch = vramField.match(/^(\d+(?:\.\d+)?)\s*MiB$/);
    const capMatch = capField.match(/^(\d+)(?:\.(\d+))?$/);
    if (vramMatch === null || capMatch === null)
        return null;
    const minor = capMatch[2] !== undefined ? Number(`0.${capMatch[2]}`) : 0;
    return {
        name,
        vramMiB: Number(vramMatch[1]),
        computeCap: Number(capMatch[1]) + minor,
    };
}
/**
 * detectHardware turns probe results into a HardwareProfile. The SM number is
 * the compute capability times ten (8.6 to 86, 12.0 to 120); an unknown
 * capability degrades to the conservative 0, which gates the SM-gated KV
 * formats off.
 */
export function detectHardware(probes) {
    const profile = {
        dockerAvailable: probes.dockerAvailable,
        wsl2: probes.wsl2,
        os: probes.os,
        cpuThreads: probes.cpuThreads,
    };
    if (probes.gpu !== undefined && probes.gpu !== null) {
        profile.gpu = {
            name: probes.gpu.name,
            vramGiB: probes.gpu.vramMiB / 1024,
            sm: Math.round(probes.gpu.computeCap * 10),
        };
    }
    if (probes.hostRamGiB !== undefined) {
        profile.hostRamGiB = probes.hostRamGiB;
    }
    if (probes.packageManager !== undefined && probes.packageManager !== null) {
        profile.packageManager = probes.packageManager;
    }
    return profile;
}
//# sourceMappingURL=hardware.js.map