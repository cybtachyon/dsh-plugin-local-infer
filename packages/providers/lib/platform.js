/**
 * The per-engine platform defaults the card's Engine platform section seeds:
 * the local build command the deploy step runs in the checkout and the docker
 * image tag the docker deploy pulls. Both are data, so a new engine's
 * defaults are a data edit here, never a card rewire.
 * @module dsh-plugin-local-infer/providers/platform
 */
import { LLAMACPP_DOCKER_IMAGE, NINFER_DOCKER_IMAGE, STRATA_DOCKER_IMAGE, } from "./adapters.js";
import { engineBuildSteps } from "./acquire.js";
// The local build command is the engine's first acquisition build step (the
// cmake build the deploy step runs in the checkout), read through
// engineBuildSteps so the card's placeholder and the deploy step share one
// list. A step list that is empty (the compose engines) contributes no
// build command.
const NINFER_BUILD_COMMAND = engineBuildSteps('ninfer')[0];
const LLAMACPP_BUILD_COMMAND = engineBuildSteps('llamacpp')[0];
const INFERNIX_BUILD_COMMAND = engineBuildSteps('infernix')[0];
const STRATA_BUILD_COMMAND = engineBuildSteps('strata')[0];
/**
 * The per-engine platform defaults, keyed by engine id. The build command is
 * the engine's first acquisition build step; the docker tag is the upstream
 * image the adapter pulls. Hyper-Qwen is compose-driven, so its docker tag is
 * the vLLM OpenAI server image; Infernix ships no docker image, so it carries
 * a build command only.
 */
export const ENGINE_PLATFORM_DEFAULTS = {
    ninfer: {
        ...(NINFER_BUILD_COMMAND !== undefined ? { defaultBuildCommand: NINFER_BUILD_COMMAND } : {}),
        defaultDockerTag: NINFER_DOCKER_IMAGE,
    },
    hyperqwen: {
        // The compose setup selects a profile, not an image tag, so the card's
        // docker-tag field seeds the compose arguments the up step runs: the
        // launcher's default `single` profile.
        defaultDockerTag: '--profile single',
    },
    llamacpp: {
        ...(LLAMACPP_BUILD_COMMAND !== undefined
            ? { defaultBuildCommand: LLAMACPP_BUILD_COMMAND }
            : {}),
        defaultDockerTag: LLAMACPP_DOCKER_IMAGE,
    },
    infernix: {
        ...(INFERNIX_BUILD_COMMAND !== undefined
            ? { defaultBuildCommand: INFERNIX_BUILD_COMMAND }
            : {}),
    },
    strata: {
        ...(STRATA_BUILD_COMMAND !== undefined
            ? { defaultBuildCommand: STRATA_BUILD_COMMAND }
            : {}),
        defaultDockerTag: STRATA_DOCKER_IMAGE,
    },
};
/**
 * enginePlatformDefaults reads the registered platform defaults for an engine
 * id, or an empty object when none is registered.
 */
export function enginePlatformDefaults(engineId) {
    return ENGINE_PLATFORM_DEFAULTS[engineId] ?? {};
}
//# sourceMappingURL=platform.js.map