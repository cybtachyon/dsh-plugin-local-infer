/**
 * Service Definition for the local-inference capability seam (`ctx.localInfer`):
 * the engine, preset, and guideline registries plus the orchestration entry
 * points that turn a config and a hardware profile into an estimate, a set of
 * warnings, a dependency plan, a launch, and a registered DSH model.
 *
 * Providers register against the registries; the tool package and the UI call
 * the entry points. Registration is order-independent and a duplicate id is a
 * loud conflict, so hot-reload order never changes routing. The orchestration
 * entry points are declared here and filled in by later phases; in the
 * scaffold they fail loudly with `LOCAL_INFER_NOT_IMPLEMENTED` rather than
 * returning a silent default.
 * @module @dsh/dsh-plugin-local-infer/service
 */
import { Service } from '@deepseek-ai/cordis';
/**
 * Local-inference failure. Extends Error with a stable `code`
 * (`LOCAL_INFER_CONFLICT`, `LOCAL_INFER_INVALID_ENGINE`,
 * `LOCAL_INFER_NOT_IMPLEMENTED`) that callers route on instead of parsing the
 * message.
 */
export class LocalInferError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'LocalInferError';
        this.code = code;
    }
}
/**
 * `ctx.localInfer`. Holds the engine, preset, and guideline reservations; the
 * registries are read per call so a provider that unloads mid-session stops
 * serving without leaving a stale route behind.
 */
export class LocalInfer extends Service {
    engineRegistry = new Map();
    presetRegistry = new Map();
    guidelineRegistry = new Map();
    constructor(ctx) {
        super(ctx, 'localInfer');
    }
    registerEngine(adapter) {
        const id = adapter.id;
        if (id.trim() === '') {
            throw new LocalInferError('an engine adapter id must be a non-empty string', 'LOCAL_INFER_INVALID_ENGINE');
        }
        if (this.engineRegistry.has(id)) {
            throw new LocalInferError(`an engine adapter with id "${id}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.engineRegistry.set(id, adapter);
            yield () => {
                this.engineRegistry.delete(id);
            };
        }.bind(this), 'localInfer.registerEngine()');
        // ctx.effect's disposer returns Promise<void>; the registry disposer is a
        // synchronous fire-and-forget, so discard the (always-resolved) promise.
        return () => void dispose();
    }
    registerPreset(preset) {
        const key = presetKey(preset);
        if (this.presetRegistry.has(key)) {
            throw new LocalInferError(`a preset for "${key}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.presetRegistry.set(key, preset);
            yield () => {
                this.presetRegistry.delete(key);
            };
        }.bind(this), 'localInfer.registerPreset()');
        return () => void dispose();
    }
    registerGuideline(guideline) {
        if (this.guidelineRegistry.has(guideline.id)) {
            throw new LocalInferError(`a guideline with id "${guideline.id}" is already registered`, 'LOCAL_INFER_CONFLICT');
        }
        const dispose = this.ctx.effect(function* () {
            this.guidelineRegistry.set(guideline.id, guideline);
            yield () => {
                this.guidelineRegistry.delete(guideline.id);
            };
        }.bind(this), 'localInfer.registerGuideline()');
        return () => void dispose();
    }
    registeredEngines() {
        return [...this.engineRegistry.values()];
    }
    registeredPresets() {
        return [...this.presetRegistry.values()];
    }
    registeredGuidelines() {
        return [...this.guidelineRegistry.values()];
    }
    async estimate(_config, _hw) {
        return this.notImplemented('estimate');
    }
    async guidelines(_config, _hw) {
        return this.notImplemented('guidelines');
    }
    async deps(_engine, _buildMode, _hw) {
        return this.notImplemented('deps');
    }
    async installString(_engine, _buildMode, _hw) {
        return this.notImplemented('installString');
    }
    async runInstall(_engine, _buildMode, _hw) {
        return this.notImplemented('runInstall');
    }
    async launch(_plan) {
        return this.notImplemented('launch');
    }
    async registerModel(_plan) {
        return this.notImplemented('registerModel');
    }
    /**
     * The scaffold's placeholder for an entry point a later phase fills in. It
     * fails loudly so a caller never mistakes "not built yet" for a real answer.
     */
    async notImplemented(entryPoint) {
        throw new LocalInferError(`localInfer.${entryPoint} is not implemented in the scaffold`, 'LOCAL_INFER_NOT_IMPLEMENTED');
    }
}
/**
 * The stable registry key for a preset: its exact (engine, model, hardware
 * class) triple. A preset is only trusted for the triple it was sourced for,
 * so the key never collapses two distinct presets.
 */
function presetKey(preset) {
    return `${preset.engineId}/${preset.modelId}/${preset.hardwareClass}`;
}
export default LocalInfer;
//# sourceMappingURL=index.js.map