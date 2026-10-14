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
  number inputs, strings as text, and known-options fields (the chat template) as a dropdown +
  free-text combo.
- A hardware-aware guideline engine that raises red warnings on parameter values and on the
  presence of parameters the hardware cannot support.
- Engine adapters for both **docker** and **locally-built** engines, including tools like
  NInfer that support both.
- OS system-level dependency provisioning: a per-OS/package-manager install string the user can
  copy/paste, or a Play/Run (sudo) one-click, that gates the "Get" button until the host deps
  (docker, CUDA toolkit, ffmpeg, HF CLI, ...) are satisfied.
- Deep DSH integration: a confirmed-working engine is added as a DSH model automatically.
- Directory and repo fields that drive deploy: a global Model Directory picker, and
  per-engine Engine Directory and Engine Fork (Git Repo) fields (§3.10).
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
    | { kind: 'combo'; options: ComboOption[] } // → dropdown + free-text combo
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
"rk4v4: the context choice, 31% smaller than rk8v4"). `ComboOption` carries `value`, `label`,
and an optional `source` tag ('engine' | 'popular' | 'added') so the dropdown can group and
order its entries. `ConstraintResult` is
`{ ok: true } | { ok: false; severity: 'warn' | 'error'; message: string }`.

The **form-type awareness** requirement is satisfied entirely by `form`: the renderer switches
on `form.kind` (checkbox / dropdown / slider / text / picker / combo). The **human-readable description**
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
| `chatTemplate`                 | combo (engine templates + popular, e.g. Froggeric22) | "Jinja chat template to override the artifact's built-in one. Pick a known template from the dropdown or type a custom path." | none |

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

### 3.10 Engine platform config and directory fields

Three path/repo fields sit around the engine surface: one is global to the plugin, two belong
to the engine platform config (the config the user adds for a specific engine, e.g. NInfer),
and the chat template field (§3.7) becomes a combo control.

| Field              | Scope                  | Control            | Purpose                                                                  | Example                                |
|--------------------|------------------------|--------------------|--------------------------------------------------------------------------|----------------------------------------|
| `modelDirectory`   | plugin global (`Config`) | DSH directory picker | Where models are downloaded (the `hf` CLI target directory, §3.9).       | `/home/derek/src/hf-models`            |
| `engineDirectory`  | engine platform config | DSH directory picker | Where the engine platform lives locally (checkout / build location).    | `/home/derek/src/ninfer`               |
| `engineFork`       | engine platform config | text field         | The git repo that overrides the engine platform fork for this config.    | `https://github.com/iamwavecut/ninfer-all` |

```ts
interface EnginePlatformConfig {
  engineId: string            // which adapter, e.g. "ninfer"
  engineDirectory?: string    // "Engine Directory": local location of the engine platform
  engineFork?: string         // "Engine Fork (Git Repo)": git repo that overrides the default upstream
}
```

The global `Config` (§5) carries `modelDirectory` as the "Model Directory" directory picker,
and `EnginePlatformConfig` is validated by the same schemastery `z` schema. The deploy step
(§3.3 `deploy`) consumes both:

- **`engineFork`.** When set, `deploy` clones that repo (instead of the engine's default
  upstream) for this config. When unset, the adapter's default source is used.
- **`engineDirectory`.** When set, `deploy` uses it as the checkout/build location (clone,
  build, or pull into it). When unset, the adapter picks a default (a managed cache dir).
- **`modelDirectory`.** The model download step (the `hf` CLI in §3.9) targets this directory,
  and the `LaunchPlan` references the model by its path under it.

**Chat template combo.** The `chatTemplate` spec switches from a bare `path` picker to the
`combo` form kind (§3.1): a dropdown + free-text control. The dropdown is populated, in
order, with (1) templates the engine provides (the artifact's built-in chat templates,
surfaced by the adapter), (2) popular templates the plugin ships as data (Froggeric22 from
`https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates`), and (3) templates the user has
previously added, persisted with the plugin state so they can be re-selected without
retyping. The free-text field accepts any value (a local path or an HF repo reference), and a
typed value is promoted into the previously-added list on save.

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
`registerPreset`, `registerGuideline`, `registerEnginePlatformConfig(config)`,
`estimate(config, hw)`, `guidelines(config, hw)`, `deps(engine, buildMode, hw)`,
`installString(engine, buildMode, hw)`, `runInstall(engine, buildMode, hw)`, `launch(plan)`,
`registerModel(plan)`. `registerEnginePlatformConfig` stores the per-engine
`EnginePlatformConfig` (§3.10); `launch` resolves it against the global `modelDirectory` to
produce the clone/build/download plan. Provider selection follows the codegraph
"exactly one claimant" rule: a model is served by the one engine that claims it; zero or several
claimants fail loudly.

**Config** (schemastery `z`, like codegraph's `Config`): caps and budgets, e.g.
`maxConcurrentEngines`, `healthPollMs`, `healthMaxAttempts`, `reserveGiB`, `modelDirectory:
string` (the "Model Directory" DSH directory picker, §3.10), `defaultsSource:
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
| **Model Directory** (global DSH directory picker for the model download dir) | `Config.modelDirectory` (§3.10, §5); the model download step in `deploy` (§3.3) targets it.                                                                              |
| **Engine Directory + Engine Fork (Git Repo)** (per engine platform config) | `EnginePlatformConfig` (§3.10); `deploy` clones the fork (or the default upstream) into the engine directory.                                                          |
| **Chat template dropdown + free-text combo** (engine templates, popular templates like Froggeric22, previously added) | `combo` form kind (§3.1) + the template option sources (§3.10); `packages/ui` renders the dropdown + free-text control.         |

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
- `packages/ui` form renderer: checkbox / dropdown / slider / text / picker / combo
  (dropdown + free text), grouped by `group`, each field with its `description`. The combo
  control serves the `chatTemplate` spec: the dropdown lists engine-provided templates, the
  popular templates shipped as data (Froggeric22 from
  `https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates`), and previously added
  templates (persisted), and the free-text field accepts a custom path or HF repo reference.
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
- Engine platform config (§3.10): `registerEnginePlatformConfig` stores the Engine Directory
  and Engine Fork (Git Repo) for the config; `deploy` clones the fork (or the default
  upstream) into the engine directory and downloads the model into the global
  `modelDirectory` (the Model Directory picker).
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

### Phase 2 — Hardware profile + VRAM estimator (complete)

- **`core`: `VramEstimator`.** `packages/core/src/estimator.ts` implements `estimateVram(model, config, hw, specs?)` as a pure function of (`VramModel`, `Config`, `HardwareProfile`), mirroring the NInfer `config-calculator.html` arithmetic to the byte: the KV cache prices its 64-token page (`pageRoundUp`), the sequence state adds its fixed block plus per-token remainder, the weights gain the speculation mode's draft companion weights, and the workspace gains the mode's CUDA-graph allowance (a step function for DFlash2). `VramModel` gains an `id` (the service registry key) and an optional `specKey` mapper that resolves the engine's spec config values onto the measured speculation entries. The verdict is `fits` / `tight` (headroom under 0.5 GiB) / `over` / `not-measured` (no model, an unmeasured KV format, or an unmeasured spec mode, each named in the detail), and `largestFittingContext` is solved iteratively against the candidate's own fixed bytes so a context that crosses a graph-allowance step is priced at the deeper allowance, capped at `nativeMaxContext`. Optional `ParameterSpec.vramContribution` values sum into the same buckets, so the meter segments and the verdict stay one accounting.
- **`core`: hardware detection.** `packages/core/src/hardware.ts` adds `parseNvidiaSmiGpu` (the `nvidia-smi --query-gpu=name,memory.total,compute_cap` CSV line to a `GpuProbe`) and `detectHardware(probes)`, a pure probe-to-`HardwareProfile` mapping (SM = compute-capability × 10, an unknown capability degrading to the conservative 0). The probes stay the service's job; the mapping is unit-testable without a process.
- **`providers`: NInfer `VramModel` data.** `packages/providers/src/vram.ts` ports the measured 27B/35B constants from `config-calculator.html` (weights, workspace, native max context, all seven KV bytes-per-token, and the per-mode speculation terms including the DFlash2 graph step), each tagged `measured` with the artifact provenance, plus the `specKey` mappings (mtp → mtp3, dflash → dflash-3 on the 35B, dflash2 → dflash2-7 on the 27B, `+head` when `lmHeadDraft`, and a backend a model never measured mapping to `undefined` so the estimator reports not-measured).
- **`service`: `estimate` + `detectHardware` entry points.** `ctx.localInfer.registerVramModel` keys the models by `id` (duplicate and empty ids fail loudly, `ctx.effect`-based disposers like the other registries); `estimate(config, hw)` resolves the model the config names (or the single registered model) and runs the core estimator, returning the breakdown, the verdict, and the `measured`/`estimated`/`not-measured` source label; `detectHardware()` runs the live probes (nvidia-smi, `docker --version`, the WSL2 kernel-release check, OS, CPU threads, host RAM) through a 5-second timeout per command and degrades a missing capability to "not available" instead of throwing.
- **`ui`: VRAM meter render model.** `packages/ui/src/meter.ts` maps an estimate to the to-scale segmented bar (weights / KV / overhead / workspace / free / OS-reserve against the full card), the verdict, the largest-fitting-context readout, and the source label, with a not-measured verdict hiding the measured/estimated badge. The panel that draws it lands in Phase 8.
- **Relationship established.** parameter → VRAM (the meter); hardware → usable budget (the reserve and the card size price every estimate).
- **Gates green.** `tsc -b` clean; `vitest run` 83/83 across 13 files, including the three engine-pinned golden cases (262144-token int8 no-spec 27B = 9,197,389,568 bytes exact; MTP3 + draft head 27B within 0.1% of 9,838,038,272; DFlash-3 35B = 4,312,377,600 exact, the same figures `node docs/config-calculator.test.mjs` pins against the engine), the page-alignment and spec-mode-response checks on `largestFittingContext`, the DFlash fixed-4096-bytes-per-token and DFlash2 graph-step assertions, the full model × spec × KV × context grid guard (nothing throws; a spec mode a model never measured reads not-measured; a measured spec mode never fits a longer context than none), the nvidia-smi parsing and probe-mapping suite, and the meter segment/label suite; `npx eslint` clean.

### Phase 3 — Guideline engine (red warnings) (complete)

- **`core`: the guideline engine.** `packages/core/src/guideline.ts` gains `evaluateGuidelines(guidelines, specs, config, hw)`, the pure rule engine: registered named guidelines run first in order, then every per-spec `hardwareConstraint` in spec order, so the result list is deterministic. A spec constraint prices the config value over the spec default, like the estimator, and a spec with neither a value nor a default is absent and fires nothing, which keeps a foreign engine's surface from warning on a config it does not own. Constraint failures carry a `constraint:<key>` id (the `constraintId` helper) so they can never collide with a registered guideline id, and they anchor to their own key for inline placement. `modelGuidelines(model, config, hw)` carries the two rules only the service can price, because they need the registered VramModel: `vram-exceeds-usable` reuses `estimateVram` and fires on an `over` verdict with the estimator's own `largestFittingContext` readout (0 reads as "no context fits this card"), and `spec-needs-draft-weights` fires when the config's spec resolves through the model's `specKey` mapping to a mode the model never measured (dflash2 on the 35B, dflash on the 27B), naming the backends the model did measure, derived from its speculation table.
- **`providers`: built-in hardware rules.** `packages/providers/src/guidelines.ts` carries `BUILTIN_GUIDELINES`, the three rules every engine shares, as `Guideline` data over (config, hardware): `docker-not-installed` (error; a docker build mode or the docker-only Hyper-Qwen engine on a host without docker), `host-tiers-exceed-host-ram` (warn; `hostKvMib` plus `hostStateSlots` priced at the measured 195,897,344-byte Host StateImage against the detected host RAM, the sum not either flag), and `wsl2-dflash2-needs-pin-memory` (error; dflash2 on WSL2 without the pin-memory flag, the boot abort the Hyper-Qwen `.env` notes name). The providers `apply` registers them with the seam, so a per-engine rule composes on top without touching these.
- **`service`: `guidelines` entry point.** `ctx.localInfer.guidelines(config, hw)` now runs the whole engine: the registered named guidelines over the collected spec surfaces of every registered engine (deduped by key in registration order), plus the model-aware rules against the resolved VramModel. The result list is the single source the banner and the inline red warnings render from.
- **`ui`: red-warning render model.** `packages/ui/src/warnings.ts` maps a `GuidelineResult` list to the render model: a summary banner (visible while any rule fired, painted in the worst level present, counting every fired rule) and the per-field inline map keyed by anchored parameter, so a field renders exactly the warnings anchored to it and an unanchored rule reaches the banner only. The level-to-tone mapping is the red-rendering contract: `error` renders `red`, `warn` renders `amber`, `info` renders `neutral`.
- **Lint gate.** `eslint.config.mjs` ignores the committed `packages/*/lib/**` build output, declares the browser globals the hand-written `dsh/client.js` carrier uses, and the carrier's unused `current` setter parameter reads `_current`.
- **Relationship established.** parameter (value *and* presence) → hardware capability → red warning, with the estimator-backed rule agreeing with the Phase 2 meter by construction.
- **Gates green.** `tsc -b` clean; `vitest run` 112/112 across 16 files, including the guideline-engine suite (firing, ordering, default-value pricing, the absent-spec guard), the model-rule suite (the over-budget message naming the estimator's own solver answer, the draft-weights rule with the available-backend readout), the built-in rule matrix (each rule fires on its condition and stays silent off it, the StateImage pricing pinned to the measured byte figure), the service suite (spec constraints and named guidelines wire through the seam, the model rules fire against the registered model), and the warnings render model (the red/amber/neutral tones, the banner worst-level, the per-anchor grouping); `npx eslint` clean.

### Phase 8 (first draft) — Web card + settings route (in progress)

The plan's panel landed as a working first draft out of phase order, because a card on the
Plugins page is the surface the user sees first. The draft covers the read model and the form;
the lifecycle controls (build / deploy / stop) and the register-as-model confirmation are the
remainder of Phase 8.

- **`dsh/client.js`: the "Engine settings" card.** Hand-written in the lazy-CJS bundle protocol
  (no build step, no dsh client imports; React comes from the browser module table). It mounts
  into the Plugins page's `plugins.bundle.config` slot keyed by the bundle package name
  (dsh 0.1.6-alpha.2 on) and the legacy `settings.plugin.item` slot on older hosts, so each
  host fills the slot it declares. The card owns its draft: field edits update the draft and
  re-price the summary through a debounced round trip, `Discard` reloads the stored config,
  and `Save` persists it. It renders the form (all control kinds, the `requires` gate as a
  disabled field with its reason), the to-scale VRAM meter with its legend and the
  largest-fitting-context readout, the over/tight verdict banner, and the guideline warnings
  (a summary banner painted in the worst level plus the inline warnings next to each anchored
  field). A headless profile (no web route) renders nothing, because the card only mounts
  after a probe of `/local-infer/summary` proves the route exists.
- **`ui/route.ts`: the settings route.** `GET /local-infer/summary` returns the engine list,
  the model list, the detected hardware, the form model for the selected engine, the meter
  model, the guideline warning model, and the config; `POST /local-infer/save` persists it.
  The values live in `~/.dsh/local-infer/config.json`, shared with the CLI, so the browser
  never sees a value it did not store. Both routes are held by an effect, so a bundle switch
  off removes them.
- **`providers/engines.ts`: the engine registry data.** `ENGINES` carries the four engine
  entries (NInfer and Hyper-Qwen with their measured parameter surfaces; llama.cpp and Strata
  with empty surfaces until their adapters land) as the single list the card offers, so
  adding an engine is a data edit.
- **Relationship established.** config + hardware → form, meter, and warnings in one read
  model the card draws, with the estimate the single source the meter and the verdict
  banner agree on and the guideline results the single source the banner and the inline
  warnings agree on.
- **Gates green.** `tsc -b` clean; `vitest run` 118/118 across 17 files (the route suite pins
  the summary read model, the warnings banner/inline split, the engine fallback, and the
  config-file round trip against a scratch `HOME`); `npx eslint` clean.

### Bundle installability and activation gotchas

- **The root `package.json` is the installable bundle.** `dsh.bundle.patch` points at
  `./cordis.patch.yml`, the `dsh.client` declaration names `dsh/client.js` (platform `web`,
  `immediately`), and the `files` list ships the carrier plus the four package `lib` trees,
  so the bundle installs from a git URL: `dsh plugin --profile web add
  https://github.com/cybtachyon/dsh-plugin-local-infer` (the README documents the CLI and the
  Web UI path).
- **The carrier row is what makes the browser card load.** The client-module scan keys a
  package's `dsh.client` declaration on a bare package-root Loader entry, never a subpath.
  The bundle declared only the four subpath entries, so `dsh/client.js` was never added to
  the boot graph and the Plugins page showed no card. The fix is a no-op `dsh/host.js`
  carrier module, a root `.` export, and a bundle row named after the bare package (the
  `local-infer` row in `cordis.patch.yml`), which is what the screenshot of the running
  profile shows: five components, the card included.
- **Sub-packages import each other by relative path.** `../../core/lib/index.js`, not the
  self-referencing bare specifier `@dsh/dsh-plugin-local-infer/core`, which only resolves
  when the package sits inside a `node_modules` tree and fails on a local or pnpm-linked
  install of this repo.
- **Host-side and client-side changes activate differently.** The client half
  (`dsh/client.js`) is loaded by the browser, so a page refresh picks up a new client.
  The host half (service, providers, tool, and the ui route) is loaded into the host
  process at startup: a bundle reinstall rewrites the files under
  `~/.dsh/profiles/<profile>/node_modules`, but the running host keeps its in-memory
  modules until a restart or a bundle toggle off/on. Observed 2026-10-13: after a bundle
  reinstall, the Plugins page showed the new client behavior (the action-labeled Save
  button, the theme-aware inputs) while the host-built form still carried the previous
  spec-gate message, which a host restart replaced.

### UX alignment pass (2026-10-13, against the running Plugins screen)

Reconciled the card with the plan's current direction and with the screenshot of the live
Plugins page:

- **The primary button is an action, not a status readout.** The draft painted its state word
  onto the button ("Idle"), which read as a dead control and hid the one thing the card
  offers. The button now stays `Save` and shows `Saving...` in progress; the transient
  `saved` confirmation is a note, and the next edit clears it.
- **Inputs follow the host theme.** The field background fell back to a solid `#fff`, which
  painted the dropdowns and text fields as white blocks on the dark Plugins page. It now
  uses the tertiary fill token with a neutral fallback, so the card reads the same in light
  and dark.
- **The native dropdown list follows the device color scheme.** The open option list of a
  `select` is browser chrome, not card styling: without a `color-scheme` declaration the
  browser renders it with its light scheme (dark text on a white list) even on a dark
  device, the unreadable dropdown the dark-mode Plugins page showed. The inputs, the
  combo's `datalist` input, and the sliders now declare `color-scheme: light dark`, so
  the popups render dark-on-light in light mode and light-on-dark in dark mode, matching
  the device setting the host theme follows.
- **The spec gate message names the fix.** `draftTokens` and `lmHeadDraft` greyed out with
  "spec must be mtp, dflash, or dflash2", a constraint statement. The shared
  `SPEC_GATE_MESSAGE` now reads "Pick a speculation backend first (mtp, dflash, or
  dflash2)", so the disabled field tells the user the next click.
- **The red-warning requirement is visible in the card.** The Phase 3 warnings render model
  reached the card: the summary carries the `warningsModel`, and the card draws the summary
  banner (painted in the worst level, counting every fired rule) plus the inline warnings
  next to each anchored field.
- **The chat template is the plan's combo control.** `ParameterForm` gains the `combo` kind
  and the `ComboOption` type (§3.1, §3.10); the NInfer `chatTemplate` spec switches from a
  bare path picker to a dropdown plus free text, shipping the popular Froggeric22 template
  as data tagged `source: 'popular'` (the engine- and user-added option sources are the
  remaining data edits). The renderer draws it as a native `input` + `datalist`, so the
  known options suggest and any path or HF repo reference types.
- **Remaining against the plan's direction.** The directory fields (§3.10 `modelDirectory`,
  `engineDirectory`, `engineFork`), the engine- and user-added combo option sources, the
  Phase 4 system-dependency panel with its "Get" gate, the Phase 5 lifecycle controls
  (build / deploy / stop), and the Phase 6 register-as-model confirmation are not built yet;
  the card today is the configure-and-size surface, and its `Save` persists the config the
  later phases will consume.
