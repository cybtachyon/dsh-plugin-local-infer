// Browser half of the dsh local-inference plugin: the "Engine settings" card
// on the Plugins page.
//
// dsh web users have no terminal, so the local-inference config (engine, model,
// parameters) had no way in from the browser. The card is contributed through
// a slot rather than declared as a settings schema: `plugins.bundle.config`,
// keyed by the bundle's package name, on the Plugins page from dsh
// 0.1.6-alpha.2 on, and `settings.plugin.item` on older hosts. It reads and
// writes the plugin's own route (/local-infer/summary, /local-infer/save),
// which owns ~/.dsh/local-infer/config.json, so the browser never sees a value
// it did not store.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step. React and
// @deepseek-ai/dsh-client-ui-primitives come from the shell's frozen platform
// module table (PLATFORM_MODULES), the same baseline every dynamic bundle
// resolves against, so the card draws the DSH selector menus, buttons,
// checkboxes, and state dots its host Settings pages use. No
// dsh.client.external declaration is needed for a baseline seed. Hosts whose
// table predates the primitives seed keep the native controls through the
// require fallback in mountCard.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-local-infer',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // The Plugins page dispatches a bundle's configuration by the bundle's
    // manifest name (the root package.json "name" field, unscoped for git-URL
    // installs), which is the key the package inventory uses for the
    // plugins.bundle.config slot.
    var PACKAGE_NAME = 'dsh-plugin-local-infer';

    // The card's copy. Two short label sets rather than a locale bundle: the
    // card has a couple of dozen strings, and a bundle would be more machinery
    // than the thing it labels.
    var TEXT = {
      en: {
        section: 'Engine settings',
        subtitle: 'Local inference engine configuration.',
        engine: 'Engine',
        model: 'Model',
        modelAuto: 'engine default',
        loading: 'loading...',
        save: 'Save',
        saving: 'saving...',
        saved: 'saved',
        discard: 'Discard',
        loadFailed: 'load failed',
        saveFailed: 'save failed',
        retry: 'Retry',
        noParameters: 'This engine has no tunable parameters yet.',
        meterTitle: 'VRAM Est.',
        meterSourceMeasured: 'measured',
        meterSourceEstimated: 'estimated',
        meterSourceNotMeasured: 'not measured',
        largestContext: 'Largest fitting context',
        tokens: 'tokens',
        cardTotal: 'card',
        reserveReadout: 'Reserved for the OS',
        reserveDefault: '(default)',
        reserveExplicit: '(config)',
        reserveForeign: '(foreign engine)',
        reserveGpuBusy: '(GPU busy)',
        unknownEnginesTitle: 'Unknown Engine(s)',
        unknownEnginesBody:
          'held by engine program(s) the detector could not tie to a provider. Stop them to free this VRAM.',
        over: 'Over budget',
        tight: 'Fits tightly',
        guidelineOne: 'hardware guideline',
        guidelineMany: 'hardware guidelines',
        fired: 'fired',
        measureHint: 'Pick a model to measure the VRAM budget.',
        build: 'Build',
        buildLocal: 'local',
        buildDocker: 'docker',
        depsTitle: 'System dependencies',
        depsNone: 'No system dependencies required.',
        pmUnknown: 'package manager not detected',
        copy: 'Copy',
        copied: 'copied',
        copyFailed: 'copy failed',
        run: 'Run',
        running: 'running...',
        get: 'Get',
        getting: 'Getting...',
        getFailed: 'get failed',
        allowRun: 'Allow one-click install (sudo)',
        depsSatisfied: 'All dependencies satisfied.',
        installRejected: 'one-click install is not allowed; copy the install string instead',
        register: 'Register',
        registerDefault: 'Set as default model',
        unregister: 'Remove',
        registered: 'registered',
        registerFailed: 'register failed',
        unregistered: 'removed',
        unregisterFailed: 'remove failed',
        launch: 'Launch',
        autoRebuild: 'Auto Rebuild',
        launching: 'Launching...',
        launchFailed: 'launch failed',
        runningOn: 'running on port',
        notHealthy: 'not healthy',
        stop: 'Stop',
        stopping: 'stopping...',
        stopped: 'stopped',
        stopFailed: 'stop failed',
        modelDirectory: 'Model Directory',
        enginePlatform: 'Engine platform',
        engineDirectory: 'Engine Directory',
        engineFork: 'Engine Fork (Git Repo)',
        buildCommands: 'Build commands',
        dockerTag: 'Docker tag',
        dirPlaceholder: 'directory path',
        forkPlaceholder: 'git repo url',
        hfCliDetected: 'HF CLI detected:',
        noHfCli: 'No HF CLI detected, url:',
        download: 'Download',
        downloading: 'downloading...',
        downloaded: 'download complete',
        downloadFailed: 'download failed',
        helpToggle: 'Show or hide field help',
        refresh: 'Re-fetch the card data from the host',
        engineHelp:
          'Inference engines have different strengths and weaknesses for specific models and hardware.',
        modelHelp:
          'The model the engine serves. The engine default models and the model files already in the model directory are the offered choices.',
        buildHelp:
          'How the engine is deployed. local builds it from source on the host; docker pulls a prebuilt image. The dependency plan and hardware guidelines price the selected mode.',
        modelDirHelp: 'Where model files are downloaded and served from.',
        engineDirHelp:
          'Local directory of the engine source. Get clones or updates the git repo and builds the engine here; with no override it lands in the model directory under the engine name.',
        engineForkHelp: 'Git repo that overrides the engine default upstream for the clone step.',
        buildCommandsHelp:
          'Local build command that overrides the engine default for the checkout build. Shown only in local build mode.',
        dockerTagHelp:
          'Docker image tag the docker deploy pulls. Shown only in docker build mode.',
        providers: 'Providers',
        newProvider: 'New provider',
        edit: 'Edit',
        cancel: 'Cancel',
        delete: 'Delete',
        deleteProvider: 'Delete provider',
        statusRunning: 'running',
        statusStopped: 'stopped',
        statusUnsure: 'status unknown',
        unsureBanner:
          'Unable to link to a provider (it may have been launched in another session). \n To stop, run:',
        registerNeedsSave: 'Save the Provider configuration before registering with DSH.',
        logs: 'Logs',
        logLocation: 'Log location',
        entryLaunch: 'Launch',
        entryStop: 'Stop',
        entryLogs: 'Logs',
        entryPrereqs: 'Prereqs...',
        entryDownloading: 'Downloading...',
        entryBuilding: 'Building...',
        entryLaunching: 'Launching...',
        chatTemplatePreset: 'Chat template preset',
        customChatTemplate: 'Custom Chat template',
        custom: 'Custom',
        templateAbsent: 'Chat template not in the model directory',
        templateInstructions: 'Download the chat template with the hf CLI:',
        templateDownload: 'Download template',
        templateDownloading: 'downloading template...',
        templateDownloaded: 'template download complete',
        templateDownloadFailed: 'template download failed',
        customArgsTitle: 'Custom arguments',
        customArgKeyHeader: 'Parameter / Flag',
        customArgValueHeader: 'Value (optional)',
        customArgAddRemoveHeader: ' + / - ',
        customArgKeyPlaceholder: '--kv-dtype',
        customArgValuePlaceholder: 'int8',
        customArgAdd: 'Add a row',
        customArgRemove: 'Remove this row',
        customArgClear: 'Clear this row',
        customArgHelp:
          'Extra flags appended to the engine launch command after saving.'
      },
      zh: {
        section: '引擎设置',
        subtitle: '本地推理引擎配置。',
        engine: '引擎',
        model: '模型',
        modelAuto: '引擎默认',
        loading: '加载中…',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        discard: '放弃修改',
        loadFailed: '加载失败',
        saveFailed: '保存失败',
        retry: '重试',
        noParameters: '该引擎暂无可调参数。',
        meterTitle: '显存估算',
        meterSourceMeasured: '实测',
        meterSourceEstimated: '估算',
        meterSourceNotMeasured: '未测量',
        largestContext: '最大可用上下文',
        tokens: 'token',
        cardTotal: '显存',
        reserveReadout: '系统保留',
        reserveDefault: '(默认)',
        reserveExplicit: '(配置)',
        reserveForeign: '(外部引擎)',
        reserveGpuBusy: '(GPU 繁忙)',
        unknownEnginesTitle: '未知引擎',
        unknownEnginesBody: '被检测器无法关联到提供方的引擎程序占用。停止它们以释放此 VRAM。',
        over: '超出预算',
        tight: '勉强可容纳',
        guidelineOne: '硬件准则',
        guidelineMany: '硬件准则',
        fired: '触发',
        measureHint: '选择模型以测量显存预算。',
        build: '构建',
        buildLocal: '本地',
        buildDocker: '容器',
        depsTitle: '系统依赖',
        depsNone: '无需系统依赖。',
        pmUnknown: '未检测到包管理器',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败',
        run: '运行',
        running: '运行中…',
        get: '获取',
        getting: '获取中…',
        getFailed: '获取失败',
        allowRun: '允许一键安装 (sudo)',
        depsSatisfied: '所有依赖已满足。',
        installRejected: '未允许一键安装；请复制安装命令。',
        register: '注册',
        registerDefault: '设为默认模型',
        unregister: '移除',
        registered: '已注册',
        registerFailed: '注册失败',
        unregistered: '已移除',
        unregisterFailed: '移除失败',
        launch: '启动',
        autoRebuild: '自动重建',
        launching: '启动中…',
        launchFailed: '启动失败',
        runningOn: '运行于端口',
        notHealthy: '不健康',
        stop: '停止',
        stopping: '停止中…',
        stopped: '已停止',
        stopFailed: '停止失败',
        modelDirectory: '模型目录',
        enginePlatform: '引擎平台',
        engineDirectory: '引擎目录',
        engineFork: '引擎 Fork (Git 仓库)',
        buildCommands: '构建命令',
        dockerTag: 'Docker 标签',
        dirPlaceholder: '目录路径',
        forkPlaceholder: 'git 仓库地址',
        hfCliDetected: '检测到 HF CLI:',
        noHfCli: '未检测到 HF CLI,url:',
        download: '下载',
        downloading: '下载中…',
        downloaded: '下载完成',
        downloadFailed: '下载失败',
        helpToggle: '显示或隐藏字段帮助',
        refresh: '从主机重新加载卡片数据',
        engineHelp: '推理引擎针对特定模型和硬件各有优劣。',
        modelHelp: '引擎服务的模型。可选项包括引擎默认模型和模型目录中已有的模型文件。',
        buildHelp:
          '引擎的部署方式。local 在主机上从源码构建；docker 拉取预构建镜像。依赖计划和硬件准则按所选模式计价。',
        modelDirHelp: '模型文件的下载和服务目录。',
        engineDirHelp: '引擎源码的本地目录。“获取”会在此克隆或更新 git 仓库并构建引擎；未覆盖时，仓库落在模型目录下以引擎命名的子目录中。',
        engineForkHelp: '用于克隆步骤、覆盖引擎默认上游的 git 仓库。',
        buildCommandsHelp: '本地构建命令，覆盖引擎默认的检查构建。仅在本地构建模式下显示。',
        dockerTagHelp: 'docker 部署拉取的镜像标签。仅在 docker 构建模式下显示。',
        providers: '提供方',
        newProvider: '新增提供方',
        edit: '编辑',
        cancel: '取消',
        delete: '删除',
        deleteProvider: '删除提供方',
        statusRunning: '运行中',
        statusStopped: '已停止',
        statusUnsure: '状态未知',
        unsureBanner: '无法关联到提供方（它可能在另一个会话中启动）。\n如需停止，请运行：',
        registerNeedsSave: '注册到 DSH 之前请先保存该提供方配置。',
        logs: '日志',
        logLocation: '日志位置',
        entryLaunch: '启动',
        entryStop: '停止',
        entryLogs: '日志',
        entryPrereqs: '前置条件…',
        entryDownloading: '下载中…',
        entryBuilding: '构建中…',
        entryLaunching: '启动中…',
        chatTemplatePreset: '聊天模板预设',
        customChatTemplate: '自定义聊天模板',
        custom: '自定义',
        templateAbsent: '聊天模板不在模型目录中',
        templateInstructions: '使用 hf CLI 下载聊天模板:',
        templateDownload: '下载模板',
        templateDownloading: '模板下载中…',
        templateDownloaded: '模板下载完成',
        templateDownloadFailed: '模板下载失败',
        customArgsTitle: '自定义参数',
        customArgKeyHeader: '参数 / 标志',
        customArgValueHeader: '值 (可选)',
        customArgAddRemoveHeader: ' + / - ',
        customArgKeyPlaceholder: '例如 --kv-dtype',
        customArgValuePlaceholder: '例如 int8',
        customArgAdd: '添加一行',
        customArgRemove: '删除此行',
        customArgClear: '清空此行',
        customArgHelp:
          '保存后追加到引擎启动命令的额外标志。首行只清空不删除；+ 添加一行，下方行的 - 删除该行。',
      },
    };

    function labels(active) {
      var lang = (
        active ||
        document.documentElement.lang ||
        navigator.language ||
        'en'
      ).toLowerCase();
      return lang.indexOf('zh') === 0 ? TEXT.zh : TEXT.en;
    }

    // The meter's segment palette. The bar reads against the full card the way
    // the NInfer calculator draws it, with the OS reserve at the far end.
    // The reserve is dark, not light: it is the card's own budget floor, not
    // free space, and a light swatch read as "free" next to the free segment.
    // The dark fill keeps its identity in both themes, and the hatch lines
    // stay a lighter dark gray so the texture survives dark mode.
    var SEGMENT_COLORS = {
      weights: '#4f8ff7',
      kv: '#34c38f',
      // Teal, not the orange it used to be: the orange read as a warning next
      // to the workspace purple and the free gray, so the sequence-state
      // segment now sits in the cool end of the palette.
      overhead: '#14b8a6',
      workspace: '#b07ff7',
      free: '#d9d9d9',
      reserve: '#1c1c1c',
    };

    // The card frame reads the DSH settings-card tokens the Plugins page
    // cards use (0.5px stroke, xl radius, the settings-card fill), so the
    // bundle's config card sits in the page with the inventory cards. The
    // legacy tokens stay as fallbacks for a host without the settings-card
    // family.
    var CARD_STYLE = {
      border: '0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
      borderRadius: 'var(--dsw-radius-xl, 12px)',
      background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-background-secondary, rgba(128,128,128,0.06)))',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      fontSize: 13,
      color: 'var(--dsw-alias-label-primary, rgba(0,0,0,0.85))',
    };
    var ROW_STYLE = { display: 'flex', alignItems: 'center', gap: 8 };
    var LABEL_STYLE = {
      width: 120,
      flex: 'none',
      color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
    };
    // The input reads the DSH Input atom's field tokens (the 32px layer-1
    // field with the l4 hairline), so the text rows sit in the page with the
    // host's own inputs. The legacy tokens stay as fallbacks for a host
    // without the layer-1 family.
    //
    // colorScheme is what makes the *native popups* readable: the closed
    // select we style, but the open option list is browser chrome. Without
    // a color-scheme declaration the browser renders that list with its
    // light scheme (dark text on white) even on a dark device, which is the
    // unreadable dropdown the dark-mode Plugins page showed. 'light dark'
    // hands the popup to the device setting: dark list, light text, in dark
    // mode; light in light mode.
    var INPUT_STYLE = {
      flex: 1,
      minWidth: 0,
      height: 32,
      padding: '0 8px',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      border: '0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
      background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12)))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      font: 'inherit',
      fontSize: 14,
      colorScheme: 'light dark',
    };
    var SECTION_STYLE = {
        marginTop: 8,
        fontWeight: 600,
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
      };
    var BANNER_STYLE = (status) => ({
      padding: '8px 12px',
      borderRadius: 8,
      fontSize: 12,
      background:
        status === 'over'
          ? 'var(--dsw-alias-fill-error, rgba(255,59,48,0.12))'
          : 'var(--dsw-alias-fill-warning, rgba(255,159,10,0.12))',
      color:
        status === 'over'
          ? 'var(--dsw-alias-label-error, #ff3b30)'
          : 'var(--dsw-alias-label-warning, #ff9f0a)',
    });
    // The guideline warning banner. The tone follows the worst level the
    // warning model carries: red for an error, amber for a warning, neutral
    // for info, the same contract the warnings render model tests pin.
    var WARNING_BANNER_STYLE = (tone) => ({
      padding: '8px 12px',
      borderRadius: 8,
      fontSize: 12,
      lineHeight: 1.5,
      background:
        tone === 'red'
          ? 'var(--dsw-alias-fill-error, rgba(255,59,48,0.12))'
          : tone === 'amber'
            ? 'var(--dsw-alias-fill-warning, rgba(255,159,10,0.12))'
            : 'var(--dsw-alias-fill-quaternary, rgba(128,128,128,0.08))',
      color:
        tone === 'red'
          ? 'var(--dsw-alias-label-error, #ff3b30)'
          : tone === 'amber'
            ? 'var(--dsw-alias-label-warning, #ff9f0a)'
            : 'inherit',
    });
    var INLINE_WARNING_STYLE = (tone) => ({
      fontSize: 11,
      marginTop: 2,
      color:
        tone === 'red'
          ? 'var(--dsw-alias-label-error, #ff3b30)'
          : tone === 'amber'
            ? 'var(--dsw-alias-label-warning, #ff9f0a)'
            : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    });
    var FOOTER_STYLE = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 };
    var BUTTON_BASE = {
      padding: '5px 14px',
      borderRadius: 6,
      font: 'inherit',
      cursor: 'pointer',
      border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
    };
    var GHOST_BUTTON = Object.assign({}, BUTTON_BASE, {
      background: 'transparent',
      color: 'inherit',
    });
    var PRIMARY_BUTTON = Object.assign({}, BUTTON_BASE, {
      background: 'var(--dsw-alias-accent, #0a84ff)',
      color: '#fff',
      border: 'none',
    });

    // The per-entry provider state machine: the card's Launch/Stop control
    // lifecycle. The states are the button's reads: idle (a plain Launch), the
    // four rebuild phases (prereqs, download, build, launch), running (a
    // Stop), stopping (a disabled throbber while the stop is in flight), and
    // failed (a red Logs). launchNextState is the hardened transition: a step
    // event only advances forward through the rebuild phases (a stale or
    // out-of-order step is a no-op), a healthy result settles to running, a
    // failed result settles to failed, a stop moves a running (or idle, a
    // provider running per the summary with no machine entry) engine to
    // stopping, a confirmed stop settles to idle, a stop that is still running
    // at the deadline settles to failed with the cause 'stop', and a break
    // (the Logs control, a navigation away) resets: a launch failure reads as
    // Launch (idle), a stop timeout reads as Stop (running), because the
    // engine is probably still up. The machine takes the entry ({status,
    // cause}) and returns the next entry, so the cause-aware reset stays in
    // one place. An event that names no legal next state leaves the control
    // where it is, so a late event never corrupts it.
    var LAUNCH_STEP_ORDER = { prereqs: 0, download: 1, build: 2, launch: 3 };
    var LAUNCH_PHASE_STATES = ['prereqs', 'download', 'build', 'launch'];
    // The health-poll deadline: the route's poll runs up to two minutes, so a
    // client-side deadline just past that cap forces a hung launch to the red
    // Logs state. It arms only for the launch phase; the rebuild phases
    // (prereqs, download, build) run as long as they need to, so a slow build
    // never reads as a failure.
    var LAUNCH_HEALTH_DEADLINE_MS = 150000;
    // The stop-poll interval: while a stop is in flight, the card re-fetches
    // the summary on this cadence so the provider's status dot repaints the
    // moment the engine is down, instead of waiting out the host's 5-second
    // process-watch and probe cycle.
    var STOP_POLL_MS = 1000;
    // The stop deadline: a provider still running 10 seconds after a Stop
    // click settles to the red Logs state (the same path a failed launch
    // takes), so the user can open the entry, fix the config, and retry.
    var STOP_HEALTH_DEADLINE_MS = 10000;

    function launchIsPhase(state) {
      return LAUNCH_PHASE_STATES.indexOf(state) !== -1;
    }

    function launchNextState(entry, event) {
      var current = entry && entry.status !== undefined ? entry.status : 'idle';
      var cause = entry && entry.cause !== undefined ? entry.cause : undefined;
      var type = event.type;
      var next;
      var nextCause;
      if (type === 'start') {
        // A launch begins from idle (a plain Launch) or failed (a re-launch
        // after the Logs control cleared the failed state).
        next = current === 'idle' || current === 'failed' ? 'prereqs' : current;
        nextCause = undefined;
      } else if (type === 'step') {
        var target = event.step;
        if (LAUNCH_STEP_ORDER[target] === undefined) {
          next = current;
          nextCause = cause;
        } else if (current === 'idle' || current === 'failed') {
          next = target;
          nextCause = undefined;
        } else if (current === 'running' || current === 'stopping') {
          // A stop in flight supersedes a late launch step.
          next = current;
          nextCause = cause;
        } else {
          var currentOrder = LAUNCH_STEP_ORDER[current];
          if (currentOrder === undefined) {
            next = current;
            nextCause = cause;
          } else {
            next = LAUNCH_STEP_ORDER[target] >= currentOrder ? target : current;
            nextCause = undefined;
          }
        }
      } else if (type === 'healthy') {
        next = launchIsPhase(current) ? 'running' : current;
        nextCause = undefined;
      } else if (type === 'failed') {
        next = launchIsPhase(current) ? 'failed' : current;
        nextCause = undefined;
      } else if (type === 'stop') {
        // A stop moves a running engine (or an idle one running per the
        // summary, or a launch in flight) to the stopping state; a stop
        // already in flight is a no-op.
        next =
          current === 'running' ||
          current === 'stopping' ||
          current === 'idle' ||
          launchIsPhase(current)
            ? 'stopping'
            : current;
        nextCause = undefined;
      } else if (type === 'stopped') {
        // The fast poll confirmed the provider is no longer running.
        next = current === 'stopping' ? 'idle' : current;
        nextCause = undefined;
      } else if (type === 'stopFailed') {
        // The deadline fired while the provider was still running.
        next = current === 'stopping' ? 'failed' : current;
        nextCause = current === 'stopping' ? 'stop' : cause;
      } else if (type === 'reset') {
        // A launch failure reads as Launch (idle); a stop timeout reads as
        // Stop (running), because the engine is probably still up.
        next = current === 'failed' ? (cause === 'stop' ? 'running' : 'idle') : 'idle';
        nextCause = undefined;
      } else {
        next = current;
        nextCause = cause;
      }
      return { status: next, cause: nextCause };
    }

    // The deps panel. The install block is a copy/paste target, so it gets a
    // monospace pre with its own copy button; the dep rows read their status
    // from a state dot (the DSH StateDot, or its glyph fallback), not a word,
    // so a long list stays scannable.
    var DEPS_ROW_STYLE = {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      fontSize: 12,
      marginTop: 2,
    };
    var INSTALL_BLOCK_STYLE = {
      margin: '8px 0',
      padding: 8,
      borderRadius: 6,
      background: 'var(--dsw-alias-background-tertiary, rgba(128,128,128,0.08))',
      border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
      fontSize: 11,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
    };
    // The Custom Arguments table. A three-column grid (parameter, value, the
    // + / - controls) the user fills with extra launch flags. The header row
    // reads the tertiary section label; the inputs reuse the card's Input atom
    // tokens, and the + / - controls are the compact ghost buttons.
    var CUSTOM_ARGS_GRID_STYLE = {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr auto',
      gap: 6,
      alignItems: 'center',
      marginTop: 4,
    };
    var CUSTOM_ARGS_HEADER_STYLE = {
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    };
    var CUSTOM_ARGS_BUTTONS_STYLE = {
      display: 'flex',
      gap: 4,
      justifyContent: 'flex-end',
    };
    // The circular header buttons: the "?" help toggle and the refresh
    // action. The active state reads as the accent fill; the inactive state
    // as the muted outline. The help preference persists through the save
    // route, so it survives a reload.
    var HELP_BUTTON_STYLE = (active) => ({
      width: 20,
      height: 20,
      flex: 'none',
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      fontSize: 12,
      lineHeight: 1,
      cursor: 'pointer',
      border:
        '1px solid ' +
        (active
          ? 'var(--dsw-alias-accent, #0a84ff)'
          : 'var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))'),
      background: active ? 'var(--dsw-alias-accent, #0a84ff)' : 'transparent',
      color: active ? '#fff' : 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
    });
    // The per-field description line: it sits under the input column (the
    // 120px label plus the 8px row gap) in the tertiary label the disabled
    // reason reads, so a two-line description stays a quiet annotation.
    var HELP_ROW_STYLE = {
      fontSize: 11,
      lineHeight: 1.4,
      marginTop: 2,
      marginLeft: 128,
      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
    };

    // The help line the card draws under a field row while the help toggle
    // is on. The spec fields carry their text from the provider's
    // ParameterSpec description; the hardcoded rows carry theirs from the
    // card's copy table.
    function renderHelpRow(react, text) {
      if (text === null || text === undefined || text === '') {
        return null;
      }
      return react.createElement('div', { style: HELP_ROW_STYLE }, text);
    }

    // The number input that pairs with a slider: type a number or use the
    // native spin buttons. It keeps the typed text in local state and
    // commits an in-range number, so a partial keystroke (a "1" on the way
    // to "128") never pushes an out-of-range value into the draft config.
    // Spin buttons always land in range, so they commit immediately.
    // Defined at factory level, not inside a render function, so React
    // keeps one hook state per field instead of remounting on every render.
    function NumberField(props) {
      var react = props.react;
      var field = props.field;
      var control = props.control;
      var onValue = props.onValue;
      var numeric = typeof field.value === 'number' ? field.value : null;
      var textState = react.useState(numeric !== null ? String(numeric) : '');
      var text = textState[0];
      // A value that lands from outside (a save, a discard, an engine
      // switch) resyncs the text; the ref comparison is the React
      // adjust-state-during-render pattern, no effect cycle needed.
      var lastNumeric = react.useRef(numeric);
      if (numeric !== lastNumeric.current) {
        lastNumeric.current = numeric;
        textState[1](numeric !== null ? String(numeric) : '');
      }
      var snap = (value) => {
        if (!control.step || control.step <= 0) {
          return value;
        }
        var base = control.min !== undefined ? control.min : 0;
        var steps = Math.round((value - base) / control.step);
        // 1e6 kills float noise (0.05 * 18 = 0.9000000000000001).
        return Math.round((base + steps * control.step) * 1e6) / 1e6;
      };
      var commit = () => {
        if (text === '') {
          return; // an empty field already committed undefined
        }
        var parsed = Number(text);
        if (Number.isNaN(parsed)) {
          textState[1](numeric !== null ? String(numeric) : '');
          return;
        }
        var clamped = parsed;
        if (control.min !== undefined && clamped < control.min) {
          clamped = control.min;
        }
        if (control.max !== undefined && clamped > control.max) {
          clamped = control.max;
        }
        clamped = snap(clamped);
        textState[1](String(clamped));
        if (clamped !== numeric) {
          onValue(field.key, clamped);
        }
      };
      return react.createElement(
        'input',
        {
          type: 'number',
          min: control.min,
          max: control.max,
          step: control.step,
          value: text,
          disabled: field.disabled,
          style: {
            width: 88,
            flex: 'none',
            height: 32,
            padding: '0 8px',
            borderRadius: 'var(--dsw-radius-md, 8px)',
            border: '0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-secondary, rgba(128,128,128,0.24)))',
            background: 'var(--dsw-alias-bg-layer-1, var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12)))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            font: 'inherit',
            fontSize: 14,
            colorScheme: 'light dark',
            opacity: field.disabled ? 0.5 : 1,
          },
          onChange: (event) => {
            var raw = event.target.value;
            textState[1](raw);
            if (raw === '') {
              // Clearing the field reverts to the spec default, the same
              // fall-through resolveValue documents.
              onValue(field.key, undefined);
              return;
            }
            var parsed = Number(raw);
            if (Number.isNaN(parsed)) {
              return; // a partial like "1e"; commit on blur
            }
            if (control.min !== undefined && parsed < control.min) {
              return; // out of range while typing; commit on blur
            }
            if (control.max !== undefined && parsed > control.max) {
              return;
            }
            var snapped = snap(parsed);
            textState[1](String(snapped));
            onValue(field.key, snapped);
          },
          onBlur: commit,
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              commit();
            }
          },
        },
      );
    }

    // The DSH selector pill the Settings (General) rows use: a 36px platform
    // fill, radius md, the primary label, the interactive hover, and the
    // focus ring. The Menu list itself carries the host's own CSS, so the
    // pill is the only chrome the card adds.
    var STYLE_ELEMENT_ID = 'dsh-local-infer-styles';
    function injectStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
        return;
      }
      var style = document.createElement('style');
      style.id = STYLE_ELEMENT_ID;
      style.textContent = [
        '.dsh-li-selector{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-background-tertiary,rgba(128,128,128,0.12)));font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,rgba(0,0,0,0.85));cursor:pointer}',
        '.dsh-li-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.16))}',
        '.dsh-li-selector:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#0a84ff));outline-offset:2px}',
        '.dsh-li-selector:disabled{opacity:0.5;cursor:default}',
        '.dsh-li-selector-chevron{flex:none;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,0.8))}',
      ].join('\n');
      document.head.appendChild(style);
    }

    // The DSH-style dropdown: the selector pill anchor plus the host's Menu
    // (the same component the Settings (General) language row opens), portaled
    // to document.body so the card's overflow never crops the list. Defined at
    // factory level, like NumberField, so React keeps one hook state per
    // field instead of remounting on every render.
    function SelectPill(props) {
      var react = props.react;
      var openState = react.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var pill = react.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-li-selector',
          disabled: props.disabled,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => {
            if (!props.disabled) {
              setOpen(!open);
            }
          },
        },
        props.label,
        props.Chevron
          ? react.createElement(props.Chevron, { className: 'dsh-li-selector-chevron' })
          : null,
      );
      return react.createElement(
        props.Menu,
        {
          open: open,
          onClose: () => {
            setOpen(false);
          },
          items: props.items,
          selectedId: props.selectedId,
          onSelect: (id) => {
            props.onSelect(id);
            setOpen(false);
          },
          align: 'end',
          portal: true,
          anchor: pill,
        },
      );
    }

    // One dropdown field. The DSH Menu pill when the host seeds the
    // primitives, the native select it replaces otherwise. `items` are
    // {id, label} rows; `value` is the selected id; `onSelect` receives the
    // chosen id (an empty id clears the value, the native fallback's ''
    // option behavior).
    function renderSelect(react, primitives, opts) {
      if (primitives && typeof primitives.Menu === 'function') {
        injectStyles();
        return react.createElement(SelectPill, {
          react: react,
          Menu: primitives.Menu,
          Chevron: primitives.IconChevronDownOutlineRegular,
          label: opts.label,
          items: opts.items,
          selectedId: opts.value,
          onSelect: opts.onSelect,
          disabled: opts.disabled === true,
        });
      }
      return react.createElement(
        'select',
        Object.assign(
          {
            style: INPUT_STYLE,
            value: opts.value,
            disabled: opts.disabled === true,
            onChange: (event) => opts.onSelect(event.target.value),
          },
          opts.disabled === true ? { opacity: 0.5 } : {},
        ),
        opts.items.map((item) =>
          react.createElement('option', { key: item.id, value: item.id }, item.label),
        ),
      );
    }

    // The DSH Button atom (the --dsw-alias-button-* token families) with the
    // card's inline buttons as the fallback a host without the seed keeps.
    // size stays the compact sm control: the card is a 28px context.
    function renderButton(react, primitives, variant, buttonProps, children) {
      if (primitives && typeof primitives.Button === 'function') {
        return react.createElement(
          primitives.Button,
          Object.assign({ variant: variant, size: 'sm', type: 'button' }, buttonProps),
          children,
        );
      }
      return react.createElement(
        'button',
        Object.assign(
          {
            type: 'button',
            style: variant === 'primary' ? PRIMARY_BUTTON : GHOST_BUTTON,
          },
          buttonProps,
        ),
        children,
      );
    }

    // The DSH Checkbox atom (a native input with its visible label) with the
    // card's inline label as the fallback.
    function renderCheckbox(react, primitives, checkboxProps) {
      if (primitives && typeof primitives.Checkbox === 'function') {
        return react.createElement(primitives.Checkbox, checkboxProps);
      }
      return react.createElement(
        'label',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            cursor: 'pointer',
          },
        },
        react.createElement('input', {
          type: 'checkbox',
          checked: checkboxProps.checked,
          disabled: checkboxProps.disabled,
          onChange: (event) => checkboxProps.onChange(event.target.checked),
        }),
        checkboxProps.label,
      );
    }

    // The DSH StateDot semantics (green done, amber warning, red error, the
    // spinner ongoing) for the dep rows, with the card's colored glyphs as
    // the fallback.
    function renderStateDot(react, primitives, state) {
      if (primitives && typeof primitives.StateDot === 'function') {
        return react.createElement(primitives.StateDot, { state: state });
      }
      var glyph = { done: '✓', warning: '○', error: '✗', ongoing: '…', idle: '○' };
      var color = {
        done: '#34c38f',
        warning: 'var(--dsw-alias-label-warning, #ff9f0a)',
        error: 'var(--dsw-alias-label-error, #ff3b30)',
        ongoing: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
        idle: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
      };
      return react.createElement(
        'span',
        {
          style: { color: color[state] || 'inherit', width: 12, flex: 'none' },
          'aria-hidden': 'true',
        },
        glyph[state] || '○',
      );
    }

    // The provider list: the saved provider entries the summary carries, each
    // a collapsed card with a status dot (green running, red stopped, yellow
    // The per-entry Launch control: a card entry's own lifecycle button, shown
    // alongside its Edit and Delete controls. Idle reads as a Launch button
    // that starts the entry's engine; a rebuild in flight shows a disabled
    // control with the spinner and the phase label (Prereqs, Downloading,
    // Building, Launching); a healthy engine reads as an enabled Stop; a launch
    // that timed out reads as a red Logs control that opens the entry for
    // editing, the same action as Edit.
    function renderEntryLaunchButton(react, primitives, provider, opts) {
      var state = (opts.launchState || {})[provider.id];
      var status = state !== undefined ? state.status : 'idle';
      // A rebuild phase in flight: a disabled control with the spinner and the
      // phase label, so the button reads the step that is actually running.
      var phaseLabels = {
        prereqs: opts.prereqsLabel,
        download: opts.downloadingLabel,
        build: opts.buildingLabel,
        launch: opts.launchingLabel,
      };
      var phaseLabel = phaseLabels[status];
      if (phaseLabel !== undefined) {
        return renderProcessButton(react, primitives, {
          busy: true,
          label: phaseLabel,
          busyLabel: phaseLabel,
          variant: 'ghost',
          onClick: function () {},
        });
      }
      // A stop in flight: a disabled control with the spinner and the
      // stopping label, the same throbber the launch phases show.
      if (status === 'stopping') {
        return renderProcessButton(react, primitives, {
          busy: true,
          label: opts.stoppingLabel,
          busyLabel: opts.stoppingLabel,
          variant: 'ghost',
          onClick: function () {},
        });
      }
      // The Stop control reads from the provider status dot, not just the
      // per-entry launch state: the launch state is lost when the user
      // navigates away from the plugin page and back, so a running engine
      // (a green dot) must keep the control as Stop, not reset to Launch.
      if (status === 'running' || provider.status === 'running') {
        return renderButton(
          react,
          primitives,
          'ghost',
          { onClick: function () { opts.onStopEntry(provider); } },
          opts.stopLabel,
        );
      }
      if (status === 'failed') {
        // A launch that timed out or failed: a red Logs control that opens the
        // entry for editing and clears the failed state, so the control reads
        // as Launch again and the user can fix the config and re-launch.
        return react.createElement(
          'button',
          {
            type: 'button',
            onClick: function () {
              if (typeof opts.onLogs === 'function') {
                opts.onLogs(provider);
              } else {
                opts.onEdit(provider);
              }
            },
            style: Object.assign(
              { color: 'var(--dsw-alias-label-error, #ff3b30)' },
              GHOST_BUTTON,
            ),
            'aria-label': opts.logsLabel,
          },
          opts.logsLabel,
        );
      }
      // Idle: a plain Launch control that starts the entry's own engine.
      return renderButton(
        react,
        primitives,
        'ghost',
        { onClick: function () { opts.onLaunchEntry(provider); } },
        opts.launchLabel,
      );
    }

    // The owner/repo short name the provider title bar renders when an entry
    // names a fork (the git repo that overrides the engine default upstream).
    // It accepts a protocol URL (https://github.com/owner/repo), an scp-style
    // git@host:owner/repo reference, and an already-short owner/repo form,
    // stripping a trailing .git. It returns undefined when no repo name is
    // present, so the title bar falls back to the engine label.
    function repoShortName(ref) {
      if (typeof ref !== 'string' || ref.trim() === '') {
        return undefined;
      }
      var value = ref.trim();
      var isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
      if (isUrl) {
        // Drop the scheme and the host segment, leaving owner/repo.
        value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/]+\//, '');
      } else {
        var colon = value.indexOf(':');
        var slash = value.indexOf('/');
        // An scp-style git@host:owner/repo reference: drop the host prefix.
        if (colon !== -1 && (slash === -1 || colon < slash)) {
          value = value.slice(colon + 1);
        }
      }
      var segments = value.split('/').filter(function (part) {
        return part !== '';
      });
      if (segments.length === 0) {
        return undefined;
      }
      var repo = segments[segments.length - 1].replace(/\.git$/, '');
      if (repo === '') {
        return undefined;
      }
      var owner = segments.length > 1 ? segments[segments.length - 2] : undefined;
      return owner ? owner + '/' + repo : repo;
    }

    // unsure), an "Engine: Model" title, and Edit/Delete controls. A New
    // provider button resets the form to a fresh entry. The list sits above
    // the editing form, so a provider's full config form stays the single
    // shared card body.
    function renderProviderList(react, primitives, providers, opts) {
      var statusToDot = { running: 'done', stopped: 'error', unsure: 'warning' };
      var statusToLabel = {
        running: opts.statusRunning,
        stopped: opts.statusStopped,
        unsure: opts.statusUnsure,
      };
      var rows = (providers || []).map(function (provider) {
        var engineLabel =
          ((opts.engines || []).find(function (engine) {
            return engine.id === provider.engine;
          }) || {}).label || provider.engine;
        // The title bar renders the fork's owner/repo when the entry names a
        // fork, so a forked engine reads as its repo (Ninfer/ninfer-all)
        // rather than the engine label (NInfer). No fork, or an unparseable
        // one, keeps the engine label.
        var forkName =
          provider.platform && typeof provider.platform === 'object'
            ? repoShortName(provider.platform.engineFork)
            : undefined;
        var titleLabel = forkName !== undefined ? forkName : engineLabel;
        var modelLabel =
          provider.model && provider.model !== '' ? provider.model : opts.modelAuto;
        return react.createElement(
          'div',
          {
            key: provider.id,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              border: '1px solid rgba(127,127,127,0.25)',
              borderRadius: 6,
            },
          },
          renderStateDot(react, primitives, statusToDot[provider.status] || 'idle'),
          react.createElement(
            'span',
            {
              style: {
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              title:
                titleLabel +
                ': ' +
                modelLabel +
                ' (' +
                (statusToLabel[provider.status] || provider.status) +
                ')',
              'aria-label':
                titleLabel +
                ': ' +
                modelLabel +
                ' (' +
                (statusToLabel[provider.status] || provider.status) +
                ')',
            },
            titleLabel +
              ': ' +
              modelLabel +
              ' (' +
              (statusToLabel[provider.status] || provider.status) +
              ')',
          ),
          // The provider the editing form is open for shows a Cancel button
          // (which collapses the form back to Edit and discards its changes);
          // every other provider shows the Edit button that opens it.
          opts.editingId === provider.id
            ? renderButton(
                react,
                primitives,
                'ghost',
                { onClick: function () { opts.onCancel(provider); } },
                opts.cancelLabel,
              )
            : renderButton(
                react,
                primitives,
                'ghost',
                { onClick: function () { opts.onEdit(provider); } },
                opts.editLabel,
              ),
          renderButton(
            react,
            primitives,
            'ghost',
            {
              onClick: function () {
                opts.onDelete(provider.id);
              },
              disabled: opts.deletingId === provider.id,
            },
            opts.deleteLabel,
          ),
          renderEntryLaunchButton(react, primitives, provider, opts),
        );
      });
      return react.createElement(
        'div',
        { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 } },
        rows,
      );
    }

    // The "New provider" control that sits after the provider entries and the
    // editing form. It is a clickable button while a new provider can be
    // started (entries exist and the form is not already in new-provider
    // mode); it is plain text with no button styling while the form is in
    // new-provider mode or there are no entries, since the form is already
    // there to enter one.
    function renderNewProviderControl(react, primitives, opts) {
      if (opts.clickable) {
        return renderButton(react, primitives, 'ghost', { onClick: opts.onNew }, opts.label);
      }
      return react.createElement(
        'span',
        {
          style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.8))' },
        },
        opts.label,
      );
    }

    // The DSH loading indicator the per-entry Launch button shows while a
    // launch is in flight: the StateDot ongoing spinner (the primitives'
    // shared loader) with a CSS border-spin as the fallback a host without the
    // seed keeps.
    function renderThrobber(react, primitives) {
      if (primitives && typeof primitives.StateDot === 'function') {
        return react.createElement(primitives.StateDot, {
          state: 'ongoing',
          size: 12,
        });
      }
      return react.createElement('span', {
        style: {
          display: 'inline-block',
          width: 12,
          height: 12,
          border: '2px solid rgba(127,127,127,0.3)',
          borderTopColor: 'var(--dsw-alias-label-primary, #1d1d1f)',
          borderRadius: '50%',
          animation: 'dsh-local-infer-spin 0.8s linear infinite',
        },
        'aria-hidden': 'true',
      });
    }

    // The reusable stateful process button: the Disable/Throbber/Reset
    // lifecycle every process control (Get, Launch, Stop, Run, Download)
    // shares. While the process is in flight (busy) it reads as a disabled
    // control with the spinner and the in-progress label; when it settles the
    // caller flips busy back to false and the control resets to the idle
    // action button (the label and the click handler). A host without the
    // primitives seed keeps the native fallback through renderButton.
    function renderProcessButton(react, primitives, opts) {
      if (opts.busy === true) {
        return react.createElement(
          'button',
          {
            type: 'button',
            disabled: true,
            style: Object.assign(
              { display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.7 },
              GHOST_BUTTON,
            ),
            'aria-label': opts.busyLabel,
          },
          renderThrobber(react, primitives),
          react.createElement('span', null, opts.busyLabel),
        );
      }
      return renderButton(
        react,
        primitives,
        opts.variant,
        { onClick: opts.onClick, disabled: opts.disabled === true },
        opts.label,
      );
    }

    // The chat-template control, split from the old finicky free-text combo
    // into a preset dropdown (the shipped presets plus a "Custom" entry) and a
    // "Custom Chat template" text field that shows while the preset is
    // Custom. The single config value (the effective --chat-template) is
    // derived: a known preset value selects that preset, a non-preset value
    // selects Custom, and an empty value selects the blank row. The local
    // custom-mode flag keeps the text field open after a Custom selection even
    // while the value is still empty, so a fresh selection is ready to type.
    function ChatTemplateField(props) {
      var react = props.react;
      var field = props.field;
      var control = props.control;
      var onValue = props.onValue;
      var t = props.t;
      var value = field.value;
      var options = control.options || [];
      var isPreset = options.some(function (option) {
        return String(option.value) === String(value);
      });
      var valueIsEmpty = value === undefined || value === null || value === '';
      // The custom-mode flag starts from the value: a non-preset, non-empty
      // value is a custom template, so the text field opens ready.
      var customModeInit = !valueIsEmpty && !isPreset;
      var customModeState = react.useState(customModeInit);
      var customMode = customModeState[0];
      var setCustomMode = customModeState[1];

      var presetItems = [{ id: '', label: t.modelAuto }].concat(
        options.map(function (option) {
          return {
            id: String(option.value),
            label: option.note ? option.label + ' · ' + option.note : option.label,
          };
        }),
      ).concat([{ id: 'custom', label: t.custom }]);

      var presetValue = isPreset && !valueIsEmpty ? String(value) : customMode ? 'custom' : '';
      var presetLabel =
        (presetItems.find(function (item) {
          return item.id === presetValue;
        }) || {}).label || t.modelAuto;

      var customValue = valueIsEmpty ? '' : String(value);

      var presetSelect = renderSelect(react, props.primitives, {
        value: presetValue,
        label: presetLabel,
        items: presetItems,
        onSelect: function (id) {
          if (id === 'custom') {
            // Switch to custom mode: keep the current custom value if it is
            // one, else start empty. The text field opens ready to type.
            setCustomMode(true);
            if (valueIsEmpty || isPreset) {
              onValue(field.key, '');
            }
          } else if (id === '') {
            setCustomMode(false);
            onValue(field.key, undefined);
          } else {
            setCustomMode(false);
            onValue(field.key, id);
          }
        },
        disabled: field.disabled,
      });

      return react.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 } },
        react.createElement(
          'div',
          { style: ROW_STYLE },
          react.createElement('label', { style: LABEL_STYLE }, t.chatTemplatePreset),
          presetSelect,
        ),
        customMode
          ? react.createElement(
              'div',
              { style: ROW_STYLE },
              react.createElement('label', { style: LABEL_STYLE }, t.customChatTemplate),
              react.createElement('input', {
                style: Object.assign(
                  {},
                  INPUT_STYLE,
                  field.disabled ? { opacity: 0.5 } : {},
                ),
                type: 'text',
                value: customValue,
                placeholder: 'local path or HF repo reference',
                disabled: field.disabled,
                onChange: function (event) {
                  onValue(field.key, event.target.value);
                },
              }),
            )
          : null,
      );
    }

    // One rendered field: the control the `control` model names, greyed out
    // with its reason while `disabled` is set, the per-field description
    // beneath the row while `help` is on, and the inline guideline warnings
    // anchored to the field's key beneath it.
    function renderField(react, field, onValue, inlineWarnings, primitives, help, t) {
      var value = field.value;
      var common = {
        key: field.key,
        disabled: field.disabled,
        style: Object.assign({}, INPUT_STYLE, field.disabled ? { opacity: 0.5 } : {}),
      };
      var control = field.control;
      var input;
      // A combo field (the chat template) renders its own labeled preset and
      // custom rows, so the outer field label is omitted for it.
      var comboField = false;
      if (control.kind === 'checkbox') {
        // The checkbox is a bare native control, not a field: it keeps the
        // browser's box size (the 32px input style would stretch it).
        input = react.createElement('input', {
          key: field.key,
          type: 'checkbox',
          checked: value === true,
          disabled: field.disabled,
          style: {
            accentColor: 'var(--dsw-alias-accent, #0a84ff)',
            colorScheme: 'light dark',
            opacity: field.disabled ? 0.5 : 1,
          },
          onChange: (event) => onValue(field.key, event.target.checked),
        });
      } else if (control.kind === 'dropdown') {
        // The enum options plus the '' row the native select cleared with:
        // the pill's first menu row, the one an empty value selects.
        var dropdownItems = [{ id: '', label: '—' }].concat(
          (control.options || []).map((option) => ({
            id: String(option.value),
            label: option.note ? option.label + ' · ' + option.note : option.label,
          })),
        );
        var dropdownValue = value === undefined || value === null ? '' : String(value);
        var dropdownLabel =
          (dropdownItems.find((item) => item.id === dropdownValue) || {}).label || '—';
        input = renderSelect(react, primitives, {
          value: dropdownValue,
          label: dropdownLabel,
          items: dropdownItems,
          onSelect: (id) => onValue(field.key, id === '' ? undefined : id),
          disabled: field.disabled,
        });
      } else if (control.kind === 'slider') {
        // The readout is a number input, not a label: type a value or use
        // the spin buttons, and the slider and the estimate follow. The
        // unit moves to a small label beside the input, because a native
        // number input cannot carry suffix text.
        //
        // The range strip's cap is the hardware-priced sliderMax when the
        // form declares one (the host-KV pool caps at half the host RAM),
        // else the static max, else 100. The number entry keeps the static
        // max (or none), so a typed value is never hard-capped by the
        // slider. A form with slider:false (the port field) renders the
        // number entry alone, no drag strip.
        var numeric = typeof value === 'number' ? value : undefined;
        var sliderCap =
          control.sliderMax !== undefined
            ? control.sliderMax
            : control.max !== undefined
              ? control.max
              : 100;
        var unitLabel = control.unit
          ? react.createElement(
              'span',
              {
                style: {
                  width: 48,
                  flex: 'none',
                  fontSize: 11,
                  color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
                },
              },
              control.unit,
            )
          : null;
        var numberEntry = react.createElement(NumberField, {
          react: react,
          field: field,
          control: control,
          onValue: onValue,
        });
        if (control.slider === false) {
          // A plain number entry: no range strip (the port field's case).
          input = react.createElement(
            'span',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 } },
            numberEntry,
            unitLabel,
          );
        } else {
          input = react.createElement(
            'span',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 } },
            react.createElement('input',
              Object.assign(
                {
                  // colorScheme keeps the native slider UI on the device
                  // scheme, the same reason the inputs carry it.
                  style: {
                    flex: 1,
                    accentColor: 'var(--dsw-alias-accent, #0a84ff)',
                    colorScheme: 'light dark',
                  },
                  disabled: field.disabled,
                },
                {
                  type: 'range',
                  min: control.min !== undefined ? control.min : 0,
                  max: sliderCap,
                  step: control.step !== undefined ? control.step : 1,
                  value: numeric !== undefined ? numeric : control.min !== undefined ? control.min : 0,
                  onChange: (event) => onValue(field.key, Number(event.target.value)),
                },
              ),
            ),
            numberEntry,
            unitLabel,
          );
        }
      } else if (control.kind === 'combo') {
        // The chat template: a preset dropdown (shipped presets plus a Custom
        // entry) and a "Custom Chat template" text field that shows while the
        // preset is Custom. The ChatTemplateField owns both rows and the
        // single effective value, so the finicky free-text combo is gone.
        comboField = true;
        input = react.createElement(ChatTemplateField, {
          react: react,
          field: field,
          control: control,
          onValue: onValue,
          primitives: primitives,
          t: t,
        });
      } else {
        // text and picker both render a free-text input; the browser has no
        // native directory picker, so the path is typed.
        input = react.createElement(
          'input',
          Object.assign({}, common, {
            type: 'text',
            value: value === undefined || value === null ? '' : String(value),
            placeholder: control.placeholder || '',
            onChange: (event) => onValue(field.key, event.target.value),
          }),
        );
      }
      // A combo field (the chat template) renders its own labeled preset and
      // custom rows, so it skips the outer field label and the disabled-reason
      // span (the text field greys itself out while disabled).
      var body = comboField
        ? input
        : react.createElement(
            'div',
            { style: ROW_STYLE },
            react.createElement('label', { style: LABEL_STYLE }, field.label),
            input,
            field.disabled && field.disabledReason
              ? react.createElement(
                  'span',
                  {
                    style: {
                      fontSize: 11,
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    },
                  },
                  field.disabledReason,
                )
              : null,
          );
      return react.createElement(
        'div',
        { key: field.key, style: { marginTop: 6 } },
        body,
        help ? renderHelpRow(react, field.description) : null,
        (inlineWarnings || []).map((warning) =>
          react.createElement(
            'div',
            { key: warning.id, style: INLINE_WARNING_STYLE(warning.tone) },
            warning.message,
          ),
        ),
      );
    }

    // The to-scale segmented VRAM bar plus its legend and readouts.
    function renderMeter(react, meter, t) {
      if (meter === null || meter === undefined) {
        return null;
      }
      var bar = react.createElement(
        'div',
        {
          style: {
            display: 'flex',
            height: 14,
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
          },
        },
        meter.segments.map((segment) =>
          react.createElement(
            'div',
            {
              key: segment.key,
              title: segment.label + ': ' + (segment.bytes / 1024 / 1024 / 1024).toFixed(2) + ' GiB',
              style: {
                width: segment.percent + '%',
                background:
                  segment.key === 'reserve'
                    ? 'repeating-linear-gradient(45deg, ' +
                      SEGMENT_COLORS.reserve +
                      ', ' +
                      SEGMENT_COLORS.reserve +
                      ' 4px, #4d4d4d 4px, #4d4d4d 8px)'
                    : SEGMENT_COLORS[segment.key] || '#ccc',
              },
            },
          ),
        ),
      );
      var legend = react.createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8, fontSize: 11 } },
        meter.segments.map((segment) =>
          react.createElement(
            'span',
            { key: segment.key, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            react.createElement('span', {
              style: {
                width: 8,
                height: 8,
                borderRadius: 2,
                background: SEGMENT_COLORS[segment.key] || '#ccc',
                display: 'inline-block',
              },
            }),
            segment.label,
          ),
        ),
      );
      var sourceLabel =
        meter.source === 'measured'
          ? t.meterSourceMeasured
          : meter.source === 'estimated'
            ? t.meterSourceEstimated
            : t.meterSourceNotMeasured;
      // The reserve readout names where the dark segment's value came from:
      // the 3 GiB default, a config value, a foreign engine the probe
      // detected by process, or the 75%-GPU-usage fallback. The value is the
      // reserve segment's byte count, so the readout and the bar agree.
      var reserveSegment = null;
      for (var ri = 0; ri < meter.segments.length; ri++) {
        if (meter.segments[ri].key === 'reserve') {
          reserveSegment = meter.segments[ri];
          break;
        }
      }
      var reserveSourceLabel =
        meter.reserveSource === 'foreign-process'
          ? t.reserveForeign
          : meter.reserveSource === 'gpu-usage'
            ? t.reserveGpuBusy
            : meter.reserveSource === 'explicit'
              ? t.reserveExplicit
              : t.reserveDefault;
      var readout = react.createElement(
        'div',
        { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))' } },
        react.createElement('span', null, t.largestContext + ': '),
        meter.largestFittingContext !== null
          ? react.createElement('strong', null, String(meter.largestFittingContext) + ' ' + t.tokens)
          : react.createElement('span', null, '—'),
        react.createElement('span', null, '  ·  ' + sourceLabel),
        react.createElement(
          'div',
          { style: { marginTop: 2 } },
          react.createElement('span', null, t.reserveReadout + ': '),
          react.createElement(
            'span',
            null,
            (reserveSegment ? (reserveSegment.bytes / 1024 / 1024 / 1024).toFixed(2) : '0.00') +
              ' GiB ' +
              reserveSourceLabel,
          ),
        ),
      );
      // The "Unknown Engine(s)" section: a yellow readout that names the VRAM
      // the detector's foreign engine programs are holding, so the user sees
      // the footprint a provider launched in another session is eating off
      // the card. Absent when no provider reads as unsure.
      var unknownEngines =
        meter.unknownEngines !== null && meter.unknownEngines !== undefined
          ? react.createElement(
              'div',
              {
                style: {
                  marginTop: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'var(--dsw-alias-fill-warning, rgba(255,199,0,0.12))',
                  border: '1px solid var(--dsw-alias-border-warning, rgba(255,199,0,0.4))',
                  color: 'var(--dsw-alias-label-warning, #b45309)',
                },
              },
              react.createElement('div', { style: { fontWeight: 600, marginBottom: 2 } }, t.unknownEnginesTitle),
              react.createElement(
                'span',
                null,
                (meter.unknownEngines.bytes / 1024 / 1024 / 1024).toFixed(2) + ' GiB ' + t.unknownEnginesBody,
              ),
            )
          : null;
      return react.createElement(
        'div',
        { style: { marginTop: 8 } },
        react.createElement('div', { style: { fontWeight: 600, fontSize: 12, marginBottom: 6 } }, t.meterTitle),
        bar,
        legend,
        readout,
        unknownEngines,
      );
    }

    // The Custom Arguments panel: a three-column table of key/value rows the
    // user fills with extra launch flags, plus the + / - controls. The rows
    // live in the draft config's `customArgs` field, so a Save persists them
    // and the next engine launch appends them to the command line. The panel
    // is a pure draw of the rows; the +/- actions ride in as a callback so the
    // row edits stay in the card's draft, not the panel.
    //
    // The first row is the permanent row: its "-" clears the key and value
    // (it never disappears, so the table always has at least one row). A lower
    // row's "-" removes that row entirely. Every row's "+" appends a fresh row.
    function renderCustomArgsPanel(react, primitives, args, onCustomArgs, t, help) {
      // Always show at least one row: an empty (or absent) customArgs reads as a
      // single blank row the user can fill.
      var rows =
        args && args.length > 0
          ? args
          : [{ key: '', value: '' }];
      var body = rows.map(function (arg, index) {
        var key = arg && typeof arg.key === 'string' ? arg.key : '';
        var value = arg && typeof arg.value === 'string' ? arg.value : '';
        var isFirst = index === 0;
        return react.createElement(
          'div',
          { key: 'arg-row-' + index, style: { display: 'contents' } },
          react.createElement('input', {
            type: 'text',
            style: INPUT_STYLE,
            value: key,
            placeholder: t.customArgKeyPlaceholder,
            'aria-label': t.customArgKeyHeader,
            onChange: function (event) {
              onCustomArgs('key', index, event.target.value);
            },
          }),
          react.createElement('input', {
            type: 'text',
            style: INPUT_STYLE,
            value: value,
            placeholder: t.customArgValuePlaceholder,
            'aria-label': t.customArgValueHeader,
            onChange: function (event) {
              onCustomArgs('value', index, event.target.value);
            },
          }),
          react.createElement(
            'div',
            { style: CUSTOM_ARGS_BUTTONS_STYLE },
            renderButton(
              react,
              primitives,
              'ghost',
              {
                type: 'button',
                onClick: function () {
                  onCustomArgs('add');
                },
                'aria-label': t.customArgAdd,
              },
              '+',
            ),
            renderButton(
              react,
              primitives,
              'ghost',
              {
                type: 'button',
                onClick: function () {
                  onCustomArgs(isFirst ? 'clear' : 'remove', index);
                },
                'aria-label': isFirst ? t.customArgClear : t.customArgRemove,
              },
              '-',
            ),
          ),
        );
      });
      return react.createElement(
        'div',
        { style: { marginTop: 8 } },
        react.createElement('div', { style: SECTION_STYLE }, t.customArgsTitle),
        help ? renderHelpRow(react, t.customArgHelp) : null,
        react.createElement(
          'div',
          { style: CUSTOM_ARGS_GRID_STYLE, gridTemplateRows: 'auto' },
          react.createElement('div', { style: CUSTOM_ARGS_HEADER_STYLE }, t.customArgKeyHeader),
          react.createElement('div', { style: CUSTOM_ARGS_HEADER_STYLE }, t.customArgValueHeader),
          react.createElement(
            'div',
            { style: Object.assign({}, CUSTOM_ARGS_HEADER_STYLE, { textAlign: 'right' }) },
            t.customArgAddRemoveHeader,
          ),
          body,
        ),
      );
    }

    // The Get run's output-idle cap. Two minutes without a streamed line
    // reads as a stalled build: the card re-enables Launch while the run
    // keeps streaming in the background.
    var GET_IDLE_MS = 120000;

    // The "System dependencies" panel: the per-dep status list, the copy/paste
    // install block, the Play/Run arrow (only while the trust gate is on),
    // and the "Get" gate that stays disabled until every dep reports
    // satisfied. The actions ride in as callbacks so the panel stays a pure
    // draw of the deps model the /local-infer/deps route returns.
    function renderDepsPanel(react, deps, t, actions, primitives) {
      if (deps === null || deps === undefined) {
        return null;
      }
      // The dep status onto the DSH state semantics the inventory cards use:
      // a satisfied dep is done, a missing one asks attention, a failed one
      // is an error, and an install in flight is the ongoing spinner.
      var stateForStatus = {
        satisfied: 'done',
        missing: 'warning',
        failed: 'error',
        installing: 'ongoing',
      };
      var rows = (deps.deps || []).map((dep) =>
        react.createElement(
          'div',
          { key: dep.id, style: DEPS_ROW_STYLE },
          renderStateDot(react, primitives, stateForStatus[dep.status] || 'idle'),
          react.createElement('span', { style: { fontWeight: 600 } }, dep.id),
          react.createElement(
            'span',
            {
              style: {
                color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
              },
            },
            dep.purpose + (dep.requiresSudo ? ' (sudo)' : ''),
          ),
        ),
      );
      return react.createElement(
        'div',
        { style: { marginTop: 8 } },
        react.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          react.createElement('div', { style: SECTION_STYLE }, t.depsTitle),
          deps.packageManager === null
            ? react.createElement(
                'span',
                {
                  style: {
                    fontSize: 11,
                    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                  },
                },
                t.pmUnknown,
              )
            : null,
        ),
        (deps.deps || []).length > 0
          ? react.createElement('div', null, rows)
          : react.createElement(
              'div',
              { style: { fontSize: 12, opacity: 0.7, marginTop: 4 } },
              t.depsNone,
            ),
        deps.installString
          ? react.createElement(
              'div',
              null,
              react.createElement('pre', { style: INSTALL_BLOCK_STYLE }, deps.installString),
              renderButton(
                react,
                primitives,
                'ghost',
                { onClick: actions.onCopy },
                actions.copyNote ? actions.copyNote : t.copy,
              ),
            )
          : null,
        // The chat-template row: shown while a selected template is missing
        // from the model directory (the auto-download's fallback when the hf
        // CLI is unavailable or the fetch failed). It names the download
        // command so the user can run it by hand.
        deps.chatTemplate
          ? react.createElement(
              'div',
              { style: { marginTop: 8 } },
              react.createElement(
                'div',
                {
                  style: {
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
                  },
                },
                t.templateAbsent,
              ),
              react.createElement(
                'div',
                { style: { fontSize: 12, marginTop: 4 } },
                t.templateInstructions,
              ),
              react.createElement(
                'pre',
                { style: INSTALL_BLOCK_STYLE },
                deps.chatTemplate.downloadCommand,
              ),
            )
          : null,
        react.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
          renderCheckbox(react, primitives, {
            checked: deps.runAllowed === true,
            onChange: actions.onAllowRun,
            label: t.allowRun,
          }),
          deps.runAllowed && !deps.allSatisfied
            ? renderProcessButton(react, primitives, {
                busy: actions.installing === true,
                label: '▶ ' + t.run,
                busyLabel: t.running,
                variant: 'ghost',
                onClick: actions.onRun,
              })
            : null,
          renderProcessButton(react, primitives, {
            busy: actions.getting === true,
            label: t.get,
            busyLabel: t.getting,
            variant: 'primary',
            onClick: actions.onGet,
            disabled: !deps.allSatisfied,
          }),
        ),
        actions.depsNote
          ? react.createElement(
              'div',
              {
                style: {
                  fontSize: 12,
                  marginTop: 4,
                  color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
                },
              },
              actions.depsNote,
            )
          : null,
      );
    }

    // The card. It owns its draft and validation display; the page draws the
    // title, icon, and crumb, and the form drops its staged edits when left.
    function ConfigCard(react, localeRef, primitives) {
      var subscribeLocale = (onChange) => {
        var locale = localeRef && localeRef.current;
        return locale ? locale.subscribe(onChange) : () => {};
      };
      var readLocale = () => {
        var locale = localeRef && localeRef.current;
        return locale ? locale.getSnapshot().active : '';
      };

      return function Card(props) {
        var view = props ? props.view : undefined;
        var t = labels(
          typeof react.useSyncExternalStore === 'function'
            ? react.useSyncExternalStore(subscribeLocale, readLocale)
            : readLocale(),
        );

        var dataState = react.useState(null);
        var draftState = react.useState(null);
        var noteState = react.useState('');
        // The primary button is an action, not a status readout. The label
        // stays "Save" and the in-progress state shows as "Saving..."; a
        // state word on the button (the old "Idle" label) read as a dead
        // control and hid the one thing the card offers.
        var savingState = react.useState(false);
        // The deps panel state. The deps model and its note come from the
        // /local-infer/deps route, which re-probes the host on every fetch,
        // so the "Get" gate always reads the live checkDeps answer.
        var depsState = react.useState(null);
        var installingState = react.useState(false);
        var depsNoteState = react.useState('');
        var copyNoteState = react.useState('');
        // The DSH model registration state. The register and remove actions
        // talk to the /local-infer/register and /local-infer/unregister
        // routes, which upsert the provider entry through the settings seam
        // on the host, so the card only reports the answer it got back.
        var registeringState = react.useState(false);
        var removingState = react.useState(false);
        var registerNoteState = react.useState('');
        var agentDefaultState = react.useState(false);
        // The engine lifecycle state. Launch runs the deploy and the health
        // poll through the /local-infer/launch route; Stop signals the
        // tracked process or container through /local-infer/stop. The note
        // reports the answer the route returned, the way the register note
        // does.
        var launchingState = react.useState(false);
        var stoppingState = react.useState(false);
        // The Get step's state. Get runs the git sync, the dependency plan,
        // and the engine build on the host through /local-infer/get, and the
        // streamed output lands in getLogs (the Logs section shows it while
        // the run is in flight). Launch stays disabled while a Get is in
        // flight; the idle timer re-enables it once GET_IDLE_MS passes with
        // no output, so a silent build never parks the button.
        var gettingState = react.useState(false);
        var getLogsState = react.useState(null);
        var getIdleTimerRef = react.useRef(null);
        // Whether the draft's engine is confirmed running, so the single
        // Launch/Stop control reads as Stop while the engine is up and Launch
        // while it is down, the same toggle the per-entry control does. A
        // healthy launch sets it, a stop clears it.
        var draftRunningState = react.useState(false);
        var lifecycleNoteState = react.useState('');
        // The Auto Rebuild checkbox next to the form's Launch button. Checked
        // by default: a launch runs the git sync (fetch, rebase, rebuild)
        // before spawning the engine. Unchecked, the launch skips the sync and
        // starts the checkout as-is.
        var autoRebuildState = react.useState(true);
        // The model download state. The Download button runs the hf CLI
        // download through the /local-infer/download route, and the note
        // reports the answer the route returned.
        var downloadingState = react.useState(false);
        var downloadNoteState = react.useState('');
        // The chat-template download state. The auto-download (and the manual
        // button) pulls a selected template through the
        // /local-infer/chat-template route; the note reports the answer, and
        // the requested-repos ref keeps a re-render from re-firing a download
        // that is already in flight or already landed.
        var templateDownloadingState = react.useState(false);
        var templateDownloadNoteState = react.useState('');
        var templateRequestedRef = react.useRef({});
        // The help toggle: show the per-field descriptions. The initial value
        // is the default (visible); the summary's stored preference wins on
        // load, and the "?" button flips it through the save route.
        var helpState = react.useState(true);
        // The unsaved-changes flag: any field edit sets it true, and a save,
        // a discard, or loading a provider into the form clears it. The
        // Register button stays disabled while it is true, because a provider
        // must be saved before it can be published as a DSH model.
        var dirtyState = react.useState(false);
        // The provider id the form is editing. null means a new provider (the
        // next Save mints an id and prepends it); a stored id means the next
        // Save updates that entry in place.
        var editingProviderIdState = react.useState(null);
        // The provider id a delete is in flight for, so the Delete button shows
        // its in-progress state and a second click does not fire a second
        // request.
        var deletingProviderIdState = react.useState(null);
        // The provider form mode: 'collapsed' hides the Engine/Model form (the
        // default while entries exist), 'editing' shows it with a stored
        // provider's values, and 'new' shows it ready for a fresh provider.
        // When there are no entries the form is forced to 'new' on render,
        // so the first provider can be entered immediately.
        var providerFormModeState = react.useState('collapsed');
        // The draft values cached when a provider is loaded for editing, so a
        // later "New provider" click restores the in-progress values the form
        // held before the edit, not the edited provider's.
        var cachedDraftState = react.useState(null);
        // The log-file location the card's log-location field edits. Seeded
        // from the summary's stored template on load; a Save persists it.
        var logPathState = react.useState('');
        // The per-entry launch state: a map from provider id to the entry's
        // launch-state-machine state (the rebuild phases 'prereqs', 'download',
        // 'build', 'launch', plus 'running' and 'failed') and the start time a
        // launch began, so a card entry can show its phase label, Stop, or red
        // Logs control. Absent entries read as idle (a plain Launch button).
        var entryLaunchState = react.useState({});
        // The provider statuses the summary last painted, mirrored into a ref
        // so the stop fast-poll reads the value the last fetch settled, not a
        // stale closure.
        var providerStatusRef = react.useRef({});
        // The latest fetchSummary, mirrored into a ref so the stop fast-poll
        // re-fetches through the current callback, not a stale one.
        var fetchSummaryRef = react.useRef(null);
        // The stop fast-poll and deadline timers (per-entry), plus the
        // draft-based stop's poll timer, so an unmount clears them all.
        var stopTimersRef = react.useRef({ poll: null, deadline: null, draftPoll: null });
        var data = dataState[0];
        var draft = draftState[0];
        var note = noteState[0];
        var saving = savingState[0];
        var deps = depsState[0];
        var installing = installingState[0];
        var depsNote = depsNoteState[0];
        var copyNote = copyNoteState[0];
        var registering = registeringState[0];
        var removing = removingState[0];
        var registerNote = registerNoteState[0];
        var agentDefault = agentDefaultState[0];
        var launching = launchingState[0];
        var stopping = stoppingState[0];
        var getting = gettingState[0];
        var getLogs = getLogsState[0];
        var draftRunning = draftRunningState[0];
        var lifecycleNote = lifecycleNoteState[0];
        var autoRebuild = autoRebuildState[0];
        var downloading = downloadingState[0];
        var downloadNote = downloadNoteState[0];
        var templateDownloading = templateDownloadingState[0];
        var templateDownloadNote = templateDownloadNoteState[0];
        var help = helpState[0];
        var dirty = dirtyState[0];
        var editingProviderId = editingProviderIdState[0];
        var deletingProviderId = deletingProviderIdState[0];
        var providerFormMode = providerFormModeState[0];
        var cachedDraft = cachedDraftState[0];
        var logPath = logPathState[0];
        var entryLaunch = entryLaunchState[0];
        // The title-bar Launch/Stop control mirrors the edited provider's
        // per-entry launch state, so the entry's Launch button and the form's
        // control read the same lifecycle (a phase throbber, a Stop when
        // healthy, a red Logs on a failed launch).
        var editedProvider =
          editingProviderId !== null
            ? (data.providers || []).find((provider) => provider.id === editingProviderId)
            : undefined;
        var mirroredStatus =
          editedProvider !== undefined ? (entryLaunch[editedProvider.id] || {}).status : undefined;
        var mirroredPhaseLabel =
          {
            prereqs: t.entryPrereqs,
            download: t.entryDownloading,
            build: t.entryBuilding,
            launch: t.entryLaunching,
            stopping: t.stopping,
          }[mirroredStatus];
        // The no-entries case forces the form into new-provider mode on
        // render: with nothing stored, the form is where the first provider
        // is entered, and the "New provider" control reads as plain text.
        var effectiveProviderFormMode =
          data !== null && (data.providers || []).length === 0
            ? 'new'
            : providerFormMode;
        var timerRef = react.useRef(null);
        // The latest committed draft, mirrored into a ref so the debounced
        // re-price reads the value the user last typed, not a stale closure.
        // The effect runs after each render, so the ref settles before the
        // 300ms timer fires.
        var draftRef = react.useRef(null);
        react.useEffect(() => {
          draftRef.current = draft;
        }, [draft]);

        var fetchSummary = react.useCallback(
          (engine, config) => {
            var params = new URLSearchParams();
            if (engine) params.set('engine', engine);
            if (config) params.set('config', JSON.stringify(config));
            var suffix = params.toString();
            fetch('/local-infer/summary' + (suffix ? '?' + suffix : ''))
              .then((response) =>
                response.json().then((body) => {
                  if (!response.ok) {
                    throw new Error(body.error || '');
                  }
                  return body;
                }),
              )
              .then((next) => {
                dataState[1](next);
                // Mirror the provider statuses the summary painted, so the
                // stop fast-poll reads the latest dot values.
                var statuses = {};
                (next.providers || []).forEach(function (provider) {
                  statuses[provider.id] = provider.status;
                });
                providerStatusRef.current = statuses;
                // The streamed Get buffer yields to the persisted last-run
                // logs the summary now carries, so the Logs section keeps
                // the run's tail without a second copy.
                getLogsState[1](null);
                draftState[1]((current) => {
                  // The summary's platformConfigs is the host-persisted
                  // platform state, while the draft's platform entries are
                  // the unsaved local edits the Engine Directory and Engine
                  // Fork fields carry until Save. A field-level merge keeps
                  // both: the persisted fields surface, and the local edits
                  // survive the re-price refetch a spec field change fires.
                  var mergedPlatform = Object.assign({}, next.platformConfigs || {});
                  if (current !== null && current.platform) {
                    for (var engineId in current.platform) {
                      mergedPlatform[engineId] = Object.assign(
                        {},
                        (next.platformConfigs || {})[engineId] || {},
                        current.platform[engineId],
                      );
                    }
                  }
                  return {
                    engine: next.engineId,
                    config: next.config,
                    platform: mergedPlatform,
                  };
                });
                noteState[1]('');
                // The stored preference wins over the default; a summary that
                // predates the key keeps the descriptions visible.
                helpState[1](next.showHelp !== false);
                // Seed the log-location field from the stored template, so the
                // card shows the path the last launch wrote to.
                if (typeof next.logPath === 'string' && next.logPath !== '') {
                  logPathState[1](next.logPath);
                }
              })
              .catch((error) => {
                noteState[1](t.loadFailed + ': ' + (error && error.message ? error.message : ''));
              });
          },
          [t],
        );

        // Mirror the latest fetchSummary into a ref, so the stop fast-poll
        // re-fetches through the current callback (its deps change with the
        // locale), not a stale closure.
        react.useEffect(() => {
          fetchSummaryRef.current = fetchSummary;
        }, [fetchSummary]);

        // Clear the stop fast-poll and deadline timers on unmount, so a
        // settled or abandoned stop never keeps re-fetching the summary.
        react.useEffect(
          () => () => {
            var timers = stopTimersRef.current;
            if (timers.poll !== null) {
              clearTimeout(timers.poll);
            }
            if (timers.deadline !== null) {
              clearTimeout(timers.deadline);
            }
            if (timers.draftPoll !== null) {
              clearInterval(timers.draftPoll);
            }
          },
          [],
        );

        // The deps panel reads its own route, because it re-probes the host
        // on every fetch (the "Get" gate must read the live checkDeps
        // answer), while the summary re-prices the meter. Both ride the same
        // engine and config, so a field edit refreshes both in one round.
        var fetchDeps = react.useCallback(
          (engine, config) => {
            var params = new URLSearchParams();
            if (engine) params.set('engine', engine);
            if (config) params.set('config', JSON.stringify(config));
            var suffix = params.toString();
            fetch('/local-infer/deps' + (suffix ? '?' + suffix : ''))
              .then((response) =>
                response.json().then((body) => {
                  if (!response.ok) {
                    throw new Error(body.error || '');
                  }
                  return body;
                }),
              )
              .then((model) => {
                depsState[1](model);
              })
              .catch(() => {
                // A host that predates the deps route keeps the card usable,
                // so a fetch failure reads as no panel.
                depsState[1](null);
              });
          },
          [],
        );

        // scheduleReprice resets the re-price timeout on every field change
        // and fetches the summary (the VRAM Est. meter) and the deps panel
        // only after typing pauses, so a fast keystroke stream is one round
        // trip, not one per letter. The ref reads the latest committed draft,
        // so the fetch prices the value the user last typed.
        var scheduleReprice = react.useCallback(() => {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }
          timerRef.current = setTimeout(() => {
            var latest = draftRef.current;
            if (latest === null || latest === undefined) {
              return;
            }
            fetchSummary(latest.engine, latest.config);
            fetchDeps(latest.engine, latest.config);
          }, 300);
        }, [fetchSummary, fetchDeps]);

        var load = react.useCallback(() => {
          fetchSummary(null, null);
          fetchDeps(null, null);
        }, [fetchSummary, fetchDeps]);

        react.useEffect(() => {
          if (data === null && draft === null) {
            load();
          }
        }, [data, draft, load]);

        // A field edit updates the draft config and schedules a debounced
        // re-price of the meter and form gating. The draft update is pure;
        // the re-price (the VRAM Est. visualization) runs only after typing
        // pauses, so a fast keystroke stream is one round trip, not one per
        // letter.
        var onValue = react.useCallback(
          (key, value) => {
            noteState[1]('');
            depsNoteState[1]('');
            lifecycleNoteState[1]('');
            dirtyState[1](true);
            draftState[1]((current) => {
              var config = Object.assign({}, current.config);
              config[key] = value;
              return {
                engine: current.engine,
                config: config,
                platform: current.platform || {},
              };
            });
            scheduleReprice();
          },
          [scheduleReprice],
        );

        // The Model Directory field edit. A valid directory (non-blank, no
        // whitespace) plus an empty model auto-fills the engine's first
        // default model, the "Defaults" special case: the Model field is the
        // model directory plus the default list, and the auto entry is the
        // special case the plan names.
        var onModelDirectory = react.useCallback(
          (value) => {
            var trimmed = value === undefined || value === null ? '' : String(value).trim();
            onValue('modelDirectory', trimmed === '' ? undefined : trimmed);
            var currentModel =
              draft !== null && draft.config && typeof draft.config.model === 'string'
                ? draft.config.model
                : '';
            var firstDefault = (data !== null && data.modelDefaults || [])[0];
            if (
              trimmed !== '' &&
              !/\s/.test(trimmed) &&
              currentModel === '' &&
              firstDefault !== undefined
            ) {
              onValue('model', firstDefault.id);
            }
          },
          [onValue, draft, data],
        );

        // The Download button action: it runs the hf CLI download through the
        // /local-infer/download route for the selected model and directory,
        // then refreshes the summary so the model status row re-checks the
        // directory. The note reports the answer the route returned.
        var onDownload = react.useCallback(
          () => {
            if (draft === null || downloading) {
              return;
            }
            downloadingState[1](true);
            downloadNoteState[1]('');
            // The click writes the "Downloading..." separator, so the run reads
            // as a fresh Logs section that the download appends to.
            startProcessLog(t.downloading);
            fetch('/local-infer/download', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                engine: draft.engine,
                model:
                  typeof draft.config.model === 'string' ? draft.config.model : undefined,
                directory:
                  typeof draft.config.modelDirectory === 'string'
                    ? draft.config.modelDirectory
                    : undefined,
              }),
            })
              .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
              .then(({ ok, body }) => {
                if (ok && body.ok) {
                  downloadNoteState[1](t.downloaded);
                  fetchSummary(draft.engine, draft.config);
                } else {
                  downloadNoteState[1](t.downloadFailed + (body.detail ? ': ' + body.detail : ''));
                }
              })
              .catch((error) => {
                downloadNoteState[1](
                  t.downloadFailed + (error && error.message ? ': ' + error.message : ''),
                );
              })
              .then(() => {
                downloadingState[1](false);
              });
          },
          [draft, downloading, t, fetchSummary, startProcessLog],
        );

        // The chat-template download: pulls the selected template (the
        // draft's chatTemplate value) into the model directory through the
        // /local-infer/chat-template route, so a picked preset works out of
        // the box. The requested-repos ref marks the repo in flight, so the
        // auto-download effect and a manual click do not double-fire.
        var onDownloadTemplate = react.useCallback(
          (repo) => {
            if (draft === null || templateDownloading || repo === '' || repo === undefined) {
              return;
            }
            if (templateRequestedRef.current[repo]) {
              return;
            }
            templateRequestedRef.current[repo] = true;
            templateDownloadingState[1](true);
            templateDownloadNoteState[1]('');
            fetch('/local-infer/chat-template', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                engine: draft.engine,
                template: repo,
                directory:
                  typeof draft.config.modelDirectory === 'string'
                    ? draft.config.modelDirectory
                    : undefined,
              }),
            })
              .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
              .then(({ ok, body }) => {
                if (ok && body.ok) {
                  templateDownloadNoteState[1](t.templateDownloaded);
                  fetchSummary(draft.engine, draft.config);
                } else {
                  templateDownloadNoteState[1](
                    t.templateDownloadFailed + (body.detail ? ': ' + body.detail : ''),
                  );
                  // A failed download clears the mark, so a later retry (the
                  // button, or a re-select) can fire again.
                  templateRequestedRef.current[repo] = false;
                }
              })
              .catch((error) => {
                templateDownloadNoteState[1](
                  t.templateDownloadFailed + (error && error.message ? ': ' + error.message : ''),
                );
                templateRequestedRef.current[repo] = false;
              })
              .then(() => {
                templateDownloadingState[1](false);
              });
          },
          [draft, templateDownloading, t, fetchSummary],
        );

        // The auto-download: when the summary reports a selected template that
        // is absent from the model directory and the hf CLI is available, pull
        // it once so the preset works out of the box. A present template, a
        // missing CLI (the System dependencies box shows the command), or a
        // repo already requested reads as a no-op.
        var chatTemplateRepo =
          data && data.chatTemplateStatus && data.chatTemplateStatus.repo
            ? data.chatTemplateStatus.repo
            : '';
        react.useEffect(() => {
          var status = data && data.chatTemplateStatus;
          if (
            status === null ||
            status === undefined ||
            status.present ||
            !status.hfCli ||
            status.repo === ''
          ) {
            return;
          }
          if (templateRequestedRef.current[status.repo]) {
            return;
          }
          onDownloadTemplate(status.repo);
        }, [chatTemplateRepo]);

        // The help toggle: flip the local state and persist the preference
        // through the save route, so it survives a reload. The save response
        // carries the fresh summary, so the data and the draft resync from
        // the same round trip, the way the allow-run toggle does. The
        // settings-only flag keeps the route from upserting a provider entry,
        // so a toggle never mints a duplicate at the top of the list.
        var onToggleHelp = react.useCallback(
          (next) => {
            if (draft === null) {
              return;
            }
            helpState[1](next);
            fetch('/local-infer/save', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                engine: draft.engine,
                config: draft.config,
                allowRunDeps: deps !== null && deps.runAllowed === true,
                platform: draft.platform || {},
                showHelp: next,
                settingsOnly: true,
              }),
            })
              .then((response) =>
                response.json().then((body) => {
                  if (!response.ok) {
                    throw new Error(body.error || '');
                  }
                  return body;
                }),
              )
              .then((saved) => {
                dataState[1](saved);
                draftState[1]({
                  engine: saved.engineId,
                  config: saved.config,
                  platform: saved.platformConfigs || {},
                });
              })
              .catch((error) => {
                noteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
              });
          },
          [draft, deps, t],
        );

        // A platform field edit updates the per-engine platform config in the
        // draft. The platform config drives the deploy step only, so it does
        // not re-price the meter; it persists on Save.
        var onPlatform = react.useCallback(
          (field, value) => {
            noteState[1]('');
            dirtyState[1](true);
            draftState[1]((current) => {
              var engine = current.engine;
              var enginePlatform = Object.assign({}, (current.platform || {})[engine] || {});
              enginePlatform[field] = value;
              var platform = Object.assign({}, current.platform || {});
              platform[engine] = enginePlatform;
              return { engine: engine, config: current.config, platform: platform };
            });
          },
          [],
        );

        // The Custom Arguments table edits. The rows live in the draft config's
        // `customArgs` field (a list of {key, value}), so a Save persists them
        // and the next engine launch appends them to the command line. The
        // action is 'key'/'value' (edit a row), 'add' (append a row), 'clear'
        // (blank the first row, the permanent one), or 'remove' (drop a lower
        // row). The table always keeps at least one row: removing the last
        // lower row leaves a single blank row, and 'clear' blanks the first.
        var onCustomArgs = react.useCallback(
          (action, index, value) => {
            noteState[1]('');
            dirtyState[1](true);
            draftState[1]((current) => {
              var raw =
                current.config && Array.isArray(current.config.customArgs)
                  ? current.config.customArgs
                  : [];
              var args = raw.map(function (entry) {
                return {
                  key: entry && typeof entry.key === 'string' ? entry.key : '',
                  value: entry && typeof entry.value === 'string' ? entry.value : '',
                };
              });
              if (args.length === 0) {
                args = [{ key: '', value: '' }];
              }
              switch (action) {
                case 'key':
                  args[index] = Object.assign({}, args[index], { key: value });
                  break;
                case 'value':
                  args[index] = Object.assign({}, args[index], { value: value });
                  break;
                case 'add':
                  args = args.concat([{ key: '', value: '' }]);
                  break;
                case 'clear':
                  args[0] = { key: '', value: '' };
                  break;
                case 'remove':
                  args = args.filter(function (_entry, i) {
                    return i !== index;
                  });
                  if (args.length === 0) {
                    args = [{ key: '', value: '' }];
                  }
                  break;
              }
              var config = Object.assign({}, current.config);
              config.customArgs = args;
              return { engine: current.engine, config: config, platform: current.platform || {} };
            });
          },
          [],
        );

        var onEngine = react.useCallback(
          (engine) => {
            noteState[1]('');
            depsNoteState[1]('');
            lifecycleNoteState[1]('');
            dirtyState[1](true);
            draftState[1]((_current) => {
              // The platform config is per-engine, so an engine switch keeps
              // the map and only resets the per-engine parameter config.
              return { engine: engine, config: {}, platform: _current.platform || {} };
            });
            scheduleReprice();
          },
          [scheduleReprice],
        );

        var save = react.useCallback(() => {
          if (draft === null || saving) {
            return;
          }
          savingState[1](true);
          // A save upserts a provider entry: editing an existing provider (a
          // non-null id) updates it in place, a new provider (a null id) mints
          // an id and prepends it to the list, so a Save always adds (or
          // refreshes) a card entry at the top of the provider list.
          fetch('/local-infer/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: editingProviderId || undefined,
              engine: draft.engine,
              config: draft.config,
              allowRunDeps: deps !== null && deps.runAllowed === true,
              platform: draft.platform || {},
              showHelp: help,
              logPath: logPath,
            }),
          })
            .then((response) =>
              response.json().then((body) => {
                if (!response.ok) {
                  throw new Error(body.error || '');
                }
                return body;
              }),
            )
            .then((next) => {
              dataState[1](next);
              draftState[1]({
                engine: next.engineId,
                config: next.config,
                platform: next.platformConfigs || {},
              });
              // The config is now persisted, so the Register gate opens and the
              // provider list (next.providers) reflects the new entry. The form
              // collapses back to the entry list, so the saved provider shows as
              // a card and the "New provider" control is clickable again. The
              // editing provider id clears, so the provider entry's button
              // reverts from Cancel back to Edit, the same rule Discard applies.
              dirtyState[1](false);
              editingProviderIdState[1](null);
              providerFormModeState[1]('collapsed');
              noteState[1](t.saved);
              savingState[1](false);
            })
            .catch((error) => {
              noteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
              savingState[1](false);
            });
        }, [draft, saving, deps, t, help, editingProviderId, logPath]);

        var discard = react.useCallback(() => {
          noteState[1]('');
          depsNoteState[1]('');
          lifecycleNoteState[1]('');
          dirtyState[1](false);
          editingProviderIdState[1](null);
          // Collapse the form back to the provider entry list, the same rule the
          // Save handler applies, so a "New provider" then "Discard" sequence
          // does not leave the form open in 'new' mode.
          providerFormModeState[1]('collapsed');
          load();
        }, [load]);

        // The provider-list actions. Edit loads a stored provider's engine,
        // config, and platform into the form (the next Save updates that entry
        // in place); New resets the form to a fresh provider (the next Save
        // mints an id and prepends it). Both clear the dirty flag, so a
        // freshly-loaded provider reads as saved and the Register gate opens.
        var onEditProvider = react.useCallback(
          (provider) => {
            noteState[1]('');
            depsNoteState[1]('');
            lifecycleNoteState[1]('');
            // Cache the form's current values before loading the provider, so a
            // later "New provider" click restores them instead of the edited
            // provider's.
            cachedDraftState[1](draft);
            editingProviderIdState[1](provider.id);
            dirtyState[1](false);
            draftState[1]({
              engine: provider.engine,
              config: provider.config || {},
              platform: provider.platform ? { [provider.engine]: provider.platform } : {},
            });
            // Show the form with the provider's values, ready for editing.
            providerFormModeState[1]('editing');
            // Re-price the meter and deps panel for the loaded provider's
            // engine, so the readouts match the form the provider filled.
            fetchSummary(provider.engine, provider.config || {});
            fetchDeps(provider.engine, provider.config || {});
          },
          [draft, fetchSummary, fetchDeps],
        );

        // Cancel collapses the editing form back to the provider entry list
        // (the "Edit" button) and discards the provider's staged changes: the
        // form reloads from the stored config, so nothing the user typed in the
        // edit is kept. A no provider is being edited is a no-op.
        var onCancelProvider = react.useCallback(
          (_provider) => {
            noteState[1]('');
            depsNoteState[1]('');
            lifecycleNoteState[1]('');
            dirtyState[1](false);
            editingProviderIdState[1](null);
            providerFormModeState[1](
              (data && data.providers && data.providers.length > 0) ? 'collapsed' : 'new',
            );
            // Discard the staged edit by reloading the stored config, so the
            // form and the readouts return to the last-saved state.
            load();
          },
          [data, load],
        );

        var onNewProvider = react.useCallback(
          () => {
            noteState[1]('');
            editingProviderIdState[1](null);
            dirtyState[1](false);
            // Restore the cached in-progress values (the form state before the
            // last edit); with no cache a fresh provider starts from the
            // current engine and a blank config.
            var next =
              cachedDraft !== null
                ? cachedDraft
                : {
                    engine: draft !== null ? draft.engine : 'ninfer',
                    config: {},
                    platform: draft !== null ? draft.platform || {} : {},
                  };
            draftState[1](next);
            providerFormModeState[1]('new');
            fetchSummary(next.engine, next.config);
            fetchDeps(next.engine, next.config);
          },
          [cachedDraft, draft, fetchSummary, fetchDeps],
        );

        var onDeleteProvider = react.useCallback(
          (providerId) => {
            if (providerId === null || deletingProviderId !== null) {
              return;
            }
            deletingProviderIdState[1](providerId);
            fetch('/local-infer/provider-delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: providerId }),
            })
              .then((response) =>
                response.json().then((body) => {
                  if (!response.ok) {
                    throw new Error(body.error || '');
                  }
                  return body;
                }),
              )
              .then((next) => {
                dataState[1](next);
                // The deleted provider is gone, so stop editing it if the form
                // was showing it, and collapse the form back to the provider
                // entry list (the "New provider" form when the delete leaves
                // no entries), the same rule the Cancel handler applies.
                if (editingProviderId === providerId) {
                  editingProviderIdState[1](null);
                  providerFormModeState[1](
                    next.providers && next.providers.length > 0 ? 'collapsed' : 'new',
                  );
                }
                deletingProviderIdState[1](null);
              })
              .catch((error) => {
                noteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
                deletingProviderIdState[1](null);
              });
          },
          [deletingProviderId, editingProviderId, t],
        );

        // The deps panel actions. Copy hands the install block to the
        // clipboard; the allow-run toggle and the Play/Run arrow talk to the
        // save and install routes, which own the trust gate and the re-check.
        var onCopy = react.useCallback(() => {
          if (deps === null || deps.installString === undefined) {
            return;
          }
          var text = deps.installString;
          var done = (ok) => {
            copyNoteState[1](ok ? t.copied : t.copyFailed);
            setTimeout(() => {
              copyNoteState[1]('');
            }, 2000);
          };
          if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
            navigator.clipboard
              .writeText(text)
              .then(() => {
                done(true);
              })
              .catch(() => {
                done(false);
              });
          } else {
            done(false);
          }
        }, [deps, t]);

        // The allow-run toggle persists the trust gate through the save route.
        // The settings-only flag keeps the route from upserting a provider
        // entry, so a toggle never mints a duplicate at the top of the list.
        var onAllowRun = react.useCallback(
          (checked) => {
            if (draft === null) {
              return;
            }
            fetch('/local-infer/save', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                engine: draft.engine,
                config: draft.config,
                allowRunDeps: checked,
                platform: draft.platform || {},
                showHelp: help,
                settingsOnly: true,
              }),
            })
              .then((response) =>
                response.json().then((body) => {
                  if (!response.ok) {
                    throw new Error(body.error || '');
                  }
                  return body;
                }),
              )
              .then((next) => {
                dataState[1](next);
                fetchDeps(next.engineId, next.config);
              })
              .catch((error) => {
                noteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
              });
          },
          [draft, t, fetchDeps, help],
        );

        var onRun = react.useCallback(() => {
          if (deps === null || draft === null || installing) {
            return;
          }
          installingState[1](true);
          depsNoteState[1]('');
          fetch('/local-infer/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: draft.engine, config: draft.config }),
          })
            .then((response) =>
              response.json().then((body) => ({ ok: response.ok, body: body })),
            )
            .then(({ ok, body }) => {
              if (!ok) {
                depsNoteState[1](body.error || t.installRejected);
                return;
              }
              // The response carries the re-checked deps model, so the gate
              // re-renders from the same re-check the install ran.
              depsState[1](body.deps);
              if (body.result && body.result.ok) {
                depsNoteState[1](t.depsSatisfied);
              } else {
                var failed = (body.result && body.result.results
                  ? body.result.results
                  : []
                ).filter((entry) => entry.status !== 'satisfied');
                depsNoteState[1](
                  failed
                    .map((entry) => entry.id + (entry.detail ? ': ' + entry.detail : ''))
                    .join('; '),
                );
              }
            })
            .catch((error) => {
              depsNoteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
            })
            .then(() => {
              installingState[1](false);
            });
        }, [deps, draft, installing, t]);

        // The Logs-section separator a provider process button writes when
        // clicked: it appends a "--- {{label}}" line to the live Logs buffer
        // (seeding from the persisted last-run logs when no run is in flight),
        // so the new process reads as a fresh section that will append its
        // commands and output to the buffer and the log file. The host route
        // persists the same separator, so it survives a reload.
        var startProcessLog = react.useCallback(
          (label) => {
            getLogsState[1]((current) => {
              var base =
                current !== null ? current : (data !== null && data.lastLogs ? data.lastLogs : '');
              return base + (base === '' ? '' : '\n') + '--- ' + label + '\n';
            });
          },
          [data],
        );

        var onGet = react.useCallback(() => {
          if (deps === null || draft === null || getting) {
            return;
          }
          // "Get" runs the git sync, the dependency plan, and the build on
          // the host through /local-infer/get. The route streams its output;
          // each chunk appends to the Logs section and re-arms the idle
          // timer, and Launch stays disabled until the run finishes, fails,
          // or falls silent for GET_IDLE_MS. The click writes the "Getting..."
          // separator, so the run reads as a fresh Logs section.
          gettingState[1](true);
          depsNoteState[1]('');
          startProcessLog(t.getting);
          var append = (text) => {
            getLogsState[1]((current) => (current === null ? '' : current) + text);
          };
          var armIdle = () => {
            if (getIdleTimerRef.current) {
              clearTimeout(getIdleTimerRef.current);
            }
            // Two minutes without a line reads as a stalled build: release
            // Launch while the run keeps streaming in the background.
            getIdleTimerRef.current = setTimeout(() => {
              gettingState[1](false);
            }, GET_IDLE_MS);
          };
          armIdle();
          var platform = (draft.platform || {})[draft.engine];
          fetch('/local-infer/get', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              engine: draft.engine,
              config: draft.config,
              platform: platform,
            }),
          })
            .then((response) => {
              if (!response.ok) {
                return response.text().then((text) => {
                  throw new Error(text || 'HTTP ' + response.status);
                });
              }
              if (!response.body || typeof response.body.getReader !== 'function') {
                // A host whose response cannot stream: read the whole body.
                return response.text().then((text) => append(text));
              }
              var reader = response.body.getReader();
              var decoder = new TextDecoder();
              var pump = () =>
                reader.read().then(({ done, value }) => {
                  if (done) {
                    return undefined;
                  }
                  append(decoder.decode(value, { stream: true }));
                  armIdle();
                  return pump();
                });
              return pump();
            })
            .catch((error) => {
              append('\n' + t.getFailed + ': ' + (error && error.message ? error.message : '') + '\n');
            })
            .then(() => {
              if (getIdleTimerRef.current) {
                clearTimeout(getIdleTimerRef.current);
                getIdleTimerRef.current = null;
              }
              gettingState[1](false);
              // The route persisted the run as the last logs; the summary
              // re-read hands the Logs section back to the stored value.
              fetchSummary(draft.engine, draft.config);
            });
        }, [deps, draft, getting, data, t, fetchSummary, startProcessLog]);

        var onRegister = react.useCallback(() => {
          if (draft === null || registering) {
            return;
          }
          registeringState[1](true);
          registerNoteState[1]('');
          fetch('/local-infer/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              engine: draft.engine,
              config: draft.config,
              agentDefault: agentDefault,
            }),
          })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
            .then(({ ok, body }) => {
              if (ok && body.entry) {
                registerNoteState[1](
                  t.registered +
                    ' ' +
                    body.entry.modelId +
                    ' as ' +
                    body.entry.providerId,
                );
                // Re-fetch the summary so the registered flag flips to true
                // and the Remove button appears.
                fetchSummary(draft.engine, draft.config);
              } else {
                registerNoteState[1](
                  t.registerFailed + (body.error ? ': ' + body.error : ''),
                );
              }
            })
            .catch((error) => {
              registerNoteState[1](
                t.registerFailed + (error && error.message ? ': ' + error.message : ''),
              );
            })
            .then(() => {
              registeringState[1](false);
            });
        }, [draft, agentDefault, registering, t, fetchSummary]);

        var onUnregister = react.useCallback(() => {
          if (draft === null || removing) {
            return;
          }
          removingState[1](true);
          registerNoteState[1]('');
          // The removal must target the exact entry the register step wrote.
          // Both register and unregister key the provider and model ids off
          // the same config, so sending draft.config here keeps the two in
          // step: the model id resolveModelRow derives is identical to the
          // one the registration published, and the DSH settings row is
          // actually removed.
          fetch('/local-infer/unregister', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: draft.engine, config: draft.config }),
          })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
            .then(({ ok, body }) => {
              if (ok) {
                registerNoteState[1](t.unregistered);
                // Re-fetch the summary so the registered flag flips to false
                // and the Remove button disappears.
                fetchSummary(draft.engine, draft.config);
              } else {
                registerNoteState[1](
                  t.unregisterFailed + (body.error ? ': ' + body.error : ''),
                );
              }
            })
            .catch((error) => {
              registerNoteState[1](
                t.unregisterFailed + (error && error.message ? ': ' + error.message : ''),
              );
            })
            .then(() => {
              removingState[1](false);
            });
        }, [draft, removing, t, fetchSummary]);

        // The engine lifecycle actions. Launch runs the deploy and the health
        // poll through the /local-infer/launch route, and Stop signals the
        // tracked process or container through /local-infer/stop. Both send
        // the card's unsaved Engine Directory / Engine Fork edits (the
        // per-engine platform entry) so a launch uses them without a prior
        // save, the same rule the route's LaunchRequest.platform documents.
        // The note reports the answer the route returned.
        var launchBody = () => {
          var platform = (draft.platform || {})[draft.engine];
          var body = {
            engine: draft.engine,
            config: draft.config,
            platform: platform,
            // The Auto Rebuild checkbox: false skips the git sync (fetch,
            // rebase, rebuild) and launches the checkout as-is. The stop
            // route ignores the key.
            autoRebuild: autoRebuild,
          };
          // The provider entry the draft edits: the route persists the launch
          // record (and the stop's clear) on that entry, so a restart re-links
          // the entry's engine. Absent while the draft is not a provider.
          if (editingProviderId !== null) {
            body.providerId = editingProviderId;
          }
          return JSON.stringify(body);
        };

        var onLaunch = react.useCallback(() => {
          if (draft === null || launching) {
            return;
          }
          launchingState[1](true);
          lifecycleNoteState[1]('');
          // The click writes the "Launching..." separator, so the run reads as
          // a fresh Logs section that the launch appends to.
          startProcessLog(t.launching);
          fetch('/local-infer/launch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: launchBody(),
          })
            // The launch route streams NDJSON (a step event per phase, then a
            // final result event). The main form's control does not show the
            // phase labels, so read the stream and keep only the result event.
            .then(function (response) {
              if (response.body === null || typeof response.body.getReader !== 'function') {
                return response.json().then(function (body) {
                  return { ok: response.ok, result: body };
                });
              }
              var reader = response.body.getReader();
              var decoder = new TextDecoder();
              var buffer = '';
              var resultEvent = null;
              function pump() {
                return reader.read().then(function (chunk) {
                  if (chunk.done) {
                    return { ok: response.ok, result: resultEvent };
                  }
                  buffer += decoder.decode(chunk.value, { stream: true });
                  var lines = buffer.split('\n');
                  buffer = lines.pop();
                  for (var i = 0; i < lines.length; i++) {
                    if (lines[i] === '') {
                      continue;
                    }
                    var event;
                    try {
                      event = JSON.parse(lines[i]);
                    } catch {
                      continue;
                    }
                    if (event.result !== undefined) {
                      resultEvent = event.result;
                    }
                  }
                  return pump();
                });
              }
              return pump();
            })
            .then(({ ok, result: body }) => {
              if (ok && body !== null) {
                if (body.healthy) {
                  lifecycleNoteState[1](
                    t.runningOn + ' ' + (body.plan && body.plan.port ? body.plan.port : ''),
                  );
                  // A healthy launch means the draft's engine is up, so the
                  // single Launch/Stop control reads as Stop from here on.
                  draftRunningState[1](true);
                } else {
                  lifecycleNoteState[1](t.notHealthy + (body.detail ? ': ' + body.detail : ''));
                }
              } else {
                lifecycleNoteState[1](
                  t.launchFailed + (body && body.detail ? ': ' + body.detail : ''),
                );
              }
            })
            .catch((error) => {
              lifecycleNoteState[1](
                t.launchFailed + (error && error.message ? ': ' + error.message : ''),
              );
            })
            .then(() => {
              launchingState[1](false);
              // The route persisted the run's launch command line and engine
              // output as the last logs; the summary re-read hands the Logs
              // section the new run, the same rule the per-entry launch and
              // the Get apply when their run ends.
              fetchSummary(draft.engine, draft.config);
            });
        }, [draft, launching, editingProviderId, autoRebuild, t, fetchSummary, startProcessLog]);

        var onStop = react.useCallback(() => {
          if (draft === null || stopping) {
            return;
          }
          stoppingState[1](true);
          lifecycleNoteState[1]('');
          // Re-fetch the summary on a fast cadence for the duration of the
          // stop action, so the provider's status dot repaints the moment the
          // engine is down, instead of waiting out the host's 5-second
          // process-watch cycle.
          if (stopTimersRef.current.draftPoll === null) {
            stopTimersRef.current.draftPoll = setInterval(function () {
              fetchSummaryRef.current(null, null);
            }, STOP_POLL_MS);
          }
          fetch('/local-infer/stop', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: launchBody(),
          })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
            .then(({ ok, body }) => {
              if (ok) {
                lifecycleNoteState[1](t.stopped);
                // A successful stop means the draft's engine is down, so the
                // single Launch/Stop control reads as Launch from here on.
                draftRunningState[1](false);
              } else {
                lifecycleNoteState[1](t.stopFailed + (body.error ? ': ' + body.error : ''));
              }
            })
            .catch((error) => {
              lifecycleNoteState[1](
                t.stopFailed + (error && error.message ? ': ' + error.message : ''),
              );
            })
            .then(() => {
              stoppingState[1](false);
              if (stopTimersRef.current.draftPoll !== null) {
                clearInterval(stopTimersRef.current.draftPoll);
                stopTimersRef.current.draftPoll = null;
              }
            });
        }, [draft, stopping, editingProviderId, t]);

        // Move one entry through the provider state machine, reading the
        // current entry from the latest map so a late event prices the state it
        // lands on, not a stale one. The per-entry launch and stop both drive
        // the same machine through this one helper, so a transition is never
        // priced twice.
        var moveEntry = react.useCallback((providerId, event) => {
          entryLaunchState[1]((current) => {
            var entry = current[providerId] || { status: 'idle' };
            var next = launchNextState(entry, event);
            return Object.assign({}, current, {
              [providerId]: Object.assign({}, next, { startTime: Date.now() }),
            });
          });
        }, []);

        // The per-entry launch: a card entry's own Launch control drives its
        // own engine, not the form's draft. It starts the launch state machine
        // at the prereqs phase, then reads the launch stream (an NDJSON step
        // event as each phase begins, then a final result event) and drives the
        // machine: each step event advances the phase label (Prereqs,
        // Downloading, Building, Launching), a healthy result settles to
        // running (the control becomes Stop), and a failed result or the
        // health-poll deadline settles to failed (the control becomes a red
        // Logs that opens the entry for editing).
        var onLaunchEntry = react.useCallback(
          (provider) => {
            var prior = entryLaunch[provider.id];
            var status = prior !== undefined ? prior.status : 'idle';
            // A launch in flight (a rebuild phase) or a stop in flight is
            // ignored; a running engine is stopped by its own Stop control,
            // not re-launched.
            if (status !== 'idle' && status !== 'failed') {
              return;
            }
            moveEntry(provider.id, { type: 'start' });
            // The click writes the "Launching..." separator, so the entry's run
            // reads as a fresh Logs section that the launch appends to.
            startProcessLog(t.entryLaunching);
            var move = function (event) {
              moveEntry(provider.id, event);
            };
            // The health-poll deadline: the route's poll runs up to two minutes,
            // so a client-side deadline just past that cap forces a hung launch
            // to the red Logs state. It arms only for the launch phase; the
            // rebuild phases (prereqs, download, build) run as long as they
            // need to, so a slow build never reads as a failure.
            var settled = false;
            var deadline = null;
            var armDeadline = function () {
              if (deadline !== null) {
                return;
              }
              deadline = setTimeout(function () {
                if (settled) {
                  return;
                }
                settled = true;
                move({ type: 'failed' });
              }, LAUNCH_HEALTH_DEADLINE_MS);
            };
            var clearDeadline = function () {
              if (deadline !== null) {
                clearTimeout(deadline);
                deadline = null;
              }
            };
            fetch('/local-infer/launch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                engine: provider.engine,
                config: provider.config || {},
                platform: provider.platform ? { [provider.engine]: provider.platform } : {},
                // The entry's own id: the route persists the launch record on
                // this entry, so a restart re-links the entry's engine.
                providerId: provider.id,
              }),
            })
              .then(function (response) {
                // The launch streams NDJSON: a step event as each phase begins,
                // then a final result event. Read the stream and drive the
                // state machine; a response with no body (a host without
                // streaming) settles straight to failed.
                if (response.body === null || typeof response.body.getReader !== 'function') {
                  settled = true;
                  clearDeadline();
                  move({ type: 'failed' });
                  return Promise.resolve();
                }
                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';
                function pump() {
                  return reader.read().then(function (result) {
                    if (result.done) {
                      // The stream ended without a result event (a host that
                      // cannot stream, a route that broke mid-stream): settle
                      // to failed so the control does not sit on a phase label.
                      if (!settled) {
                        settled = true;
                        clearDeadline();
                        move({ type: 'failed' });
                      }
                      return;
                    }
                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (var i = 0; i < lines.length; i++) {
                      var line = lines[i];
                      if (line === '') {
                        continue;
                      }
                      var event;
                      try {
                        event = JSON.parse(line);
                      } catch {
                        // A malformed line is not a launch event; skip it.
                        continue;
                      }
                      if (event.step !== undefined) {
                        move({ type: 'step', step: event.step });
                        // Arm the deadline only for the launch (health-poll)
                        // step; the rebuild steps run without a timeout.
                        if (event.step === 'launch') {
                          armDeadline();
                        }
                      } else if (event.result !== undefined) {
                        settled = true;
                        clearDeadline();
                        var healthy = event.result.healthy === true;
                        move(healthy ? { type: 'healthy' } : { type: 'failed' });
                        // The provider status dots price the process probe on a
                        // summary fetch, so a launch that turned an engine
                        // healthy re-fetches the summary to repaint the dot
                        // from red to green.
                        fetchSummary(provider.engine, provider.config || {});
                        return;
                      }
                    }
                    return pump();
                  });
                }
                return pump();
              })
              .catch(function () {
                settled = true;
                clearDeadline();
                move({ type: 'failed' });
              });
          },
          [entryLaunch, fetchSummary, startProcessLog, moveEntry],
        );

        // The per-entry stop: a running engine's Stop control moves the
        // provider state machine to stopping (the control shows the throbber,
        // disabled, the same display the launch phases show). For the duration
        // of the stop action the card re-fetches the summary on a fast cadence
        // so the provider's status dot repaints the moment the engine is down,
        // instead of waiting out the host's 5-second process-watch cycle. A
        // provider still running when the 10-second deadline fires settles to
        // the red Logs state (the same path a failed launch takes); the Logs
        // control opens the entry for editing and resets the machine to
        // running, so the control reads as Stop again. The stop clears the
        // launch record on this entry, so a recycled pid cannot re-link it.
        var onStopEntry = react.useCallback(
          (provider) => {
            var prior = entryLaunch[provider.id];
            var priorStatus = prior !== undefined ? prior.status : 'idle';
            // A failed launch reads as Logs, not Stop, so a stop only starts
            // from the other states.
            if (priorStatus === 'failed') {
              return;
            }
            var move = function (event) {
              moveEntry(provider.id, event);
            };
            var clearStopTimers = function () {
              if (stopTimersRef.current.poll !== null) {
                clearTimeout(stopTimersRef.current.poll);
                stopTimersRef.current.poll = null;
              }
              if (stopTimersRef.current.deadline !== null) {
                clearTimeout(stopTimersRef.current.deadline);
                stopTimersRef.current.deadline = null;
              }
            };
            // A second Stop click re-arms the timers, so clear the in-flight
            // ones first, or they would stack and double-settle.
            clearStopTimers();
            move({ type: 'stop' });
            var poll = function () {
              var status = providerStatusRef.current[provider.id];
              if (status !== undefined && status !== 'running') {
                // The provider is no longer running: the stop succeeded.
                move({ type: 'stopped' });
                clearStopTimers();
                return;
              }
              fetchSummaryRef.current(null, null);
              stopTimersRef.current.poll = setTimeout(poll, STOP_POLL_MS);
            };
            stopTimersRef.current.poll = setTimeout(poll, STOP_POLL_MS);
            stopTimersRef.current.deadline = setTimeout(function () {
              // The provider is still running after the deadline: settle to
              // the red Logs state, the same path a failed launch takes.
              clearStopTimers();
              move({ type: 'stopFailed' });
            }, STOP_HEALTH_DEADLINE_MS);
            fetch('/local-infer/stop', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                engine: provider.engine,
                config: provider.config || {},
                platform: provider.platform ? { [provider.engine]: provider.platform } : {},
                // The entry's own id: the stop clears the launch record on
                // this entry, so a recycled pid cannot re-link it.
                providerId: provider.id,
              }),
            })
              .catch(() => {
                /* a stop that fails leaves the entry in its last state; the
                   fast-poll and the deadline settle it */
              });
          },
          [entryLaunch, moveEntry],
        );

        // The per-entry Logs control: opening the logs loads the entry for
        // editing AND resets the launch state machine to idle, so the per-entry
        // control reads as Launch again. The user fixes the config in the form
        // and re-launches from the same entry, instead of being stuck on a
        // non-actionable Logs control.
        var onLogsEntry = react.useCallback(
          (provider) => {
            onEditProvider(provider);
            entryLaunchState[1]((current) => {
              var entry = current[provider.id] || { status: 'idle' };
              var next = launchNextState(entry, { type: 'reset' });
              var map = Object.assign({}, current);
              if (next.status === 'idle') {
                delete map[provider.id];
              } else {
                map[provider.id] = Object.assign({}, next, { startTime: Date.now() });
              }
              return map;
            });
          },
          [onEditProvider],
        );

        if (view === 'summary') {
          return t.subtitle;
        }

        if (data === null || draft === null) {
          return react.createElement(
            'div',
            { style: CARD_STYLE },
            react.createElement('div', null, note ? note + ' ' + t.retry : t.loading),
          );
        }

        var formModel = data.formModel || { sections: [] };
        var hasFields = formModel.sections.some((section) => section.fields.length > 0);
        var inlineWarnings =
          data.warningsModel && data.warningsModel.inline
            ? data.warningsModel.inline
            : {};
        var banner = data.warningsModel && data.warningsModel.banner;

        return react.createElement(
          'div',
          { style: CARD_STYLE },
          // The keyframes the fallback spinner animates with. Injected
          // once per card so a host without the DSH seed still shows a spin.
          react.createElement(
            'style',
            null,
            '@keyframes dsh-local-infer-spin { to { transform: rotate(360deg); } }',
          ),
          // The "unsure" banner: shown at the top of the card when no provider
          // is confirmed running but at least one reads as unsure. The banner
          // offers the message and a read-only text area with bash kill
          // commands for the engine processes the detector saw holding VRAM,
          // so the user can stop a provider launched in another session.
          data.unsureBanner !== null && data.unsureBanner !== undefined
            ? react.createElement(
                'div',
                {
                  style: {
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: 'var(--dsw-alias-surface-secondary, rgba(0,0,0,0.04))',
                    border: '1px solid var(--dsw-alias-stroke-secondary, rgba(0,0,0,0.08))',
                  },
                },
                react.createElement(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: 'var(--dsw-alias-label-primary, rgba(0,0,0,0.8))',
                      whiteSpace: 'pre-line',
                    },
                  },
                  data.unsureBanner.message,
                ),
                data.unsureBanner.killCommands.length > 0
                  ? react.createElement(
                      'textarea',
                      {
                        readOnly: true,
                        value: data.unsureBanner.killCommands.join('\n'),
                        style: {
                          marginTop: 8,
                          width: '100%',
                          minHeight: 48,
                          fontSize: 11,
                          fontFamily: 'var(--dsw-alias-font-mono, monospace)',
                          colorScheme: 'light dark',
                          resize: 'vertical',
                        },
                      },
                    )
                  : null,
              )
            : null,
          // The card header: the section title plus the circular refresh and
          // "?" buttons. The refresh button re-fetches the summary and deps
          // from the host, so the card re-prices after the harness pauses
          // the plugin's routes and re-activates them. The refresh glyph is
          // the primitives seed's IconRefreshOutlineRegular; a host without
          // the seed keeps the native arrow character. The "?" button shows
          // or hides the per-field descriptions; the preference persists
          // through the save route, so it survives a reload.
          react.createElement(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              },
            },
            react.createElement('div', { style: { fontWeight: 600, fontSize: 14 } }, t.section),
            react.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                },
              },
              react.createElement(
                'button',
                {
                  type: 'button',
                  style: HELP_BUTTON_STYLE(false),
                  title: t.refresh,
                  'aria-label': t.refresh,
                  onClick: () => load(),
                },
                primitives && typeof primitives.IconRefreshOutlineRegular === 'function'
                  ? react.createElement(primitives.IconRefreshOutlineRegular, { size: 12 })
                  : '↻',
              ),
              react.createElement(
                'button',
                {
                  type: 'button',
                  style: HELP_BUTTON_STYLE(help),
                  title: t.helpToggle,
                  'aria-label': t.helpToggle,
                  'aria-pressed': help,
                  onClick: () => onToggleHelp(!help),
                },
                '?',
              ),
            ),
          ),
          // The provider list: the saved provider entries, each a collapsed
          // card with a status dot and Edit/Delete controls. Edit loads a
          // provider into the form below; New resets the form to a fresh
          // entry; Delete removes it through the provider-delete route.
          // The list only renders while there are entries; with none, the
          // form below (forced into new mode) is the entry point.
          (data.providers || []).length > 0
            ? renderProviderList(react, primitives, data.providers || [], {
                onEdit: onEditProvider,
                onCancel: onCancelProvider,
                editingId: editingProviderId,
                onDelete: onDeleteProvider,
                deletingId: deletingProviderId,
                engines: data.engines || [],
                modelAuto: t.modelAuto,
                statusRunning: t.statusRunning,
                statusStopped: t.statusStopped,
                statusUnsure: t.statusUnsure,
                editLabel: t.edit,
                cancelLabel: t.cancel,
                deleteLabel: t.delete,
                launchState: entryLaunch,
                onLaunchEntry: onLaunchEntry,
                onStopEntry: onStopEntry,
                onLogs: onLogsEntry,
                launchLabel: t.entryLaunch,
                stopLabel: t.entryStop,
                stoppingLabel: t.stopping,
                logsLabel: t.entryLogs,
                launchingLabel: t.entryLaunching,
                prereqsLabel: t.entryPrereqs,
                downloadingLabel: t.entryDownloading,
                buildingLabel: t.entryBuilding,
              })
            : null,
          // The provider form: the Engine/Model config the card prices. It is
          // collapsed by default while entries exist, and shown only in
          // editing or new mode (with a stored provider's values, or a fresh
          // one), sitting before the "New provider" control.
          effectiveProviderFormMode !== 'collapsed'
            ? react.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column' } },
                react.createElement(
                  'div',
                  { style: ROW_STYLE },
                  react.createElement('label', { style: LABEL_STYLE }, t.engine),
            renderSelect(react, primitives, {
              value: draft.engine,
              label:
                (
                  (data.engines || []).find((entry) => entry.id === draft.engine) ||
                  {}
                ).label || draft.engine,
              items: (data.engines || []).map((engine) => ({
                id: engine.id,
                label: engine.label,
              })),
              onSelect: (id) => onEngine(id),
            }),
          ),
          help ? renderHelpRow(react, t.engineHelp) : null,
          // The Model row draws from the default model list plus the
          // directory scan: the defaults are the models the plugin knows how
          // to download, and the model files are the models the user already
          // has in the model directory, launchable as-is. An engine with
          // neither (Strata) carries no row.
          (data.modelDefaults || []).length > 0 || (data.modelFiles || []).length > 0
            ? react.createElement(
                'div',
                null,
                react.createElement(
                  'div',
                  { style: ROW_STYLE },
                  react.createElement('label', { style: LABEL_STYLE }, t.model),
                  (() => {
                    var modelValue =
                      draft.config && typeof draft.config.model === 'string'
                        ? draft.config.model
                        : '';
                    var modelItems = [{ id: '', label: t.modelAuto }]
                      .concat(
                        (data.modelDefaults || []).map((model) => ({
                          id: model.id,
                          label: model.label,
                        })),
                      )
                      .concat(
                        (data.modelFiles || []).map((file) => ({ id: file, label: file })),
                      );
                    return renderSelect(react, primitives, {
                      value: modelValue,
                      label:
                        (modelItems.find((item) => item.id === modelValue) || {}).label ||
                        t.modelAuto,
                      items: modelItems,
                      onSelect: (id) => onValue('model', id === '' ? undefined : id),
                    });
                  })(),
                ),
                help ? renderHelpRow(react, t.modelHelp) : null,
              )
            : null,
          (() => {
            // The build-mode row: the dep plan the panel prices depends on it,
            // and the docker-not-installed guideline reads the same value, so
            // the row stays a config field, not panel-local state.
            var engineEntry = (data.engines || []).find(
              (entry) => entry.id === draft.engine,
            );
            var buildModes = [];
            if (engineEntry && engineEntry.supports.local) buildModes.push('local');
            if (engineEntry && engineEntry.supports.docker) buildModes.push('docker');
            var buildMode =
              typeof draft.config.buildMode === 'string'
                ? draft.config.buildMode
                : buildModes[0] || 'local';
            var buildItems = buildModes.map((mode) => ({
              id: mode,
              label: mode === 'local' ? t.buildLocal : t.buildDocker,
            }));
            return buildModes.length > 0
              ? react.createElement(
                  'div',
                  null,
                  react.createElement(
                    'div',
                    { style: ROW_STYLE },
                    react.createElement('label', { style: LABEL_STYLE }, t.build),
                    renderSelect(react, primitives, {
                      value: buildMode,
                      label:
                        (buildItems.find((item) => item.id === buildMode) || {}).label || buildMode,
                      items: buildItems,
                      onSelect: (id) => onValue('buildMode', id),
                    }),
                  ),
                  help ? renderHelpRow(react, t.buildHelp) : null,
                )
              : null;
          })(),
          // The Model Directory row: the global model download directory
          // (§3.10). The summary seeds it with the plugin's default
          // (~/.dsh/models, created when absent), so the input always shows a
          // real path. A config field the deploy step's model download
          // targets, so it rides the config round trip, not the platform map.
          react.createElement(
            'div',
            null,
            react.createElement(
              'div',
              { style: ROW_STYLE },
              react.createElement('label', { style: LABEL_STYLE }, t.modelDirectory),
              react.createElement(
                'input',
                Object.assign(
                  { style: INPUT_STYLE },
                  {
                    type: 'text',
                    value:
                      typeof (draft.config || {}).modelDirectory === 'string'
                        ? draft.config.modelDirectory
                        : '',
                    placeholder: t.dirPlaceholder,
                    onChange: (event) => onModelDirectory(event.target.value),
                  },
                ),
              ),
            ),
            help ? renderHelpRow(react, t.modelDirHelp) : null,
          ),
          (() => {
            // The model status row: it shows while the selected model is
            // absent from the model directory. With the hf CLI detected it
            // names the download command and offers a Download button that
            // runs it; without the CLI it links the model URL instead.
            var status = data.modelStatus;
            if (status === null || status === undefined || status.present) {
              return null;
            }
            if (status.hfCli) {
              return react.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
                react.createElement(
                  'span',
                  {
                    style: {
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      wordBreak: 'break-all',
                      fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
                    },
                  },
                  t.hfCliDetected + ' ' + status.downloadCommand,
                ),
                renderProcessButton(react, primitives, {
                  busy: downloading === true,
                  label: t.download,
                  busyLabel: t.downloading,
                  variant: 'ghost',
                  onClick: onDownload,
                }),
              );
            }
            return react.createElement(
              'div',
              { style: { fontSize: 12, marginTop: 4 } },
              t.noHfCli + ' ',
              react.createElement(
                'a',
                {
                  href: status.url,
                  target: '_blank',
                  rel: 'noreferrer',
                  style: { color: 'var(--dsw-alias-accent, #0a84ff)' },
                },
                status.url,
              ),
            );
          })(),
          downloadNote !== ''
            ? react.createElement('div', { style: { fontSize: 12 } }, downloadNote)
            : null,
          (() => {
            // The chat-template status row: it shows while the selected
            // template is absent from the model directory. With the hf CLI
            // detected it names the download command and offers a Download
            // button that runs it (the auto-download effect fires it first);
            // without the CLI it shows the command as copyable text, the same
            // command the System dependencies box carries.
            var status = data.chatTemplateStatus;
            if (status === null || status === undefined || status.present) {
              return null;
            }
            return react.createElement(
              'div',
              null,
              react.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
                react.createElement(
                  'span',
                  {
                    style: {
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      wordBreak: 'break-all',
                      fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
                    },
                  },
                  (status.hfCli ? t.hfCliDetected : t.noHfCli) + ' ' + status.downloadCommand,
                ),
                status.hfCli
                  ? renderProcessButton(react, primitives, {
                      busy: templateDownloading === true,
                      label: t.templateDownload,
                      busyLabel: t.templateDownloading,
                      variant: 'ghost',
                      onClick: function () {
                        onDownloadTemplate(status.repo);
                      },
                    })
                  : null,
              ),
              templateDownloadNote !== ''
                ? react.createElement('div', { style: { fontSize: 12 } }, templateDownloadNote)
                : null,
            );
          })(),
          (() => {
            // The Engine platform section: the per-engine Engine Directory and
            // Engine Fork (§3.10) the deploy step's clone/build step consumes.
            // These ride the platform map, not the config, so an engine switch
            // keeps them.
            var enginePlatform = (draft.platform || {})[draft.engine] || {};
            return react.createElement(
              'div',
              null,
              react.createElement('div', { style: SECTION_STYLE }, t.enginePlatform),
              react.createElement(
                'div',
                { style: ROW_STYLE },
                react.createElement('label', { style: LABEL_STYLE }, t.engineDirectory),
                react.createElement(
                  'input',
                  Object.assign(
                    { style: INPUT_STYLE },
                    {
                      type: 'text',
                      value:
                        typeof enginePlatform.engineDirectory === 'string'
                          ? enginePlatform.engineDirectory
                          : '',
                      placeholder: t.dirPlaceholder,
                      onChange: (event) =>
                        onPlatform(
                          'engineDirectory',
                          event.target.value === '' ? undefined : event.target.value,
                        ),
                    },
                  ),
                ),
              ),
              help ? renderHelpRow(react, t.engineDirHelp) : null,
              react.createElement(
                'div',
                { style: ROW_STYLE },
                react.createElement('label', { style: LABEL_STYLE }, t.engineFork),
                react.createElement(
                  'input',
                  Object.assign(
                    { style: INPUT_STYLE },
                    {
                      type: 'text',
                      value:
                        typeof enginePlatform.engineFork === 'string'
                          ? enginePlatform.engineFork
                          : '',
                      placeholder: t.forkPlaceholder,
                      onChange: (event) =>
                        onPlatform(
                          'engineFork',
                          event.target.value === '' ? undefined : event.target.value,
                        ),
                    },
                  ),
                ),
              ),
              help ? renderHelpRow(react, t.engineForkHelp) : null,
              (() => {
                // The build-method-dependent platform fields: local build mode
                // shows the Build commands override, docker build mode shows the
                // Docker tag override. Only one is visible at a time, keyed off
                // the same buildMode the Build row prices. The placeholder seeds
                // the engine's own default (the build step the deploy runs, or the
                // image tag the docker deploy pulls), so an empty field reads as
                // "use the default."
                var engineEntry = (data.engines || []).find(
                  (entry) => entry.id === draft.engine,
                );
                var buildModes = [];
                if (engineEntry && engineEntry.supports.local) buildModes.push('local');
                if (engineEntry && engineEntry.supports.docker) buildModes.push('docker');
                var buildMode =
                  typeof draft.config.buildMode === 'string'
                    ? draft.config.buildMode
                    : buildModes[0] || 'local';
                if (buildMode === 'local') {
                  return react.createElement(
                    'div',
                    null,
                    react.createElement(
                      'div',
                      { style: ROW_STYLE },
                      react.createElement('label', { style: LABEL_STYLE }, t.buildCommands),
                      react.createElement(
                        'input',
                        Object.assign(
                          { style: INPUT_STYLE },
                          {
                            type: 'text',
                            value:
                              typeof enginePlatform.buildCommands === 'string'
                                ? enginePlatform.buildCommands
                                : '',
                            placeholder:
                              engineEntry && engineEntry.defaultBuildCommand
                                ? engineEntry.defaultBuildCommand
                                : '',
                            onChange: (event) =>
                              onPlatform(
                                'buildCommands',
                                event.target.value === '' ? undefined : event.target.value,
                              ),
                          },
                        ),
                      ),
                    ),
                    help ? renderHelpRow(react, t.buildCommandsHelp) : null,
                  );
                }
                if (buildMode === 'docker') {
                  return react.createElement(
                    'div',
                    null,
                    react.createElement(
                      'div',
                      { style: ROW_STYLE },
                      react.createElement('label', { style: LABEL_STYLE }, t.dockerTag),
                      react.createElement(
                        'input',
                        Object.assign(
                          { style: INPUT_STYLE },
                          {
                            type: 'text',
                            value:
                              typeof enginePlatform.dockerTag === 'string'
                                ? enginePlatform.dockerTag
                                : '',
                            placeholder:
                              engineEntry && engineEntry.defaultDockerTag
                                ? engineEntry.defaultDockerTag
                                : '',
                            onChange: (event) =>
                              onPlatform(
                                'dockerTag',
                                event.target.value === '' ? undefined : event.target.value,
                              ),
                          },
                        ),
                      ),
                    ),
                    help ? renderHelpRow(react, t.dockerTagHelp) : null,
                  );
                }
                return null;
              })(),
            );
          })(),
          hasFields
            ? formModel.sections.map((section) =>
                react.createElement(
                  'div',
                  { key: section.group },
                  react.createElement('div', { style: SECTION_STYLE }, section.group),
                  section.fields.map((field) => {
                    // The field value binds to the local draft, not the server
                    // render model, so a typed keystroke shows in the input
                    // immediately. The server model (field.value) resolves the
                    // spec default and only surfaces after the debounced
                    // re-price settles. A key the user has not edited is
                    // absent from the draft, so it falls back to the model.
                    var draftValue = draft.config[field.key];
                    var effectiveField =
                      draftValue !== undefined
                        ? Object.assign({}, field, { value: draftValue })
                        : field;
                    return renderField(
                      react,
                      effectiveField,
                      onValue,
                      inlineWarnings[field.key],
                      primitives,
                      help,
                      t,
                    );
                  }),
                ),
              )
            : react.createElement('div', { style: { fontSize: 12, opacity: 0.7 } }, t.noParameters),
          banner && banner.visible
            ? react.createElement(
                'div',
                {
                  style: WARNING_BANNER_STYLE(
                    banner.level === 'error'
                      ? 'red'
                      : banner.level === 'warn'
                        ? 'amber'
                        : 'neutral',
                  ),
                },
                react.createElement(
                  'div',
                  { style: { fontWeight: 600, marginBottom: 4 } },
                  banner.count +
                    ' ' +
                    (banner.count === 1 ? t.guidelineOne : t.guidelineMany) +
                    ' ' +
                    t.fired,
                ),
                banner.warnings.map((warning) =>
                  react.createElement('div', { key: warning.id }, warning.message),
                ),
              )
            : null,
          renderMeter(react, data.meterModel, t),
          // A not-measured meter with selectable models is a dead end that
          // reads as a bug. The estimator stays not-measured on purpose when
          // several models are registered and none is named, so the card
          // names the next step instead.
          data.meterModel && data.meterModel.source === 'not-measured' &&
          (data.models || []).length > 0 && !draft.config.model
            ? react.createElement(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                  },
                },
                t.measureHint,
              )
            : null,
          data.verdict && (data.verdict.status === 'over' || data.verdict.status === 'tight')
            ? react.createElement(
                'div',
                { style: BANNER_STYLE(data.verdict.status) },
                (data.verdict.status === 'over' ? t.over : t.tight) + ': ' + data.verdict.detail,
              )
            : null,
          // The Custom Arguments table: the extra launch flags the user adds,
          // stored in the draft config's customArgs field and appended to the
          // engine command on the next launch. It sits just before the System
          // dependencies panel, the way the plan places it.
          renderCustomArgsPanel(
            react,
            primitives,
            draft.config ? draft.config.customArgs : null,
            onCustomArgs,
            t,
            help,
          ),
          renderDepsPanel(
            react,
            deps,
            t,
            {
              onCopy: onCopy,
              onAllowRun: onAllowRun,
              onRun: onRun,
              onGet: onGet,
              getting: getting,
              installing: installing,
              copyNote: copyNote,
              depsNote: depsNote,
            },
            primitives,
          ),
          // The Logs section: the last run's captured output in a fixed-height
          // read-only text area (a launch fills it; the card never edits it),
          // and the log-file location the launch writes to. The location field
          // edits the template the route resolves and writes on the next run.
          // While a Get is in flight the streamed buffer wins: the git sync,
          // dependency, and build output appends there as it lands.
          react.createElement(
            'div',
            { style: { marginTop: 8 } },
            react.createElement('div', { style: LABEL_STYLE }, t.logs),
            react.createElement('textarea', {
              style: {
                width: '100%',
                height: 96,
                resize: 'none',
                fontFamily: 'monospace',
                fontSize: 11,
                padding: 6,
                border: '1px solid rgba(127,127,127,0.25)',
                borderRadius: 6,
                color: 'inherit',
                background: 'transparent',
              },
              value: getLogs !== null ? getLogs : data.lastLogs || '',
              readOnly: true,
              'aria-label': t.logs,
            }),
            react.createElement(
              'div',
              { style: ROW_STYLE },
              react.createElement('label', { style: LABEL_STYLE }, t.logLocation),
              react.createElement('input', {
                style: INPUT_STYLE,
                value: logPath,
                onChange: (event) => logPathState[1](event.target.value),
              }),
            ),
          ),
          // The engine lifecycle row: a single Launch/Stop control that
          // toggles like the per-entry control. It reads as Launch while the
          // draft's engine is down, Stop while a healthy launch set draftRunning,
          // and an in-flight spinner (disabled) while a launch or stop is in
          // flight. Launch stays disabled while the deps panel reports a
          // missing host dependency or a Get run is in flight, and re-enables
          // when the build finishes, errors, or falls silent for GET_IDLE_MS.
          // The Auto Rebuild checkbox sits after the control: checked, a
          // launch runs the git sync (fetch, rebase, rebuild) first;
          // unchecked, the launch starts the checkout as-is. The note reports
          // the answer the route returned.
          react.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
            mirroredPhaseLabel !== undefined
              ? renderProcessButton(react, primitives, {
                  busy: true,
                  label: mirroredPhaseLabel,
                  busyLabel: mirroredPhaseLabel,
                  variant: 'ghost',
                  onClick: function () {},
                })
              : mirroredStatus === 'running'
                ? renderButton(react, primitives, 'ghost', {
                    onClick: function () {
                      onStopEntry(editedProvider);
                    },
                  }, t.stop)
                : mirroredStatus === 'failed'
                  ? react.createElement(
                      'button',
                      {
                        type: 'button',
                        onClick: function () {
                          onLogsEntry(editedProvider);
                        },
                        style: Object.assign(
                          { color: 'var(--dsw-alias-label-error, #ff3b30)' },
                          GHOST_BUTTON,
                        ),
                        'aria-label': t.entryLogs,
                      },
                      t.entryLogs,
                    )
                  : renderProcessButton(react, primitives, {
                      busy: launching || stopping,
                      label: draftRunning ? t.stop : t.launch,
                      busyLabel: launching ? t.launching : t.stopping,
                      variant: draftRunning ? 'ghost' : 'primary',
                      // While a provider is being edited, the control drives the
                      // provider state machine (the same entry the title bar
                      // mirrors), so the throbber, the fast-poll, and the
                      // 10-second Logs deadline apply. A fresh provider (no
                      // entry) keeps the draft-based Launch/Stop.
                      onClick: draftRunning
                        ? editedProvider !== undefined
                          ? function () {
                              onStopEntry(editedProvider);
                            }
                          : onStop
                        : editedProvider !== undefined
                          ? function () {
                              onLaunchEntry(editedProvider);
                            }
                          : onLaunch,
                      disabled:
                        !draftRunning &&
                        (getting || (deps !== null && deps.allSatisfied !== true)),
                    }),
            // The Auto Rebuild checkbox: checked, a launch runs the git sync
            // (fetch, rebase, rebuild) before the spawn; unchecked, the
            // launch starts the checkout as-is.
            renderCheckbox(react, primitives, {
              checked: autoRebuild,
              onChange: (next) => autoRebuildState[1](next),
              label: t.autoRebuild,
            }),
          ),
          lifecycleNote
            ? react.createElement('div', { style: { fontSize: 12 } }, lifecycleNote)
            : null,
          // The DSH model row: Register publishes the engine as a DSH model
          // through the settings seam, the checkbox opts the new session
          // default in, and Remove pulls the entry back. The note reports the
          // answer the route returned, so a refused write names its reason.
          react.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
            renderButton(
              react,
              primitives,
              'ghost',
              { onClick: onRegister, disabled: registering || dirty },
              t.register,
            ),
            renderCheckbox(react, primitives, {
              checked: agentDefault,
              onChange: (next) => agentDefaultState[1](next),
              label: t.registerDefault,
            }),
            data !== null && data.registered === true
              ? renderButton(
                  react,
                  primitives,
                  'ghost',
                  { onClick: onUnregister, disabled: removing },
                  t.unregister,
                )
              : null,
          ),
          // While the config is unsaved, the help line names the gate: a
          // provider must be saved before it can register. It rides the same
          // help toggle as the field descriptions, so it hides with them.
          dirty && help ? renderHelpRow(react, t.registerNeedsSave) : null,
          registerNote
            ? react.createElement('div', { style: { fontSize: 12 } }, registerNote)
            : null,
          )
            : null,
          // The "New provider" control: a clickable button while a new
          // provider can be started (entries exist and the form is not already
          // in new mode), plain text while the form is in new mode or there
          // are no entries, since the form is already there to enter one.
          renderNewProviderControl(react, primitives, {
            onNew: onNewProvider,
            label: t.newProvider,
            clickable:
              (data.providers || []).length > 0 &&
              effectiveProviderFormMode !== 'new',
          }),
          react.createElement(
            'div',
            { style: FOOTER_STYLE },
            renderButton(react, primitives, 'ghost', { onClick: discard }, t.discard),
            renderButton(
              react,
              primitives,
              'primary',
              { onClick: save, disabled: saving },
              saving ? t.saving : t.save,
            ),
          ),
          note ? react.createElement('div', { style: { fontSize: 12 } }, note) : null,
        );
      };
    }

    function registerCard(ctx) {
      // Reaching for an undeclared service throws in cordis, so each optional
      // dependency rides a scoped ctx.inject of its own: the closure runs
      // where the service exists and never runs where it does not.
      if (typeof ctx.inject !== 'function') {
        return;
      }

      var localeRef = { current: null };
      ctx.inject(['locale'], (scope) => {
        localeRef.current = scope.locale;
        if (typeof scope.effect === 'function') {
          scope.effect(
            () => () => {
              localeRef.current = null;
            },
            'local-infer: locale handle',
          );
        }
      });

      ctx.inject(['slots'], (scope) => {
        // The card and its route live and die together: with the host route
        // absent (no web profile) a card would only render an error, which is
        // not what a headless profile means. Any response at all proves the
        // route exists; only a 404 or a network failure reads as absent.
        fetch('/local-infer/summary')
          .then((response) => {
            if (response.status === 404) {
              return;
            }
            try {
              mountCard(scope, localeRef);
            } catch (error) {
              console.error(`[local-infer] settings card skipped: ${error}`);
            }
          })
          .catch(() => {});
      });
    }

    function mountCard(ctx, localeRef) {
      var react;
      try {
        react = require('react');
      } catch (error) {
        console.error(`[local-infer] settings card skipped: ${error}`);
        return;
      }
      // The shell seeds the primitives into the frozen platform module table,
      // so the require resolves on every host that serves this page. A host
      // whose table predates the seed (or a loader that cannot materialize
      // it) keeps the native controls: a missing seed is a fallback, not an
      // error, so the card still renders.
      var primitives;
      try {
        primitives = require('@deepseek-ai/dsh-client-ui-primitives');
      } catch {
        primitives = null;
      }
      if (primitives && typeof primitives.Menu !== 'function') {
        primitives = null;
      }
      var Card = ConfigCard(react, localeRef, primitives);
      // slots.inject waits until a slot is declared, so each host fills the one
      // it has and the other wait never fires: from dsh 0.1.6-alpha.2 on hosts
      // declare the Plugins page's, older ones only the Settings one.
      ctx.slots.inject('plugins.bundle.config', function* () {
        yield ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Card);
      });
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register(
          { name: 'settings.plugin.item', id: 'local-infer', key: 'local-infer', order: 41 },
          Card,
        );
      });
    }

    function apply(ctx) {
      registerCard(ctx);
    }

    exports.apply = apply;
    // `slots` and `locale` are both optional, so neither is required here:
    // registerCard takes each on its own scoped inject.
    exports.inject = [];
    return module.exports;
  },
});
