/**
 * The card's copy: the en/zh label tables and the labels() selector.
 *
 * Two short label sets rather than a locale bundle: the card has a couple
 * of dozen strings, and a bundle would be more machinery than the thing it
 * labels. The en table is the key set of record; the zh table is typed
 * against it (TextTable), so a key added to en without a zh translation is
 * a compile error, not a silent en fallback.
 * @module dsh-plugin-local-infer/client/text
 */
declare const en: {
    section: string;
    subtitle: string;
    engine: string;
    model: string;
    modelAuto: string;
    loading: string;
    save: string;
    saving: string;
    saved: string;
    discard: string;
    loadFailed: string;
    saveFailed: string;
    retry: string;
    noParameters: string;
    meterTitle: string;
    meterSourceMeasured: string;
    meterSourceEstimated: string;
    meterSourceNotMeasured: string;
    largestContext: string;
    tokens: string;
    cardTotal: string;
    reserveReadout: string;
    reserveDefault: string;
    reserveExplicit: string;
    reserveForeign: string;
    reserveGpuBusy: string;
    unknownEnginesTitle: string;
    unknownEnginesBody: string;
    over: string;
    tight: string;
    guidelineOne: string;
    guidelineMany: string;
    fired: string;
    measureHint: string;
    build: string;
    buildLocal: string;
    buildDocker: string;
    depsTitle: string;
    depsNone: string;
    pmUnknown: string;
    copy: string;
    copied: string;
    copyFailed: string;
    run: string;
    installing: string;
    get: string;
    getting: string;
    gettingReadout: string;
    gettingVerb: string;
    gettingEta: string;
    gettingFiles: string;
    stepDeps: string;
    stepClone: string;
    stepBuild: string;
    stepModel: string;
    stepTemplate: string;
    getFailed: string;
    allowRun: string;
    depsSatisfied: string;
    installRejected: string;
    register: string;
    registerDefault: string;
    unregister: string;
    registered: string;
    registerFailed: string;
    unregistered: string;
    unregisterFailed: string;
    launch: string;
    autoRebuild: string;
    launching: string;
    launchFailed: string;
    runningOn: string;
    notHealthy: string;
    stop: string;
    stopping: string;
    stopped: string;
    stopFailed: string;
    modelDirectory: string;
    enginePlatform: string;
    engineDirectory: string;
    engineFork: string;
    buildCommands: string;
    dockerTag: string;
    dirPlaceholder: string;
    forkPlaceholder: string;
    hfCliDetected: string;
    noHfCli: string;
    download: string;
    downloading: string;
    downloaded: string;
    downloadFailed: string;
    helpToggle: string;
    refresh: string;
    engineHelp: string;
    modelHelp: string;
    buildHelp: string;
    modelDirHelp: string;
    engineDirHelp: string;
    engineForkHelp: string;
    buildCommandsHelp: string;
    dockerTagHelp: string;
    providers: string;
    newProvider: string;
    edit: string;
    cancel: string;
    delete: string;
    deleteProvider: string;
    statusRunning: string;
    statusStopped: string;
    statusUnsure: string;
    unsureBanner: string;
    registerNeedsSave: string;
    logs: string;
    logLocation: string;
    resize: string;
    entryLaunch: string;
    entryStop: string;
    entryLogs: string;
    entryPrereqs: string;
    entryDownloading: string;
    entryBuilding: string;
    entrySudo: string;
    entryLaunching: string;
    chatTemplatePreset: string;
    customChatTemplate: string;
    custom: string;
    templateAbsent: string;
    templateInstructions: string;
    templateDownload: string;
    templateDownloading: string;
    templateDownloaded: string;
    templateDownloadFailed: string;
    customArgsTitle: string;
    customArgKeyHeader: string;
    customArgValueHeader: string;
    customArgAddRemoveHeader: string;
    customArgKeyPlaceholder: string;
    customArgValuePlaceholder: string;
    customArgAdd: string;
    customArgRemove: string;
    customArgClear: string;
    customArgHelp: string;
    orchestratorSection: string;
    orchestratorPrompt: string;
    orchestratorDefaultNote: string;
};
export type TextTable = Record<keyof typeof en, string>;
/** The card's copy tables, keyed by language. */
export declare const TEXT: {
    en: TextTable;
    zh: TextTable;
};
/**
 * labels selects the label table for the active locale. `active` is the
 * locale the host locale seam reports (null before the seam fires). When it
 * is empty the selector falls back to the document lang, then the browser
 * language, then en. Only a zh-prefix locale selects the zh table.
 */
export declare function labels(active?: string | null): TextTable;
export {};
//# sourceMappingURL=text.d.ts.map
