/**
 * The per-engine platform defaults the card's Engine platform section seeds:
 * the local build command the deploy step runs in the checkout and the docker
 * image tag the docker deploy pulls. Both are data, so a new engine's
 * defaults are a data edit here, never a card rewire.
 * @module dsh-plugin-local-infer/providers/platform
 */
/**
 * EnginePlatformDefaults is the per-engine platform defaults: the local build
 * command (the engine's first acquisition build step) and the docker image tag
 * the docker deploy pulls. An engine that supports neither a mode carries no
 * entry for it.
 */
export interface EnginePlatformDefaults {
    defaultBuildCommand?: string;
    defaultDockerTag?: string;
}
/**
 * The per-engine platform defaults, keyed by engine id. The build command is
 * the engine's first acquisition build step; the docker tag is the upstream
 * image the adapter pulls. Hyper-Qwen is compose-driven, so its docker tag is
 * the vLLM OpenAI server image; Infernix ships no docker image, so it carries
 * a build command only.
 */
export declare const ENGINE_PLATFORM_DEFAULTS: Record<string, EnginePlatformDefaults>;
/**
 * enginePlatformDefaults reads the registered platform defaults for an engine
 * id on an OS, or an empty object when none is registered. The build command
 * is the engine's first build step for the OS (the Windows vcpkg route on a
 * Windows host), so the card's placeholder seeds the OS-appropriate default.
 * The docker tag is OS-independent and rides the registered entry.
 */
export declare function enginePlatformDefaults(engineId: string, os?: 'linux' | 'windows' | 'macos'): EnginePlatformDefaults;
//# sourceMappingURL=platform.d.ts.map