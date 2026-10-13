# PLAN: `dsh-plugin-local-infer`

A DeepSeek Harness (Cordis) TypeScript plugin that manages local inference engines:
llama.cpp, NInfer, Hyper-Qwen (vLLM), Strata, and more. It lets a user pick a model and an
engine, tune the parameters in a form that is aware of each parameter's type, watch a live
**VRAM Est.** meter, see **hardware warnings** the moment a value (or a parameter itself)
is unsafe for the detected hardware, then **build, deploy, and health-check** the engine and
**automatically register it as a DSH model** once it is confirmed working.

---

## 1. Goal and scope

**Goal.** Give a local-LLM user one place to configure, size, launch, and publish a local
inference engine, so the engine shows up in DeepSeek Harness as a usable model with no hand
editing of `cordis.patch.yml`.

**In scope.**

- A declarative, inheritance-focused parameter model shared across engines and models.
- A live VRAM estimation meter driven by the current parameter values.
- Human-readable, behavior-first descriptions for every parameter.
- Form-type-aware rendering: booleans as checkboxes, enums as dropdowns, numbers as sliders/
  number inputs, strings as text.
- A hardware-aware guideline engine that raises red warnings on parameter values and on the
  presence of parameters the hardware cannot support.
- Engine adapters for both **docker** and **locally-built** engines, including tools like
  NInfer that support both.
- OS system-level dependency provisioning: a per-OS/package-manager install string the user can
  copy/paste, or a Play/Run (sudo) one-click, that gates the "Get" button until the host deps
  (docker, CUDA toolkit, ffmpeg, HF CLI, ...) are satisfied.
- Deep DSH integration: a confirmed-working engine is added as a DSH model automatically.
- Sane defaults for common platform/hardware combinations, sourced through the **mod-search
  skill**.

**Out of scope (for now).** Multi-GPU tensor/pipeline parallelism tuning UI (exposed later as
plain parameters), model weight conversion/quantization, and remote (non-local) engines.

**Guiding principle.** The plugin is data-driven. The relationships between parameters and
hardware are not scattered `if` statements; they are declarative, testable objects. A
parameter *declares* its VRAM contribution and its hardware constraints; the estimator and the
guideline engine *consume* those declarations. Adding a new engine, model, or rule is a matter
of adding data and a thin subclass, never rewiring the core.

---

## 2. Reference baseline (what already exists to build on)

The plan is grounded in concrete local references. The implementer should read these before
writing code.

| Reference                | Path                                               | What it gives us                                                                                                                                                                                                                                                                                                                  |
|--------------------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Cordis plugin shape      | `src/dsh-plugin-codegraph/`                        | The template: a pnpm monorepo of `packages/*` (bundle, service, providers, tool), a `cordis.patch.yml` that inserts service rows, `package.json` with a `dsh.bundle.patch` field, `ctx.tools.register(defineTool(...))`, `ctx.on(...)` events, `ctx.systemPrompt.section(...)`, `InferArgs`/`InferValue`, schemastery `z` config. |
| Cordis tutorial          | `docs/cordis-tutorial/index.md` (deepseek-harness) | Plugin = a module with `name`, `inject`, a validated `Config`, and `apply(ctx, config)`; services via `declare module` + `Service`; effects/lifecycle.                                                                                                                                                                            |
| NInfer engine            | `src/ninfer/`                                      | C++/CUDA engine. `docs/serving.md` + `apps/serve/main.cpp` for the serve flag surface; `docs/device-profiles.md` for hardware-class behavior; `docs/config-calculator.html` for the **measured VRAM model** (weights, KV bytes/token per format, speculation terms, page rounding, largest-fitting-context solver).               |
| Hyper-Qwen engine        | `src/hyper-qwen/`                                  | vLLM-based, docker-compose driven. `docker-compose.yml` + `.env.example` for the env-var parameter surface (SPEC, DFLASH_TOKENS, CTX, KV, GPU_UTIL, ...).                                                                                                                                                                         |
| Current launcher scripts | `src/inference-launcher/qwen-ninfer`, `qwen-hyper` | The manual workflow the plugin automates: build-or-pull, download model, start engine, poll `/health` until 200, then start `dsh web`.                                                                                                                                                                                            |
| DSH model registration   | `~/.dsh/profiles/web/cordis.patch.yml`             | The exact target shape: a `@deepseek-ai/dsh-llm-pi-ai` provider entry (`apiKeyEnv`, `api: openai-completions`, `baseURL`, `models: [{ id, name, contextWindow }]`) plus an `agent-default-model` entry.                                                                                                                           |
| mod-search skill         | `@liustack/modsearch` (in the web profile)         | Web search / page fetch / X search bridge. The source of externally-sourced sane defaults.                                                                                                                                                                                                                                        |

**Toolchain (from the scaffold).** `mise.toml` pins `pnpm 12.11.2`; `eslint.config.mjs` uses
`typescript-eslint`; `package.json` already lists `typescript`, `vitest`, `eslint`. Mirror the
codegraph workspace: pnpm workspace, `tsc -b` project references, vitest with `vite-tsconfig-paths`.

---

## 3. Core domain model

All abstractions live in a shared `core` package so every engine and model composes the same
primitives. This is the inheritance-focused spine of the plugin.

### 3.1 `ParameterSpec` (the unit of parameter management)

A declarative description of one engine parameter. It is the object that makes the
"parameter ↔ hardware" relationship first-class.

```ts
interface ParameterSpec {
  key: string                 // stable id, e.g. "kvDtype", "maxContext"
  label: string              // short display name
  description: string        // BEHAVIOR-first: "what it does", not "what it is"
  form:
    | { kind: 'boolean' }                       // → checkbox
    | { kind: 'enum'; options: EnumOption[] }   // → dropdown
    | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string } // → slider + number
    | { kind: 'text'; placeholder?: string }    // → text input
    | { kind: 'path' }                         // → directory/file picker
  defaultValue?: unknown
  group?: string             // section in the form, e.g. "Memory", "Speculation", "Sampling"
  // The relationships (the point of the design):
  vramContribution?: (value: unknown, ctx: EstimateContext) => VramContribution
  hardwareConstraint?: (value: unknown, hw: HardwareProfile) => ConstraintResult
  requires?: (config: Config) => string | null   // cross-param dependency, e.g. "lmHeadDraft needs spec"
  // Engine-specific rendering:
  toArgv?: (value: unknown) => string[]          // how the value becomes a CLI flag
  toEnv?:  (value: unknown) => [string, string]  // how the value becomes an env var
}
```

`EnumOption` carries `value`, `label`, and a free-form `note` (the KV-format tradeoff text, e.g.
"rk4v4: the context choice, 31% smaller than rk8v4"). `ConstraintResult` is
`{ ok: true } | { ok: false; severity: 'warn' | 'error'; message: string }`.

The **form-type awareness** requirement is satisfied entirely by `form`: the renderer switches
on `form.kind` (checkbox / dropdown / slider / text / picker). The **human-readable description**
requirement is the `description` field, written to explain the effect ("raising this shrinks the
KV cache and lets a longer context fit" not "the KV data type").

### 3.2 `HardwareProfile` (the capability facts)

```ts
interface HardwareProfile {
  gpu?: { name: string; vramGiB: number; sm: number; driver?: string }  // from nvidia-smi / device profile
  hostRamGiB?: number
  dockerAvailable: boolean
  wsl2: boolean
  os: 'linux' | 'windows' | 'macos'
  cpuThreads: number
}
```

`HardwareProfile` is the *capability* side of every relationship. It feeds the estimator
(`vramGiB` → usable bytes), the guideline engine (SM arch gates certain KV formats / specs), and
the adapter (docker vs. local, WSL2 pin-memory). Detection is a service (see §5.3).

### 3.3 `EngineAdapter` (abstract base; one per engine)

```ts
abstract class EngineAdapter {
  abstract readonly id: string                       // "ninfer" | "hyperqwen" | "llamacpp" | "strata"
  abstract readonly supports: { docker: boolean; local: boolean }
  abstract parameters(): ParameterSpec[]            // the engine's parameter surface
  abstract renderLaunch(config: Config, hw: HardwareProfile): LaunchPlan  // argv/env/docker compose
  abstract healthCheck(plan: LaunchPlan): Promise<HealthResult>          // poll /health
  abstract deploy(plan: LaunchPlan): Promise<DeployResult>             // build / pull / run
  abstract stop(plan: LaunchPlan): Promise<void>
}
```

- `NInferAdapter`: `local` = cmake build → `ninfer-serve`; `docker` = `ghcr.io/.../ninfer serve`.
  Both map to the same `ParameterSpec`s (see §3.7 for the NInfer surface). NInfer is the canonical
  "supports both" engine.
- `HyperQwenAdapter`: docker-compose profiles (`single`/`batch`/`solo`); parameters map to `.env`
  keys (`SPEC`, `DFLASH_TOKENS`, `CTX`, `KV`, `GPU_UTIL`, ...).
- `LlamaCppAdapter`: `llama-server` / `llama.cpp` router; docker + local.
- `StrataAdapter`: placeholder adapter; same base, engine-specific `parameters()` and
  `renderLaunch` added when the engine is available.

`LaunchPlan` is the engine-neutral result: `{ kind: 'process' | 'docker' | 'compose'; argv?; env?;
composeFile?; port; healthUrl }`.

### 3.4 `VramEstimator` (the VRAM Est. meter)

Composes the parameter contributions into a breakdown and a verdict. It is a pure function of
(`VramModel`, `config`, `HardwareProfile`) and is fully unit-testable.

```ts
interface VramModel {
  weightsBytes: number
  workspaceBytes: number | ((ctx: number) => number)   // may step with ctx (CUDA-graph allowance)
  kvBytesPerToken: Record<string, number>              // per KV dtype
  seqFixedBytes: number
  seqPerToken: number
  speculation?: Record<string, SpeculationTerms>        // kvRatio, kvExtraPerToken, graphBytes, seqFixedBytes, seqPerToken, weightsGiB
  nativeMaxContext: number
  source: 'measured' | 'estimated'
}

interface VramBreakdown {
  weights: number; kv: number; overhead: number; workspace: number
  free: number; reserve: number; total: number; usable: number
  largestFittingContext: number | null
}

interface VramVerdict { status: 'fits' | 'tight' | 'over' | 'not-measured'; detail: string }
```

The formula mirrors NInfer's own `config-calculator.html` (the authoritative, engine-cross-checked
arithmetic), generalized so an engine without measured constants falls back to a `VramModel`
derived from the model card (parameter count × bytes-per-weight) and is flagged `estimated`:

```
kvBytes      = (kvBytesPerToken[dtype] * spec.kvRatio + spec.kvExtraPerToken) * pageRoundUp64(ctx)
overhead     = spec.seqFixedBytes + spec.seqPerToken * ctx
weights      = weightsBytes + (spec.weightsGiB - base.weightsGiB) * GiB
workspace    = workspaceBytes(ctx) + graphBytes(spec, ctx)
total        = weights + kvBytes + overhead + workspace
usable       = (vramGiB * 1024 - reserveMiB) * MiB
headroom     = usable - total
```

Verdict: `not-measured` (no `VramModel`), `over` (`headroom < 0`), `tight`
(`headroom < 0.5 GiB`), else `fits`. `largestFittingContext` is solved iteratively (the
graph-allowance step function is re-evaluated at each candidate) and capped at
`nativeMaxContext`. The UI renders the breakdown as a to-scale segmented bar (weights / KV /
overhead / workspace / free / OS-reserve) plus the verdict and the largest-fitting-context
readout.

### 3.5 `GuidelineEngine` (red hardware warnings)

A rule engine over the same declarations. A **guideline** is a named rule that inspects a
parameter value *or* the presence of a parameter and returns a severity. This directly serves the
requirement to warn "when parameter values **or parameters themselves**" are a problem.

```ts
type Guideline = {
  id: string
  when: (config: Config, hw: HardwareProfile, spec?: ParameterSpec) => boolean
  level: 'info' | 'warn' | 'error'        // error → red
  message: string                          // human-readable, names the fix
  // optional: which parameter(s) the warning anchors to, for inline placement in the form
  anchors?: string[]
}
```

Guidelines come from three sources, all composable:

1. **Built-in hardware rules** — e.g. "nvfp4 KV needs sm ≥ 89", "dflash2 spec needs the draft
   companion weights in the artifact", "max-context × kvBytesPerToken exceeds usable VRAM"
   (reuses the estimator), "host-kv-mib + host-state-slots exceed host RAM", "docker selected
   but not installed".
2. **Per-parameter `hardwareConstraint`** on the `ParameterSpec` (value-level).
3. **Per-engine/model overrides** (a subclass adds rules for its own surface).

The engine returns `GuidelineResult[]`; the UI renders `error` rules as red inline warnings next
to the anchored parameter and as a summary banner.

### 3.6 `DefaultsResolver` (sane defaults, mod-search sourced)

Resolves a starting `Config` for `(engineId, modelId, hardwareClass)`.

- **Built-in presets** ship as data: the NInfer measured constants from `config-calculator.html`
  (per model × KV format × spec mode × 24 GiB card) plus the Hyper-Qwen `.env` profiles
  (single-user speed-first, long-context, huge-context). These are the offline floor.
- **Externally-sourced presets** are populated **through the mod-search skill**: the plugin
  invokes the mod-search bridge (web search / page fetch) to pull current, authoritative defaults
  (e.g. NInfer's documented device-profile recommendations, KV-format tradeoff tables, the
  engine's README) and stores them as presets, each tagged with its source URL and a fetch date.
  A preset is only trusted for the exact `(engine, model, hardware-class)` it was sourced for.

Resolution order: explicit user value → engine/model preset for the detected hardware class →
built-in preset → `ParameterSpec.defaultValue`. The resolver reports which source supplied each
value, so the UI can show "sourced from NInfer docs (fetched 2026-10-13)".

### 3.7 NInfer parameter surface (concrete `ParameterSpec`s, first-class example)

From `serving.md`, `cli.md`, and the launcher script. Representative entries (the full list is
data, not code):

| key                            | form                                              | description (behavior-first)                                                                     | vram / constraint                                                   |
|--------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| `kvDtype`                      | enum (bf16, int8, fp8, rk8v4, rk4v4, k8v4, nvfp4) | "How the KV cache is quantized. Smaller formats fit a longer context but cost a little quality." | `vramContribution` (kvBytesPerToken); constraint: nvfp4 needs sm≥89 |
| `maxContext`                   | number (256…nativeMax)                            | "Longest conversation the engine will accept. Larger means more VRAM for the KV cache."          | drives `kvBytes`; estimator caps it                                 |
| `kvCapacity`                   | number                                            | "Shared KV pool across concurrent requests. Leave auto to size from max-context."                | affects admission, not resident total                               |
| `maxConcurrency`               | number (1..8)                                     | "How many requests decode at once. More lanes share the KV pool."                                | guideline: lanes × context must fit                                 |
| `spec`                         | enum (none, mtp, dflash, dflash2)                 | "Speculative-decoding backend. Speeds decode when drafts are accepted."                          | `speculation` terms; dflash2 needs draft weights                    |
| `draftTokens`                  | number (1..15)                                    | "How many draft tokens a speculative round verifies."                                            | gated on `spec`                                                     |
| `lmHeadDraft`                  | boolean                                           | "Draft from the small proposal head instead of the full output head."                            | requires `spec`                                                     |
| `temperature`                  | number (0..2)                                     | "Sampling randomness. 0 is deterministic."                                                       | none                                                                |
| `minP`                         | number (0..1)                                     | "Drop tokens whose probability is under this fraction of the top token."                         | none                                                                |
| `prefillChunk`                 | number                                            | "Prompt-chunk size for prefill; the engine tunes it to the GPU."                                 | device-tuned                                                        |
| `gdnStateFp16`                 | boolean                                           | "Keep the recurrent state in FP16 to save memory."                                               | reduces state bytes                                                 |
| `hostKvMib` / `hostStateSlots` | number                                            | "Pinned host RAM for the host KV tier / state tier."                                             | host-RAM guideline                                                  |
| `vision`                       | boolean                                           | "Accept image/video input. Adds the vision tower to resident memory."                            | adds workspace                                                      |
| `structuredOutput`             | boolean                                           | "Constrain the final answer with a JSON grammar."                                                | per-lane mask plane                                                 |
| `deviceProfile`                | enum (auto, calibrate, off)                       | "Which kernel schedule to use; auto calibrates once on an unknown GPU."                          | none                                                                |
| `chatTemplate`                 | path                                              | "Jinja chat template to override the artifact's built-in one."                                   | none                                                                |

Hyper-Qwen's surface maps the same concepts onto env keys (`SPEC`, `DFLASH_TOKENS`, `CTX`, `KV`,
`GPU_UTIL`, `MAX_LEN`, `MAX_SEQS`, `VISION`, `VLLM_WSL2_ENABLE_PIN_MEMORY`, ...). The point of the
design: the *concept* (speculation, KV format, context) is shared; the *spelling* (flag vs. env
key) lives in the adapter's `toArgv`/`toEnv`.

### 3.8 `DshModelRegistrar` (deep DSH integration)

After `healthCheck` returns healthy, the registrar writes the engine into DSH as a model by
patching the active profile's `@deepseek-ai/dsh-llm-pi-ai` provider config (the exact shape in
`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      <engine>-local:
        apiKeyEnv: <ENGINE>_LOCAL_API_KEY     # optional
        api: openai-completions
        baseURL: http://127.0.0.1:<port>/v1
        models:
          - id: <modelId>
            name: <displayName>
            contextWindow: <maxContext>
```

and, when the user opts in, an `agent-default-model` entry pointing at it. The write goes
through the DSH **settings service** (the same seam `dsh-api-settings-controller` exposes to the
Web UI) so the change is revision-tracked and undoable, rather than hand-editing the YAML. The
registrar is idempotent: re-running with the same engine/model updates in place; stopping the
engine can optionally remove the entry.

### 3.9 `SystemDepProvisioner` (OS system-level dependencies)

A local build or a docker engine needs host-level dependencies the plugin does not own: the
package-manager tools, the CUDA toolkit, the NVIDIA Container Toolkit, the Hugging Face CLI.
Today a user copies the shell notes at the top of `inference-launcher/qwen-ninfer` (the Ubuntu
`apt`/CUDA-keyring lines and the Arch `pacman` lines) and runs them by hand. This layer makes
that a first-class, OS-aware, copy-paste-or-one-click step that gates the "Get" button.

A `SystemDep` declares one host dependency:

```ts
interface SystemDep {
  id: string                          // "docker" | "nvidia-container-toolkit" | "cmake" | "cuda-toolkit" | "hf-cli" | ...
  purpose: string                    // "runs the engine in a container", "compiles the local engine"
  requiresSudo: boolean
  detect?: (hw: HardwareProfile) => Promise<boolean>  // already installed? (which/version probe)
  install: Record<string, readonly string[]>  // per package-manager command lines
  envAfter?: Record<string, string>    // env to export post-install (CUDACXX, TORCH_CUDA_ARCH_LIST)
}
```

`install` is keyed by the detected package manager (`apt`, `dnf`, `pacman`, `brew`), so the same
dep renders the right commands for the user's OS. The provisioner composes them:

```ts
interface SystemDepProvisioner {
  planDeps(engine: EngineAdapter, buildMode: 'docker' | 'local', hw: HardwareProfile): SystemDep[]
  checkDeps(deps: SystemDep[], hw: HardwareProfile): Promise<DepStatus[]>        // per-dep satisfied?
  renderInstallString(deps: SystemDep[], hw: HardwareProfile): string           // the copy/paste block
  runInstall(deps: SystemDep[], hw: HardwareProfile): Promise<InstallResult>    // the Play/Run path
}
```

- **`planDeps`** is the relationship edge: it maps (engine, build mode, hardware) → the required
  host deps. A local NInfer build needs `cmake`, `ninja`, the ffmpeg dev libs, `curl`, and the
  CUDA toolkit; a docker engine needs `docker` + `nvidia-container-toolkit`; a model download needs
  the `hf` CLI. A docker build skips the compile toolchain entirely.
- **`renderInstallString`** emits the exact copy/paste block for the user's detected
  OS/package manager, mirroring the `qwen-ninfer` header:
  `sudo apt install cmake ninja-build ...` + the CUDA-keyring `wget`/`dpkg`/`apt` lines and the
  `export CUDACXX=...` on Debian/Ubuntu, and `sudo pacman -S --noconfirm cmake ninja pkgconf
  ffmpeg curl cuda` + the `export` lines on Arch. The user copies it into a terminal.
- **`runInstall`** is the "Play/Run" arrow. It runs each command in order, prompts for the sudo
  password (the add-on runs it as a child process and surfaces the prompt; the user enters their
  password only if they trust the add-on), then re-runs `checkDeps` to confirm. Each dep reports
  `satisfied | missing | installing | failed`.
- **`checkDeps`** drives the UI gate: the **"Get" button stays disabled** until every required dep
  reports `satisfied`. The panel lists each missing dep with its purpose, a copy/paste install
  string, and a Play/Run arrow. Once green, "Get" enables and the engine `deploy` (Phase 4) may
  proceed.

The detection probes are the same kind of heuristics as the hardware detector (§3.2): `which
docker`, `nvcc --version`, `hf --version`, `cmake --version`. An unknown state degrades to
"missing" so the user can still copy/paste and re-check.

---

## 4. The logical relationships (the heart of the design)

The plugin's value is a graph of pure, testable relationships. Each edge is a function that can
be unit-tested in isolation, and the whole is wired together by the Cordis service layer (§5).

```
 ParameterSpec ──vramContribution──▶ VramEstimator ──breakdown+verdict──▶ VRAM meter (UI)
        │
        ├─hardwareConstraint──────▶ GuidelineEngine ──red warnings────▶ warnings (UI)
        │
        └─toArgv / toEnv──────────▶ EngineAdapter.renderLaunch ──▶ LaunchPlan
                                                                            │
 HardwareProfile ──vramGiB, sm, docker, wsl2, os, pkgMgr──┐                              ▼
        │                                     │                       deploy() → healthCheck()
        ├─────────────────────────────────────┤                              │ healthy
        ├─hardwareClass────────▶ DefaultsResolver ──preset────────▶ Config
        └─os, pkgMgr────────▶ SystemDepProvisioner ──install string / Play-Run / gate
                                                          └────────▶ DshModelRegistrar ──▶ DSH model
```

- **Parameter → VRAM.** Every parameter that affects memory declares a `vramContribution`. The
  estimator sums them. Change a value and the meter moves; the largest-fitting-context readout
  moves with it.
- **Parameter → hardware capability.** Every parameter that the hardware can reject declares a
  `hardwareConstraint` against the `HardwareProfile`. The guideline engine turns failures into
  red warnings.
- **Parameter presence → hardware.** Some warnings are about a parameter *existing* (e.g.
  `vision` on a card that cannot hold the tower), handled by `Guideline.when` inspecting the
  spec, not the value.
- **Hardware → defaults.** The detected hardware class selects a `DefaultsResolver` preset, so a
  user on an RTX 3090 gets 3090-tuned defaults, not a generic guess.
- **Engine + params → endpoint → DSH model.** The adapter produces the launch plan and health
  URL; on a healthy check the registrar publishes the model.
- **Engine + build mode + OS → host dependencies.** The provisioner maps (engine, build mode,
  detected OS/package manager) to the required host deps, renders a copy/paste install string,
  and gates the "Get" button on them being satisfied. A docker build needs only the container
  runtime; a local build needs the compile toolchain and CUDA toolkit.

The invariant the whole design protects: **no relationship lives in a single place.** The VRAM
number the meter shows, the red warning, the DSH `contextWindow`, and the dependency gate all
derive from the same `ParameterSpec` / `EngineAdapter` / `HardwareProfile` declarations, so they
cannot disagree.

---

## 5. Cordis plugin architecture

Five packages under `packages/*`, plus the installable bundle.

| Package              | Role                                                                                                                                                                                                                                                                                                                                                                          |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `packages/core`      | The domain model: `ParameterSpec`, `HardwareProfile`, `EngineAdapter`, `VramEstimator`, `GuidelineEngine`, `DefaultsResolver`, `DshModelRegistrar`, `SystemDepProvisioner`. Pure, framework-free, 100% unit-testable. This is where the §3 types live.                                                                                                                        |
| `packages/service`   | The `ctx.localInfer` Cordis service: publishes the registries (engines, models, hardware detector, defaults, registrar) and the orchestration entry points (`estimate`, `guidelines`, `launch`, `registerModel`). Carries no store of its own. Mirrors `codegraph`'s `Service` + `declare module` pattern.                                                                    |
| `packages/providers` | Concrete adapters and data: `ninfer`, `hyperqwen`, `llamacpp`, `strata` adapters; the NInfer `VramModel` (from the measured calculator); the built-in presets; the built-in guidelines; the per-OS `SystemDep` install command data (apt / dnf / pacman / brew). Each registers itself with `ctx.localInfer`.                                                                 |
| `packages/tool`      | Model-facing tools (the agent can drive the engine itself): `local_infer_estimate`, `local_infer_launch`, `local_infer_status`, `local_infer_register`. Registered via `ctx.tools.register(defineTool(...))` with `InferArgs`/`InferValue` schemas, each with its own `timeoutMs` (launch is long, estimate is fast — the codegraph "separate tools, separate budgets" rule). |
| `packages/ui`        | The Web UI: the parameter form (form-type aware), the VRAM meter, the red-warning banner, the engine lifecycle controls (build / deploy / stop), and the "register as model" confirmation. Injects `tools`, `localInfer`, `fs`, `systemPrompt`, and the settings seam.                                                                                                        |
| `packages/bundle`    | The installable meta-package: no source, just `cordis.patch.yml` wiring the other five into one profile layer, and `package.json` with `dsh.bundle.patch`.                                                                                                                                                                                                                    |

`cordis.patch.yml` (bundle) inserts, in order:

```yaml
- insert:
  - id: local-infer-service
    name: '@<scope>/dsh-plugin-local-infer-service'
  - id: local-infer-providers
    name: '@<scope>/dsh-plugin-local-infer-providers'
  - id: local-infer-tool
    name: '@<scope>/dsh-plugin-local-infer-tool'
  - id: local-infer-ui
    name: '@<scope>/dsh-plugin-local-infer-ui'
```

**Key service shape** (mirrors `ctx.codegraph`): `ctx.localInfer` exposes `registerEngine`,
`registerPreset`, `registerGuideline`, `estimate(config, hw)`, `guidelines(config, hw)`,
`deps(engine, buildMode, hw)`, `installString(engine, buildMode, hw)`, `runInstall(engine,
buildMode, hw)`, `launch(plan)`, `registerModel(plan)`. Provider selection follows the codegraph
"exactly one claimant" rule: a model is served by the one engine that claims it; zero or several
claimants fail loudly.

**Config** (schemastery `z`, like codegraph's `Config`): caps and budgets, e.g.
`maxConcurrentEngines`, `healthPollMs`, `healthMaxAttempts`, `reserveGiB`, `defaultsSource:
'builtin' | 'modsearch'`, `autoRegister: boolean`, `allowRunDeps: boolean` (gates the Play/Run
arrow), `sudoPrompt: 'terminal' | 'inline'`.

---

## 6. Feature requirements → design mapping

| Required feature                                                          | Where it lives                                                                                                                                                         |
|---------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **VRAM Est. display meter** (live as the user adjusts params)             | `VramEstimator` (§3.4) → `packages/ui` segmented bar + verdict + largest-fitting-context. Re-renders on every parameter change.                                        |
| **Human-readable, behavior-first descriptions**                           | `ParameterSpec.description` (§3.1), enforced by a lint rule that flags "is"-style descriptions. Shown under each form field.                                           |
| **Modular, inheritance-focused design**                                   | `core` abstractions + `EngineAdapter`/`ParameterSpec`/`VramModel` inheritance (§3); adding a model = a `VramModel` + a preset; adding an engine = an adapter subclass. |
| **Docker and locally-built engines (incl. NInfer)**                       | `EngineAdapter.supports` + `renderLaunch` producing `process` / `docker` / `compose` plans (§3.3); NInfer is the both-capable reference.                               |
| **OS system-level dependencies (copy/paste or one-click install)**        | `SystemDepProvisioner` (§3.9): per-OS/package-manager install string + Play/Run (sudo) + a gate that keeps "Get" disabled until deps are satisfied.                    |
| **Hardware-aware guidelines with red warnings (value *and* parameter)**   | `GuidelineEngine` + per-spec `hardwareConstraint` + built-in rules (§3.5); `error` level renders red, inline to the anchored parameter.                                |
| **Form-type awareness (checkbox / dropdown / …)**                         | `ParameterSpec.form` (§3.1); `packages/ui` switches on `form.kind`.                                                                                                    |
| **Deep DSH integration (auto-add as model when confirmed working)**       | `DshModelRegistrar` (§3.8) triggered by a passing `healthCheck`; writes the `dsh-llm-pi-ai` provider via the settings seam.                                            |
| **Sane defaults for common platform/hardware combos, mod-search sourced** | `DefaultsResolver` (§3.6): built-in measured presets + mod-search-sourced presets keyed by hardware class.                                                             |

---

## 7. Development process (phases)

Each phase establishes one relationship from §4, ships a working slice, and is gated by tests.
A phase is done when its exit criteria are met and its tests pass (`tsc -b` clean, `vitest run`
green, `npx eslint` clean).

### Phase 0 — Scaffold
- pnpm workspace; `packages/{core,service,providers,tool,ui,bundle}`; `tsc -b` project
  references; vitest + `vite-tsconfig-paths`; eslint; `cordis.patch.yml` + bundle `package.json`.
- **Exit.** Empty plugin loads into a DSH profile with no errors (mirror codegraph's
  `new Context(); await ctx.plugin(...)` smoke test).

### Phase 1 — Parameter model + form rendering
- `ParameterSpec`, `form` union, `EnumOption`; the NInfer + Hyper-Qwen `ParameterSpec` data.
- `packages/ui` form renderer: checkbox / dropdown / slider / text / picker, grouped by
  `group`, each field with its `description`.
- **Relationship established:** parameter → form + description.
- **Exit.** A NInfer parameter form renders with correct control types and behavior-first
  descriptions; a lint rule rejects "is"-style descriptions.

### Phase 2 — Hardware profile + VRAM estimator
- `HardwareProfile` + detection service (nvidia-smi / docker / WSL2 probe).
- `VramModel` (NInfer measured constants ported from `config-calculator.html`) + `VramEstimator`
  (breakdown, verdict, largest-fitting-context solver, page rounding).
- **Relationship established:** parameter → VRAM; hardware → usable budget.
- **Exit.** Estimator output matches the NInfer calculator's pinned cases (27B/35B across
  KV × spec × context) to the byte; the meter re-renders live on parameter change.

### Phase 3 — Guideline engine (red warnings)
- `GuidelineEngine`, built-in hardware rules, per-spec `hardwareConstraint` wiring.
- **Relationship established:** parameter (value *and* presence) → hardware capability → red warning.
- **Exit.** Each built-in rule has a test that fires it and asserts the red rendering and the
  anchored message; the estimator-backed "exceeds VRAM" rule agrees with Phase 2.

### Phase 4 — System dependency provisioning
- `SystemDep` + `SystemDepProvisioner` (§3.9): `planDeps`, `checkDeps`, `renderInstallString`,
  `runInstall`. Per-OS/package-manager install data for the NInfer local toolchain (the
  `qwen-ninfer` header: `apt`/CUDA-keyring on Debian/Ubuntu, `pacman` on Arch) and the docker
  runtime (docker + NVIDIA Container Toolkit) and the `hf` CLI.
- `packages/ui`: a "System dependencies" panel listing each missing dep with its purpose, a
  copy/paste install string, and a Play/Run arrow (sudo prompt when `allowRunDeps`); the "Get"
  button stays disabled until `checkDeps` is all-satisfied.
- **Relationship established:** engine + build mode + OS → host deps → install string / gate.
- **Exit.** On a clean box, the panel names the missing deps, the copy/paste block matches the
  `qwen-ninfer` notes for the detected OS, Play/Run installs them (sudo prompt), and "Get" enables
  only after re-check passes.

### Phase 5 — Engine adapters + lifecycle (docker + local)
- `EngineAdapter` base; `NInferAdapter` (docker `ghcr.io/.../ninfer serve` **and** local
  cmake → `ninfer-serve`); `HyperQwenAdapter` (compose profiles). `renderLaunch`, `deploy`,
  `healthCheck` (poll `/health` until 200, mirroring `qwen-ninfer`), `stop`.
- **Relationship established:** engine + params → launch plan → deploy → health.
- **Exit.** On a machine with NInfer, the plugin builds-or-pulls, downloads the model, starts the
  engine, and reports healthy; same for the docker path. NInfer exercises *both* paths.

### Phase 6 — DSH model registration
- `DshModelRegistrar`: on a passing health check, upsert the `dsh-llm-pi-ai` provider + model
  (and optional `agent-default-model`) through the settings seam; idempotent; removable on stop.
- **Relationship established:** confirmed-working engine → DSH model.
- **Exit.** After a successful launch, the model appears in DSH's model list and a chat turn
  routes to it; re-running does not duplicate the entry.

### Phase 7 — Defaults layer (mod-search sourced)
- `DefaultsResolver`: built-in presets (NInfer measured, Hyper-Qwen profiles) + a mod-search
  fetch path that stores externally-sourced presets tagged with source + date; resolution order
  with per-value provenance.
- **Relationship established:** hardware class → sane defaults.
- **Exit.** A fresh NInfer config on a detected 3090 starts from the 3090 preset; a
  mod-search-sourced preset is shown with its source and only applies to its exact hardware class.

### Phase 8 — UI polish + model-facing tools
- Wire the meter, warnings, lifecycle controls, and register confirmation into one panel.
- `packages/tool`: `local_infer_estimate`, `local_infer_launch`, `local_infer_status`,
  `local_infer_register` (separate timeout budgets), plus a `systemPrompt` section telling the
  agent when to use them.
- **Exit.** An agent can estimate, launch, and register a local engine end-to-end using the
  tools alone.

### Phase 9 — Additional engines + hardening
- `LlamaCppAdapter`, `StrataAdapter` (thin subclasses over the same `ParameterSpec` concepts).
- Test hardening (coverage thresholds like codegraph), docs, `AGENTS.md` updates.
- **Exit.** A new engine is added by one adapter + its parameter data, with zero changes to
  `core`/`service`.

---

## 8. Testing strategy

- **Unit (per relationship).** Every `vramContribution`, `hardwareConstraint`, guideline, and
  the estimator are pure functions: table-driven tests over the NInfer calculator's pinned cases
  (27B/35B × 7 KV formats × spec modes × context lengths) and the guideline rule matrix.
- **Service.** Spin a real `@deepseek-ai/cordis` `Context`, `ctx.plugin(LocalInfer)`, register
  stub engines/adapters, assert on `ctx.localInfer` (codegraph's `codegraph.spec.ts` pattern).
- **Adapter integration.** On a host with the engine present: build-or-pull, deploy, poll
  `/health`, assert the DSH provider entry is written and a chat turn succeeds.
- **Form rendering.** Snapshot tests asserting control type per `form.kind` and the description
  string under each field.
- **Dependency provisioning.** For each (engine, build mode, OS/package manager) combination,
  assert `planDeps` names the right deps, `renderInstallString` matches the expected `apt`/`pacman`
  block (diffed against the `qwen-ninfer` notes), `checkDeps` reflects a stubbed `which`/`--version`
  probe, and the "Get" gate is disabled until all deps report satisfied. `runInstall` is tested
  with a stubbed command runner (no real sudo in CI).
- **Regression guard for the VRAM math.** Port the NInfer `config-calculator.render.test.mjs`
  approach: run the estimator across the full combination grid and assert nothing throws and the
  largest-fitting-context responds to the spec mode.

---

## 9. Risks and open questions

- **VRAM constants are engine/model-specific.** Only NInfer has a measured `VramModel`. Other
  engines start `estimated` (model-card derived) and improve as presets are added. The UI must
  label `estimated` vs `measured` so a number is never read as authoritative.
- **Settings-seam write path.** The exact DSH API to upsert a `dsh-llm-pi-ai` provider at runtime
  must be confirmed against the current `dsh-api-settings-controller` / `dsh-settings` surface
  (the profile's `cordis.patch.yml` shows the target shape, not the write API). Fallback: emit the
  patch and let the user apply it.
- **Hardware detection fidelity.** `nvidia-smi` parsing and SM-arch gating are heuristics; a
  wrong `sm` silently enables a KV format the card cannot run. Mitigate by defaulting unknown
  archs to the conservative set and surfacing the detected profile in the UI.
- **mod-search availability.** The defaults-fetch path needs network + the modsearch bridge. It
  must degrade to built-in presets (and say so) when the bridge is unavailable.
- **Running host install commands.** Play/Run executes package-manager commands (often as root
  via sudo). The add-on must show the exact command list before running, gate it behind an explicit
  trust (`allowRunDeps`), capture per-command exit codes, and never run a command the user did not
  see. The copy/paste path is always available as the no-trust fallback. WSL2 and non-Debian/Arch
  distros (dnf, brew) need their own command sets and are flagged when untested.
- **Engine breadth.** llama.cpp and Strata are not present locally; their adapters are
  specified, not verified, until the binaries are available.

---

## 10. Suggested file layout

```
src/dsh-plugin-local-infer/
  PLAN.md                      # this file
  AGENTS.md
  package.json                 # bundle meta-package (dsh.bundle.patch)
  cordis.patch.yml
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    core/        # §3 domain model (pure)
    service/     # ctx.localInfer
    providers/   # ninfer, hyperqwen, llamacpp, strata adapters + presets + guidelines
    tool/        # model-facing tools
    ui/          # form, VRAM meter, warnings, lifecycle
    bundle/      # installable patch layer
```

---

## Status

### Phase 0 — Scaffold (complete)

- **Workspace.** pnpm workspace over `packages/{core,service,providers,tool,ui,bundle}`. Root `package.json` is the installable bundle (`dsh.bundle.patch` → `./cordis.patch.yml`, deps on the four TS packages). Added `pnpm-workspace.yaml`, `tsconfig.base.json` (paths facade for vite-tsconfig-paths), root `tsconfig.json` (project references), `vitest.config.ts`, and `eslint.config.mjs` (underscore-arg ignore). `mise.toml` pins pnpm 12.11.2; TypeScript aligned to 5.9 to satisfy `typescript-eslint`.
- **`core`.** Pure, framework-free §3 domain model: `ParameterSpec` + the closed `form` union, `HardwareProfile`, `VramModel`/`VramBreakdown`/`VramVerdict`/`SpeculationTerms`, the `EngineAdapter` abstract base (`LaunchPlan`/`HealthResult`/`DeployResult`), `Guideline`/`GuidelineResult`, `Preset`/`DefaultsResolver`, `DshModelRegistrar`, and `SystemDep`/`SystemDepProvisioner`.
- **`service`.** `ctx.localInfer` (`LocalInfer` `Service` + `declare module`): engine/preset/guideline registries (order-independent, duplicate-id conflict, `ctx.effect`-based disposers) plus the orchestration entry points (`estimate`, `guidelines`, `deps`, `installString`, `runInstall`, `launch`, `registerModel`), which fail loudly with `LOCAL_INFER_NOT_IMPLEMENTED` until Phases 2–8 fill them in.
- **`providers` / `tool` / `ui`.** No-op object-plugin placeholders that `inject` `localInfer` so the bundle loads empty; the registration bodies land in Phases 5/7/8.
- **`bundle`.** No-source meta-package carrying `cordis.patch.yml` (four insert rows) and `dsh.bundle.patch`.
- **Gates green.** `tsc -b` clean; `vitest run` 18/18 across 6 files, including the Phase 0 exit smoke test (`new Context(); ctx.plugin(...)` for the service alone and for all four bundle rows together); `npx eslint` clean.

### Phase 1 — Parameter model + form rendering (complete)

- **`providers`: NInfer + Hyper-Qwen `ParameterSpec` data.** `packages/providers/src/ninfer.ts` carries the 17-spec NInfer surface from `serving.md`/`cli.md` and the `qwen-ninfer` launcher (`kvDtype`, `maxContext`, `kvCapacity`, `hostKvMib`, `hostStateSlots`, `gdnStateFp16`, `maxConcurrency`, `spec`, `draftTokens`, `lmHeadDraft`, `temperature`, `minP`, `prefillChunk`, `vision`, `structuredOutput`, `deviceProfile`, `chatTemplate`), each with its `form` kind, behavior-first `description`, `group`, and the `toArgv` spelling the launcher passes. `kvDtype` declares the value-level `hardwareConstraint` (nvfp4 needs SM 89), and `draftTokens`/`lmHeadDraft` declare `requires` gating on `spec`. `packages/providers/src/hyperqwen.ts` maps the same concepts onto the `.env` keys (`SPEC`, `DFLASH_TOKENS`, `CTX`, `KV`, `GPU_UTIL`, `MAX_LEN`, `MAX_SEQS`, `VISION`, `VLLM_WSL2_ENABLE_PIN_MEMORY`, `PREFIX_CACHE`, `VLLM_API_KEY`, `PORT`) via `toEnv`, sourced from `.env.example`, `docker-compose.yml`, and the start scripts. Both surfaces re-export from the providers index for the UI renderer and the Phase 5 adapters.
- **`ui`: form-type-aware renderer.** `packages/ui/src/form.ts` maps the closed `form` union to the five control kinds (checkbox / dropdown / slider+number / text / picker) via an exhaustive `controlFor` switch, and `renderForm` builds the grouped render model: sections in first-appearance `group` order (ungrouped specs under `General`), fields in spec order, the `description` under every field, config values over spec defaults, and `requires` failures rendered as a disabled field with its message. The model is pure data; the panel that draws it lands in Phase 8.
- **Lint gate.** `eslint.config.mjs` gains the `local-infer/behavior-first-description` rule: a `description` string that opens is-style ("is …", "It is …", "This is …", "are/was/were") is an error, so "is"-style descriptions cannot merge.
- **Relationship established.** parameter → form + description.
- **Gates green.** `tsc -b` clean; `vitest run` 38/38 across 9 files (the NInfer/Hyper-Qwen data suites assert the key lists, control kinds, flag/env spellings, the SM-89 constraint, and the spec gating; the form suite asserts the control mapping, grouping, description placement, and the disabled-gate behavior); `npx eslint` clean, with the rule verified to fire on a planted is-style description.
