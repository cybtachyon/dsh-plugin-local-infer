/**
 * The summary view model: the JSON the card renders. buildSummary assembles
 * the engine list, the detected hardware, the form model for the selected
 * engine, the VRAM meter model for the current config, the verdict the banner
 * renders, the guideline warning model the red banner and inline warnings
 * render from, and the config the form edits. The estimate is the single
 * source the meter and the verdict banner agree on, and the guideline results
 * are the single source the red banner and the inline warnings agree on.
 * @module dsh-plugin-local-infer/ui/viewmodels/summary
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildModelEntry, CHAT_TEMPLATE_FILE, hfChatTemplateCommand, hfDownloadCommand, modelArtifactPath, modelEntriesForEngine, } from '../../../core/lib/index.js';
import { defaultModelFor, defaultModelsForEngine, ENGINES, enginePlatformDefaults, } from '../../../providers/lib/index.js';
import { readConfig } from "../config.js";
import { renderForm } from "../form.js";
import { renderMeter } from "../meter.js";
import { renderWarnings } from "../warnings.js";
import { relinkStoredProviders, resolveAdapter } from "../ops/engine.js";
import { resolveModelRow } from "../ops/model.js";
import { chatTemplateLabel, isHfRepoReference, resolveModelRegistryId } from "./summaryHelpers.js";
/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, the meter model the
 * service's estimate prices, and the warning model the service's guideline
 * engine fires. The estimate is the single source the meter and the verdict
 * banner agree on, and the guideline results are the single source the red
 * banner and the inline warnings agree on.
 */
export async function buildSummary(localInfer, request) {
    const stored = readConfig();
    const engineId = request?.engine ?? stored.engine;
    // ENGINES is a known non-empty constant, so the fallback is always defined.
    const engine = ENGINES.find((entry) => entry.id === engineId) ?? ENGINES[0];
    // The Model Directory field defaults to the plugin's model download
    // directory (~/.dsh/models, created when absent), so the card always
    // seeds a real path the deploy step can target. A stored or requested
    // directory that is a non-blank string wins over the default.
    const modelDirectory = localInfer.defaultModelDirectory();
    const rawConfig = request?.config ?? stored.config;
    const config = typeof rawConfig.modelDirectory === 'string' && rawConfig.modelDirectory.trim() !== ''
        ? rawConfig
        : { ...rawConfig, modelDirectory };
    const modelDir = typeof config.modelDirectory === 'string' ? config.modelDirectory : modelDirectory;
    const hardware = await localInfer.detectHardware();
    // The model value the card carries maps onto the VramModel registry key the
    // estimator prices: a default-model selection is already a registry key, a
    // directory-scan selection is an artifact file name the default list maps
    // to its registry key, and a missing value falls back to the engine's first
    // default model. Pricing the resolved key is what keeps the meter from
    // reading as not-measured (an empty chart) on a scanned model.
    const modelId = resolveModelRegistryId(engine.id, config.model);
    const pricedConfig = { ...config, model: modelId };
    // Resolve the starting config over the registered presets and the engine's
    // parameter surface, so the estimate and the model-aware guidelines price a
    // sane budget (the preset's kvDtype and max-context) rather than a bare
    // config that names no KV format. The resolved config carries the explicit
    // values the user set over the preset defaults, and the engine's first
    // default model when the user named none. The engine id rides into both
    // entry points: the estimate's OS-reserve resolution runs the plugin-
    // launched check against it, and the model-aware guidelines price the same
    // usable budget the meter does.
    const defaults = await localInfer.resolveDefaults(engine.id, modelId, hardware, pricedConfig);
    const estimate = await localInfer.estimate(defaults.config, hardware, engine.id);
    const guidelineResults = await localInfer.guidelines(defaults.config, hardware, engine.id);
    // The directory scan lists the model files the selected engine can serve
    // straight from the model directory, so the card's Model dropdown offers
    // them beside the defaults. A missing directory reads as an empty list.
    const modelFiles = modelEntriesForEngine(localInfer.listModelDirectory(modelDir), engine.id);
    // The model status checks the selected model against the model directory
    // and probes the hf CLI, so the card shows its Download row (or the URL
    // row) only while the model is absent.
    const entry = defaultModelFor(engine.id, modelId);
    let modelStatus = null;
    if (entry !== undefined) {
        const present = existsSync(modelArtifactPath(entry, modelDir));
        const hfCli = (await localInfer.hfCliAvailable()) !== null;
        modelStatus = {
            modelId: entry.modelId,
            label: entry.label,
            url: entry.url,
            present,
            hfCli,
            downloadCommand: hfDownloadCommand(entry, modelDir),
        };
    }
    // The chat-template status checks the selected template against the model
    // directory and probes the hf CLI, so the card auto-downloads an absent
    // template (and the System dependencies box shows the download command when
    // the CLI is missing). Only HF repo references are downloadable; a local
    // path or an empty template reads as null.
    const chatTemplateValue = typeof config.chatTemplate === 'string' ? config.chatTemplate : '';
    let chatTemplateStatus = null;
    if (isHfRepoReference(chatTemplateValue)) {
        const present = existsSync(join(modelDir, CHAT_TEMPLATE_FILE));
        const hfCli = (await localInfer.hfCliAvailable()) !== null;
        chatTemplateStatus = {
            repo: chatTemplateValue,
            label: chatTemplateLabel(chatTemplateValue),
            present,
            hfCli,
            downloadCommand: hfChatTemplateCommand(chatTemplateValue, modelDir),
        };
    }
    // The restart re-link: a provider entry whose launch record names a still-
    // running engine (the DSH that launched it died, and the engine re-parented
    // to init) is re-adopted as plugin-launched, so its status dot reads as
    // running for its model and the OS-reserve resolver keeps the default. A
    // record whose engine is dead is cleared (the previous-pid list with it),
    // so a recycled pid cannot re-link to a config whose engine is down. The
    // adopted engines also get a liveness watcher, so a later pkill settles the
    // stored state without waiting for another summary read.
    const linkedProviders = await relinkStoredProviders(localInfer, stored);
    // The provider list the card renders as collapsed entries: each saved
    // config's engine and model feed the detector, which resolves the running-
    // state its status dot paints. A provider the detector cannot tie to a
    // confirmed model reads as unsure, so the dot never overstates a live
    // engine. The config rides into the detector so the signature prices the
    // provider's own build mode and port, not the adapter's default-port guess.
    const providerRefs = linkedProviders.map((provider) => {
        const model = typeof provider.config.model === 'string' ? provider.config.model : undefined;
        // exactOptionalPropertyTypes: include the model key only when it is a
        // string, so a config that names no model never writes `undefined`.
        return model !== undefined
            ? { id: provider.id, engine: provider.engine, model, config: provider.config }
            : { id: provider.id, engine: provider.engine, config: provider.config };
    });
    const providerStatuses = providerRefs.length > 0 ? await localInfer.providerStatuses(providerRefs) : {};
    const providers = linkedProviders.map((provider) => ({
        id: provider.id,
        engine: provider.engine,
        model: typeof provider.config.model === 'string' ? provider.config.model : '',
        status: providerStatuses[provider.id] ?? 'unsure',
        config: provider.config,
        platform: provider.platform,
    }));
    // The "unsure" banner: shown when no provider is confirmed running but at
    // least one reads as unsure (a foreign engine the detector saw but could
    // not tie to a model, or a busy card). The banner offers the host-OS stop
    // commands (Stop-Process on Windows, kill on Linux and macOS) for the engine
    // processes the detector saw holding VRAM, so the user can stop a provider
    // launched in another session.
    const anyRunning = providers.some((p) => p.status === 'running');
    const anyUnsure = providers.some((p) => p.status === 'unsure');
    const unsureBanner = !anyRunning && anyUnsure
        ? {
            message: 'Unable to link to a provider (it may have been launched in another session). \n To stop, run:',
            killCommands: await localInfer.unsureBannerKillCommands(),
        }
        : null;
    // The registered flag tells the card whether the current config's provider
    // and model are already in the DSH settings, so the Remove button shows
    // only when there is something to remove. A profile without the settings
    // seam (a host that predates the typert remote) or a host without the
    // engine adapter registered reads as unregistered. The row resolves through
    // the same discovery plus modelRef fall-through the register step uses, so
    // the flag names the same entry the register step wrote while the engine
    // answers, and a down engine (no discovery) reads as unregistered.
    let registered = false;
    try {
        const regAdapter = resolveAdapter(localInfer, engine.id);
        const regPlan = regAdapter.renderLaunch(config, hardware);
        const regRow = await resolveModelRow(regAdapter, regPlan, config);
        const regEntry = buildModelEntry(regPlan, regRow);
        registered = await localInfer.modelIsRegistered(regEntry.providerId, regRow.id);
    }
    catch {
        // A missing adapter, a missing settings seam, or a refused read all
        // read as unregistered, which hides the Remove button (a no-op removal).
    }
    return {
        engines: ENGINES.map((entry) => {
            // The platform defaults ride the engine entry so the card's Engine
            // platform section seeds the build-command and docker-tag placeholders
            // from the same data the deploy step consumes. The build command is the
            // engine's first build step for the detected host OS, so a Windows host
            // seeds the vcpkg route and a Linux host seeds the cmake route.
            const defaults = enginePlatformDefaults(entry.id, hardware.os);
            return {
                id: entry.id,
                label: entry.label,
                supports: entry.supports,
                ...(defaults.defaultBuildCommand !== undefined
                    ? { defaultBuildCommand: defaults.defaultBuildCommand }
                    : {}),
                ...(defaults.defaultDockerTag !== undefined
                    ? { defaultDockerTag: defaults.defaultDockerTag }
                    : {}),
            };
        }),
        models: localInfer.registeredVramModels().map((model) => ({ id: model.id, source: model.source })),
        hardware,
        engineId: engine.id,
        // The hardware profile prices the form's hardware-dependent controls (the
        // host-KV slider cap), so the render model and the meter agree on the
        // machine they run on.
        formModel: renderForm(engine.parameters, config, hardware),
        meterModel: renderMeter(estimate.breakdown, estimate.verdict, hardware.gpu?.vramGiB ?? 0, estimate.source, estimate.reserveSource, 
        // The "Unknown Engine(s)" readout shows the VRAM the detector's foreign
        // engine programs are holding: the OS-reserve segment is the GPU's used
        // VRAM when a foreign engine is detected, so the readout names the
        // footprint a provider launched in another session is eating off the
        // card. Absent when no provider reads as unsure.
        anyUnsure ? { bytes: estimate.breakdown.reserve } : null),
        verdict: estimate.verdict,
        warningsModel: renderWarnings(guidelineResults),
        config,
        platformConfigs: stored.platform,
        defaults: { config: defaults.config, provenance: defaults.provenance },
        modelDirectory,
        modelDefaults: defaultModelsForEngine(engine.id).map((entry) => ({
            id: entry.modelId,
            label: entry.label,
            url: entry.url,
        })),
        modelStatus,
        chatTemplateStatus,
        modelFiles,
        showHelp: stored.showHelp,
        providers,
        logPath: stored.logPath,
        lastLogs: stored.lastLogs,
        unsureBanner,
        registered,
    };
}
//# sourceMappingURL=summary.js.map