/**
 * The Infernix shared Linux build profile. Every Linux distro (Arch, Debian,
 * Fedora) builds Infernix through the engine's own cmake preset: configure the
 * release preset, then build into the `build` directory, which is where the
 * `infernix-serve` binary lands. The distro profiles reuse this profile, so a
 * distro carries no build steps of its own.
 * @module dsh-plugin-local-infer/providers/engines/infernixLinux
 */
export const INFERNIX_LINUX = {
    buildSteps: ['cd {dir} && cmake --preset release && cmake --build build -j'],
    buildDir: 'build',
    binary: 'infernix-serve',
};
/**
 * infernixLinuxBinary returns the Infernix engine binary name on Linux: the
 * plain `infernix-serve` (no .exe). The name comes from the shared Linux
 * profile, so the spelling has one home.
 */
export function infernixLinuxBinary() {
    return INFERNIX_LINUX.binary ?? 'infernix-serve';
}
//# sourceMappingURL=infernixLinux.js.map