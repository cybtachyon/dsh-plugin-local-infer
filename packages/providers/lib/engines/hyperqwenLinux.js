/**
 * The Hyper-Qwen shared Linux build profile. Hyper-Qwen is the compose-driven
 * vLLM engine: the compose up pulls the image, so it carries no local build
 * steps, no build directory, and no local binary. The distro profiles (Arch,
 * Debian, Fedora) reuse this profile.
 * @module dsh-plugin-local-infer/providers/engines/hyperqwenLinux
 */
export const HYPERQWEN_LINUX = {
    buildSteps: [],
};
//# sourceMappingURL=hyperqwenLinux.js.map