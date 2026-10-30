/**
 * EngineOsProfile is the per-engine, per-OS build configuration: the build
 * steps run in the checkout (the `{dir}` placeholder is substituted before a
 * step runs), the directory, relative to the checkout, where the build leaves
 * the engine binary, the binary name on this OS (the .exe on Windows), and the
 * shell the build steps run in (absent runs the host's default shell).
 *
 * The profile is the single source the acquisition build step, the platform
 * defaults, and the binary symlink step read, so a build command and its
 * output directory have one home. The distro-specific Linux profiles (Arch,
 * Debian, Fedora) reuse the shared Linux profile, so they carry no build steps
 * of their own.
 * @module dsh-plugin-local-infer/providers/engines/engineOs
 */
export interface EngineOsProfile {
  // The shell build steps the checkout runs, in order. An engine with no local
  // build (the compose engines) carries an empty list.
  buildSteps: readonly string[]
  // The directory, relative to the checkout, where the build leaves the engine
  // binary. Absent when the build installs the binary to the path instead.
  buildDir?: string
  // The engine binary name on this OS (the .exe on Windows). Absent when the
  // engine has no local binary (the compose engines).
  binary?: string
  // The shell the build steps run in (the Windows vcpkg route names
  // powershell.exe, because its steps set $env: variables). Absent runs the
  // host's default shell.
  shell?: string
}
