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
import type { Config, DefaultProvenance, HardwareProfile, ProviderStatus, VramVerdict } from 'dsh-plugin-local-infer/core';
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { StoredPlatformConfig } from '../config.ts';
import type { FormModel } from '../form.ts';
import type { MeterModel } from '../meter.ts';
import type { WarningsModel } from '../warnings.ts';
/**
 * LocalInferSummary is the JSON the card renders: the engine list, the model
 * list, the detected hardware, the form model for the selected engine, the
 * meter model for the current config, the verdict the banner renders, the
 * guideline warning model the red banner and inline warnings render from,
 * and the config the form edits. Every field is plain data, so it crosses
 * the socket without a function left behind.
 */
export interface LocalInferSummary {
    engines: {
        id: string;
        label: string;
        supports: {
            docker: boolean;
            local: boolean;
        };
        defaultBuildCommand?: string;
        defaultDockerTag?: string;
    }[];
    models: {
        id: string;
        source: string;
    }[];
    hardware: HardwareProfile;
    engineId: string;
    formModel: FormModel;
    meterModel: MeterModel;
    verdict: VramVerdict;
    warningsModel: WarningsModel;
    config: Config;
    platformConfigs: Record<string, StoredPlatformConfig>;
    defaults: DefaultsModel;
    modelDirectory: string;
    modelDefaults: ModelDefaultModel[];
    modelStatus: ModelStatusModel | null;
    chatTemplateStatus: ChatTemplateStatusModel | null;
    modelFiles: string[];
    showHelp: boolean;
    providers: ProviderSummaryEntry[];
    logPath: string;
    lastLogs: string;
    unsureBanner: {
        message: string;
        killCommands: string[];
    } | null;
    registered: boolean;
}
/**
 * ProviderSummaryEntry is the card-facing view of one saved provider config:
 * the stable id the card edits and deletes against, the engine and model the
 * title renders ("NInfer: <model>"), the running-state the status dot paints,
 * and the full config and platform the expanded form draws from.
 */
export interface ProviderSummaryEntry {
    id: string;
    engine: string;
    model: string;
    status: ProviderStatus;
    config: Config;
    platform: StoredPlatformConfig;
}
/**
 * ModelDefaultModel is the card-facing view of one default model entry: the
 * registry key the config `model` field carries, the label the dropdown
 * shows, and the Hugging Face URL the no-CLI row links to.
 */
export interface ModelDefaultModel {
    id: string;
    label: string;
    url: string;
}
/**
 * ModelStatusModel is the model-status read model the card draws: whether the
 * model is present in the model directory, whether the hf CLI is available,
 * and the download command the Download button runs. The card shows the row
 * only while the model is absent.
 */
export interface ModelStatusModel {
    modelId: string;
    label: string;
    url: string;
    present: boolean;
    hfCli: boolean;
    downloadCommand: string;
}
/**
 * ChatTemplateStatusModel is the answer to "is the selected chat template in
 * the model directory": the repo reference, its display label, whether the
 * template file is present, whether the hf CLI is available, and the download
 * command the card runs (and the System dependencies box shows when the auto-
 * download is unavailable).
 */
export interface ChatTemplateStatusModel {
    repo: string;
    label: string;
    present: boolean;
    hfCli: boolean;
    downloadCommand: string;
}
/**
 * DefaultsModel is the resolved-defaults read model the card draws: the
 * starting config the defaults resolver produced and the per-key provenance
 * that names the source that supplied each value (a preset, the user, or a
 * spec default).
 */
export interface DefaultsModel {
    config: Config;
    provenance: DefaultProvenance[];
}
/**
 * buildSummary assembles the card's read model for one engine and config: the
 * static engine and model lists, the detected hardware, the form model the
 * selected engine's parameter surface renders to, the meter model the
 * service's estimate prices, and the warning model the service's guideline
 * engine fires. The estimate is the single source the meter and the verdict
 * banner agree on, and the guideline results are the single source the red
 * banner and the inline warnings agree on.
 */
export declare function buildSummary(localInfer: LocalInferService, request?: {
    engine?: string;
    config?: Config;
}): Promise<LocalInferSummary>;
//# sourceMappingURL=summary.d.ts.map