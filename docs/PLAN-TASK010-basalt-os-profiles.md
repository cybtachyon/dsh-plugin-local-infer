# TASK 010 — Add the Basalt OS profiles

**Phase:** 3 — The Basalt engine
**Depends on:** TASK 006

## What

Create `packages/providers/src/engines/basalt/{basaltLinux,basaltMacOS,basaltWindows}.ts`:

- `BASALT_LINUX` / `BASALT_MACOS` / `BASALT_WINDOWS`: `EngineOsProfile` with the
  CMake build steps (`cmake -S {dir} -B build -DCMAKE_BUILD_TYPE=Release` then
  `cmake --build build -j`; the Windows profile adds `-G Ninja` and runs in the
  MSVC developer shell), `buildDir: 'build'`, `binary: 'basalt'`, and the
  per-platform `deps` (CMake, CUDA 13, a C++20 compiler, Python 3.10+, the hf
  CLI; the Windows profile adds Ninja and the Visual Studio C++ workload).

## Definition of Done

- `pnpm build` type-checks.
- A unit test asserts each profile's `buildSteps` match the README commands and
  that the Windows profile's `deps` include Ninja and the MSVC workload while the
  Linux profile's include the CUDA toolkit.
