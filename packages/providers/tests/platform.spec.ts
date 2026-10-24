import { describe, expect, it } from 'vitest'
import {
  ENGINE_PLATFORM_DEFAULTS,
  enginePlatformDefaults,
} from '../src/platform.ts'
import {
  LLAMACPP_DOCKER_IMAGE,
  NINFER_DOCKER_IMAGE,
  STRATA_DOCKER_IMAGE,
} from '../src/adapters.ts'
import { engineBuildSteps } from '../src/acquire.ts'

describe('engine platform defaults', () => {
  it('seeds the local build command from the engine first build step', () => {
    expect(ENGINE_PLATFORM_DEFAULTS.ninfer?.defaultBuildCommand).toBe(
      engineBuildSteps('ninfer')[0],
    )
    expect(ENGINE_PLATFORM_DEFAULTS.llamacpp?.defaultBuildCommand).toBe(
      engineBuildSteps('llamacpp')[0],
    )
    expect(ENGINE_PLATFORM_DEFAULTS.infernix?.defaultBuildCommand).toBe(
      engineBuildSteps('infernix')[0],
    )
  })

  it('seeds the docker tag from the engine upstream image', () => {
    expect(ENGINE_PLATFORM_DEFAULTS.ninfer?.defaultDockerTag).toBe(NINFER_DOCKER_IMAGE)
    expect(ENGINE_PLATFORM_DEFAULTS.llamacpp?.defaultDockerTag).toBe(LLAMACPP_DOCKER_IMAGE)
    expect(ENGINE_PLATFORM_DEFAULTS.strata?.defaultDockerTag).toBe(STRATA_DOCKER_IMAGE)
    // The compose vLLM engine selects a profile, not an image tag, so the
    // docker-tag field seeds the compose arguments the up step runs.
    expect(ENGINE_PLATFORM_DEFAULTS.hyperqwen?.defaultDockerTag).toBe('--profile single')
  })

  it('omits a default the engine does not support', () => {
    // The compose engine has no local build step; the local-only engine ships
    // no docker image.
    expect(ENGINE_PLATFORM_DEFAULTS.hyperqwen?.defaultBuildCommand).toBeUndefined()
    expect(ENGINE_PLATFORM_DEFAULTS.infernix?.defaultDockerTag).toBeUndefined()
  })

  it('reads a registered engine defaults through the accessor', () => {
    expect(enginePlatformDefaults('ninfer')).toEqual(ENGINE_PLATFORM_DEFAULTS.ninfer)
  })

  it('reads an empty object for an unregistered engine', () => {
    expect(enginePlatformDefaults('no-such-engine')).toEqual({})
  })
})
