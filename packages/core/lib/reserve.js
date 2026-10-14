import { DEFAULT_OS_RESERVE_MIB } from "./estimator.js";
/**
 * parseNvidiaSmiGpuUsage reads the first CSV line of
 * `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader`
 * (for example `4096 MiB, 24576 MiB`) into a GpuUsageProbe. It returns null
 * on any line it cannot parse, so a missing or broken nvidia-smi degrades to
 * "no usage reading" instead of a guess.
 */
export function parseNvidiaSmiGpuUsage(output) {
    const line = output
        .split('\n')
        .map(part => part.trim())
        .find(part => part.length > 0);
    if (line === undefined)
        return null;
    const parts = line.split(',').map(part => part.trim());
    const usedMatch = parts[0]?.match(/^(\d+(?:\.\d+)?)\s*MiB$/);
    const totalMatch = parts[1]?.match(/^(\d+(?:\.\d+)?)\s*MiB$/);
    if (usedMatch === undefined || usedMatch === null || totalMatch === undefined || totalMatch === null) {
        return null;
    }
    return {
        usedMiB: Number(usedMatch[1]),
        totalMiB: Number(totalMatch[1]),
    };
}
/**
 * matchLaunchSignature checks one process line against one engine's launch
 * signature. The binary marker must appear in the command line (the image
 * name for a docker plan, the engine binary for a local one); a declared port
 * must appear as a standalone number (the `--port N` flag or the docker
 * `-p host:port:port` mapping); a declared env key must be set when the line
 * carries env data, and is neutral when it does not.
 */
export function matchLaunchSignature(line, signature) {
    if (!line.command.includes(signature.binary))
        return false;
    if (signature.port !== undefined && !portAppears(line.command, signature.port))
        return false;
    if (signature.envKeys !== undefined && signature.envKeys.length > 0 && line.env !== undefined) {
        const hit = signature.envKeys.some(key => key in line.env);
        if (!hit)
            return false;
    }
    return true;
}
/**
 * portAppears reports whether a port number appears in a command line as a
 * standalone number: `--port 18020` and the docker `-p 127.0.0.1:18020:8080`
 * mapping both carry it, while 180200 does not read as 18020.
 */
function portAppears(command, port) {
    const pattern = new RegExp(`(?:^|[^0-9])${port}(?:[^0-9]|$)`);
    return pattern.test(command);
}
/**
 * The GPU-usage fallback threshold: at 75% or more of the card's VRAM in use
 * the card reads as busy, and the reserve rises to the used VRAM instead of
 * the 3 GiB default.
 */
export const GPU_USAGE_BUSY_THRESHOLD = 0.75;
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
export function resolveOsReserve(input) {
    if (input.pluginLaunched) {
        return { reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' };
    }
    const usedMiB = input.gpuUsage?.usedMiB;
    const cappedMiB = usedMiB !== undefined && input.gpuUsage !== null && input.gpuUsage !== undefined
        ? Math.min(usedMiB, input.gpuUsage.totalMiB)
        : undefined;
    if (input.foreignProcess === true && cappedMiB !== undefined) {
        return { reserveMiB: cappedMiB, source: 'foreign-process' };
    }
    if (input.gpuUsage !== null &&
        input.gpuUsage !== undefined &&
        input.gpuUsage.totalMiB > 0 &&
        input.gpuUsage.usedMiB / input.gpuUsage.totalMiB >= GPU_USAGE_BUSY_THRESHOLD) {
        return { reserveMiB: cappedMiB ?? input.gpuUsage.usedMiB, source: 'gpu-usage' };
    }
    return { reserveMiB: DEFAULT_OS_RESERVE_MIB, source: 'default' };
}
//# sourceMappingURL=reserve.js.map