/**
 * Strata parameter surface. The declarative `ParameterSpec` data for the
 * Strata engine (https://github.com/Niko1221/Strata), sourced from the
 * repository's `docs/AI_SETUP.md` (the `strata launch` flags) and
 * `docs/DOCKER.md` (the container environment variables). Each spec carries
 * both a `toArgv` spelling (the `strata launch` flag the binary and source
 * build modes pass) and a `toEnv` spelling (the container variable the docker
 * mode passes), so the one surface renders every build mode.
 *
 * The data is the surface; the `StrataAdapter` composes it into a `LaunchPlan`.
 * Adding a flag here is a data edit, never an adapter rewire.
 * @module dsh-plugin-local-infer/providers/strata
 */
import type { Config, EnumOption, ParameterSpec } from 'dsh-plugin-local-infer/core';
/**
 * The model families Strata serves. `qwen` is the Qwen3.8-Flash-Next family
 * (the default); the others are the size-specific variants the README's
 * Models section names.
 */
export declare const STRATA_FAMILY_OPTIONS: readonly EnumOption[];
/**
 * The picture-reader modes. `on` lets the engine pick the CPU reader under a
 * 24 GB card and the GPU reader from 24 GB; `gpu` and `cpu` force a side.
 */
export declare const STRATA_VISION_OPTIONS: readonly EnumOption[];
/**
 * The tuning modes. `skip` is the engine default (no tuning run); `quick` is
 * a one-time run of up to about 20 minutes; `thorough` is a longer run.
 */
export declare const STRATA_TUNE_OPTIONS: readonly EnumOption[];
/**
 * The access modes. `local` listens on 127.0.0.1 only and needs no key; every
 * other mode makes a key for you, because the server is then reachable beyond
 * this machine.
 */
export declare const STRATA_ACCESS_OPTIONS: readonly EnumOption[];
/**
 * The Strata `ParameterSpec` surface, in form order. The `group` field is the
 * form section; specs without a group render under `General`. The `toArgv`
 * spelling is the `strata launch` flag the binary and source-build modes pass;
 * the `toEnv` spelling is the container variable the docker mode passes. A
 * spec with no `toEnv` (access, dataDir) has no docker counterpart, and a spec
 * with no `toArgv` (port) is spelled by the adapter from the value.
 */
export declare const STRATA_PARAMETERS: readonly ParameterSpec[];
/**
 * The Strata model key a config carries: the string model value, falling back
 * to an empty string so a bare config renders a plan the engine sizes for the
 * card (the engine picks the model when none is named). A value that names a
 * local artifact file passes through unchanged.
 */
export declare function strataModelKey(config: Config): string;
/**
 * StrataSourceLaunchArgs is the resolved input the OS-specific source-build
 * launch functions take: the model (empty lets the engine pick), the family,
 * the vision mode, the optional context, the port, and the card's Custom
 * Arguments. The adapter resolves these from the config and hands them to the
 * function for the host OS.
 */
export interface StrataSourceLaunchArgs {
    model: string;
    family: string;
    vision: string;
    context: string | undefined;
    port: number;
    customArgs: readonly string[];
}
/**
 * strataSourceLaunchArgs renders the source-build wrapper argv shared by every
 * OS. The wrapper's `--vision` takes yes|no|gpu|cpu, so the surface's on|off
 * maps onto it (gpu and cpu pass through). The command name is the one
 * OS-specific piece, supplied by the caller (setup.sh on Linux/Mac,
 * START-HERE.bat on Windows).
 */
export declare function strataSourceLaunchArgs(command: string, args: StrataSourceLaunchArgs): string[];
//# sourceMappingURL=strata.d.ts.map