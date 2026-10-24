import type { GpuUsageProbe } from './reserve.ts';
import type { Config } from './config.ts';
/**
 * ProviderStatus is the running-state the plugin card paints each saved
 * provider's status dot: green while the engine is confirmed serving the
 * model, red while the engine is not running, and yellow (unsure) while the
 * detector cannot tell which model, if any, is live.
 */
export type ProviderStatus = 'running' | 'stopped' | 'unsure';
/**
 * ProviderRef is the identity side of one saved provider config: the stable
 * id the card renders and the engine and model it serves. The model is
 * optional because a config that names no model cannot be confirmed against
 * a running engine, and reads as unsure rather than a guess. The config is
 * optional and lets the detector price the provider's own launch signature
 * (the engine binary the build mode runs, the port it binds) rather than the
 * adapter's default-port signature; the port is the resolved bind port the
 * detector read from that signature, and the resolver ties a running engine
 * to the provider only when the ports agree.
 */
export interface ProviderRef {
    id: string;
    engine: string;
    model?: string;
    config?: Config;
    port?: number;
}
/**
 * RunningEngineRef is one engine the detector confirmed live: the engine id,
 * the port it binds when the signature carries one, and the model it serves
 * when the detector could identify it. A ref without a modelId is an engine
 * the detector saw running but could not tie to a model, which is the
 * "engine running, model unknown" case that reads as unsure.
 */
export interface RunningEngineRef {
    engineId: string;
    port?: number;
    modelId?: string;
}
/**
 * ProviderStatusInput is the detector's answer the pure resolver consumes:
 * the saved providers, the engines the process probe confirmed running, and
 * whether the card is busy (its VRAM usage at the 75% threshold). The
 * resolver is a pure function of these, so a test prices a busy card or a
 * foreign engine without a live nvidia-smi or ps.
 */
export interface ProviderStatusInput {
    providers: readonly ProviderRef[];
    running: readonly RunningEngineRef[];
    gpuBusy: boolean;
}
/**
 * isGpuBusy reports whether a GPU usage reading reads the card as busy: the
 * used VRAM at 75% of the total or more. A missing reading or an empty total
 * is not busy, so a host the detector cannot read never reads as busy.
 */
export declare function isGpuBusy(usage?: GpuUsageProbe | null): boolean;
/**
 * computeProviderStatuses resolves each saved provider's running-state from
 * the detector's answer. The order is the plan's contract:
 * 1. A provider whose engine the process probe confirmed running is running
 *    (green) when the detector tied that engine to the provider's exact model,
 *    and unsure (yellow) when the engine serves an unidentified or a
 *    different model. A running engine using its VRAM does not read as a busy
 *    card, so the dot is green, not the unattributable yellow.
 * 2. A provider whose engine is not running falls back to the card state: a
 *    busy card (a foreign engine holding the VRAM at 75% or more) reads as
 *    unsure, because a full card cannot be attributed to a single model, and
 *    a quiet card reads as stopped (red): the process probe saw no engine, so
 *    a saved config whose engine is down is stopped.
 */
export declare function computeProviderStatuses(input: ProviderStatusInput): Record<string, ProviderStatus>;
//# sourceMappingURL=status.d.ts.map