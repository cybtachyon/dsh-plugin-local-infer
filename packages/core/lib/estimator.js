/**
 * The paged KV allocator reserves whole 64-token physical pages, so a
 * requested context prices the page it rounds up to, and a solved maximum
 * context lands on a page boundary the engine can actually reach.
 */
export const KV_PAGE_TOKENS = 64;
/**
 * Headroom below this marks a fit as tight: it fits, but fragmentation can
 * push it over.
 */
export const TIGHT_HEADROOM_BYTES = 0.5 * 1024 * 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
/**
 * pageRoundUp rounds a token count up to the 64-token page boundary the
 * paged KV allocator reserves.
 */
export function pageRoundUp(tokens) {
    return Math.ceil(tokens / KV_PAGE_TOKENS) * KV_PAGE_TOKENS;
}
/**
 * graphBytesFor resolves a speculation mode's CUDA-graph allowance at a
 * context. A flat allowance returns its constant; a step allowance (DFlash2)
 * is a function the provider data builds from the measured step table.
 */
function graphBytesFor(terms, ctx) {
    return terms.graphBytes ? terms.graphBytes(ctx) : 0;
}
/**
 * baseTerms prices the no-speculation baseline from the model's top-level
 * fields: the full KV rate, no extra cache, no graph allowance, no draft
 * weights.
 */
function baseTerms(model) {
    return {
        kvRatio: 1,
        kvExtraPerToken: 0,
        seqFixedBytes: model.seqFixedBytes,
        seqPerToken: model.seqPerToken,
    };
}
/**
 * fmtGiB formats a byte count as the meter's two-decimal GiB readout.
 */
function fmtGiB(bytes) {
    return (bytes / GIB).toFixed(2) + ' GiB';
}
/**
 * The OS-reserve budget the estimator prices when the config names none:
 * 3 GiB, the working-set floor the desktop keeps on a GPU card. An explicit
 * config value (reserveMiB or reserveGiB) always wins over the default.
 */
export const DEFAULT_OS_RESERVE_MIB = 3 * 1024;
/**
 * resolveReserveMiB reads the OS-reserve budget from the config: an explicit
 * MiB value, else a GiB value converted to MiB, else the 3 GiB default.
 */
function resolveReserveMiB(config) {
    if (typeof config.reserveMiB === 'number' && Number.isFinite(config.reserveMiB)) {
        return config.reserveMiB;
    }
    if (typeof config.reserveGiB === 'number' && Number.isFinite(config.reserveGiB)) {
        return config.reserveGiB * 1024;
    }
    return DEFAULT_OS_RESERVE_MIB;
}
/**
 * largestFittingContext solves the largest context the budget holds, at a page
 * boundary. Within one physical page the KV reservation is fixed, so the
 * hardest token count to fit in a page is its last one; the largest fully-
 * fitting page is floor(room / (page * per-token)), re-solved against the
 * candidate's own fixed bytes until it stops moving, because the graph
 * allowance is a step function of context and a candidate that crosses a step
 * must be priced at the deeper allowance. Capped at the model's native limit.
 */
function largestFittingContext(model, terms, kvBytesPerToken, ctx, usable, specExtra) {
    const perToken = kvBytesPerToken * terms.kvRatio + terms.kvExtraPerToken + (terms.seqPerToken ?? 0);
    if (perToken <= 0) {
        return model.nativeMaxContext;
    }
    const fixedAt = (candidate) => model.weightsBytes +
        specExtra +
        (typeof model.workspaceBytes === 'function' ? model.workspaceBytes(candidate) : model.workspaceBytes) +
        graphBytesFor(terms, candidate) +
        (terms.seqFixedBytes ?? 0);
    let solveFixed = fixedAt(ctx);
    let maxCtx = 0;
    for (let i = 0; i < 8; i++) {
        const room = usable - solveFixed;
        const candidate = Math.max(0, KV_PAGE_TOKENS * Math.floor(room / (KV_PAGE_TOKENS * perToken)));
        const candidateFixed = fixedAt(candidate);
        if (candidate === maxCtx && candidateFixed === solveFixed) {
            maxCtx = candidate;
            break;
        }
        maxCtx = candidate;
        solveFixed = candidateFixed;
    }
    return Math.min(maxCtx, model.nativeMaxContext);
}
/**
 * notMeasured builds the zeroed breakdown and verdict the estimator returns
 * when a number cannot be priced: no model, an unmeasured KV format, or an
 * unmeasured speculation mode.
 */
function notMeasured(detail) {
    return {
        breakdown: {
            weights: 0,
            kv: 0,
            overhead: 0,
            workspace: 0,
            free: 0,
            reserve: 0,
            total: 0,
            usable: 0,
            largestFittingContext: null,
        },
        verdict: { status: 'not-measured', detail },
        source: 'not-measured',
    };
}
/**
 * estimateVram prices a config against a VramModel and a HardwareProfile. It
 * is a pure function, so the meter, the guidelines, and the DSH contextWindow
 * all derive from the same arithmetic and cannot disagree. The formula mirrors
 * the NInfer config calculator: the KV cache prices its rounded page, the
 * sequence state adds its fixed block plus per-token remainder, the weights
 * gain the speculation mode's draft companion weights, and the workspace gains
 * the mode's CUDA-graph allowance. Optional parameter contributions sum on top
 * of the model terms, bucket by bucket.
 */
export function estimateVram(model, config, hw, specs) {
    if (model === undefined) {
        return notMeasured('no VramModel registered for this model');
    }
    const kvDtype = typeof config.kvDtype === 'string' ? config.kvDtype : undefined;
    if (kvDtype === undefined) {
        return notMeasured('no KV format in the config');
    }
    const kvBytesPerToken = model.kvBytesPerToken[kvDtype];
    if (kvBytesPerToken === undefined) {
        return notMeasured(`no measured figures for the "${kvDtype}" KV format`);
    }
    const ctx = typeof config.maxContext === 'number' && Number.isFinite(config.maxContext) ? config.maxContext : 0;
    const specKey = model.specKey
        ? model.specKey(config)
        : (typeof config.spec === 'string' ? config.spec : 'none');
    const terms = specKey === undefined
        ? undefined
        : (model.speculation?.[specKey] ?? (specKey === 'none' ? baseTerms(model) : undefined));
    if (terms === undefined) {
        return notMeasured(`no measured figures for the "${specKey}" speculation mode`);
    }
    const reserveMiB = resolveReserveMiB(config);
    const vramGiB = hw.gpu?.vramGiB ?? 0;
    const baseWeightsGiB = model.speculation?.['none']?.weightsGiB;
    const specExtra = terms.weightsGiB !== undefined && baseWeightsGiB !== undefined
        ? (terms.weightsGiB - baseWeightsGiB) * GIB
        : 0;
    const kvBytes = (kvBytesPerToken * terms.kvRatio + terms.kvExtraPerToken) * pageRoundUp(ctx);
    const overhead = (terms.seqFixedBytes ?? 0) + (terms.seqPerToken ?? 0) * ctx;
    const weights = model.weightsBytes + specExtra;
    const workspace = (typeof model.workspaceBytes === 'function' ? model.workspaceBytes(ctx) : model.workspaceBytes) +
        graphBytesFor(terms, ctx);
    // Parameter contributions price the same buckets the model does, so the
    // breakdown and the total stay one accounting: a contribution that moves a
    // bucket moves both the segment and the verdict.
    let contribWeights = 0;
    let contribKv = 0;
    let contribOverhead = 0;
    let contribWorkspace = 0;
    if (specs !== undefined) {
        const estCtx = {
            kvDtype,
            ctx,
            ...(typeof config.spec === 'string' ? { spec: config.spec } : {}),
            config,
        };
        for (const spec of specs) {
            if (spec.vramContribution === undefined)
                continue;
            const value = config[spec.key] === undefined ? spec.defaultValue : config[spec.key];
            const contribution = spec.vramContribution(value, estCtx);
            contribWeights += contribution.weights ?? 0;
            contribKv += contribution.kv ?? 0;
            contribOverhead += contribution.overhead ?? 0;
            contribWorkspace += contribution.workspace ?? 0;
        }
    }
    const weightsTotal = weights + contribWeights;
    const kvTotal = kvBytes + contribKv;
    const overheadTotal = overhead + contribOverhead;
    const workspaceTotal = workspace + contribWorkspace;
    const total = weightsTotal + kvTotal + overheadTotal + workspaceTotal;
    const usable = (vramGiB * 1024 - reserveMiB) * MIB;
    const headroom = usable - total;
    const verdict = headroom < 0
        ? {
            status: 'over',
            detail: `Over budget by ${fmtGiB(-headroom)}. ` +
                `${fmtGiB(total)} needed, ${fmtGiB(usable)} available.`,
        }
        : headroom < TIGHT_HEADROOM_BYTES
            ? {
                status: 'tight',
                detail: `Fits with ${fmtGiB(headroom)} to spare. Little room for fragmentation.`,
            }
            : {
                status: 'fits',
                detail: `${fmtGiB(total)} of ${fmtGiB(usable)}, leaving ${fmtGiB(headroom)}.`,
            };
    const breakdown = {
        weights: weightsTotal,
        kv: kvTotal,
        overhead: overheadTotal,
        workspace: workspaceTotal,
        free: Math.max(0, headroom),
        reserve: reserveMiB * MIB,
        total,
        usable,
        // The unmeasured cases returned above, so the KV bytes-per-token is a
        // number here and the solver always runs.
        largestFittingContext: largestFittingContext(model, terms, kvBytesPerToken, ctx, usable, specExtra),
    };
    return { breakdown, verdict, source: model.source };
}
//# sourceMappingURL=estimator.js.map