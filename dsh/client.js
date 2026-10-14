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
  id: '@dsh/dsh-plugin-local-infer',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // The Plugins page dispatches a bundle's configuration by npm package name.
    var PACKAGE_NAME = '@dsh/dsh-plugin-local-infer';

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
        launching: 'launching...',
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
        dirPlaceholder: 'directory path',
        forkPlaceholder: 'git repo url',
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
        dirPlaceholder: '目录路径',
        forkPlaceholder: 'git 仓库地址',
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
      overhead: '#f7b84f',
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

    // One rendered field: the control the `control` model names, greyed out
    // with its reason while `disabled` is set, and the inline guideline
    // warnings anchored to the field's key beneath it.
    function renderField(react, field, onValue, inlineWarnings, primitives) {
      var value = field.value;
      var common = {
        key: field.key,
        disabled: field.disabled,
        style: Object.assign({}, INPUT_STYLE, field.disabled ? { opacity: 0.5 } : {}),
      };
      var control = field.control;
      var input;
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
        var numeric = typeof value === 'number' ? value : undefined;
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
                max: control.max !== undefined ? control.max : 100,
                step: control.step !== undefined ? control.step : 1,
                value: numeric !== undefined ? numeric : control.min !== undefined ? control.min : 0,
                onChange: (event) => onValue(field.key, Number(event.target.value)),
              },
            ),
          ),
          react.createElement(NumberField, {
            react: react,
            field: field,
            control: control,
            onValue: onValue,
          }),
          control.unit
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
            : null,
        );
      } else if (control.kind === 'combo') {
        // Dropdown plus free text as one native control: the datalist suggests
        // the known options and the input accepts any value, a local path or
        // an HF repo reference.
        var listId = 'local-infer-combo-' + field.key;
        input = react.createElement(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          react.createElement(
            'input',
            Object.assign({}, common, {
              type: 'text',
              list: listId,
              value: value === undefined || value === null ? '' : String(value),
              placeholder: 'known template, path, or HF repo',
              onChange: (event) => onValue(field.key, event.target.value),
            }),
          ),
          react.createElement(
            'datalist',
            { id: listId },
            (control.options || []).map((option) =>
              react.createElement(
                'option',
                { key: option.value, value: option.value },
                option.note ? option.label + ' · ' + option.note : option.label,
              ),
            ),
          ),
        );
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
      return react.createElement(
        'div',
        { key: field.key, style: { marginTop: 6 } },
        react.createElement(
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
        ),
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
      return react.createElement(
        'div',
        { style: { marginTop: 8 } },
        react.createElement('div', { style: { fontWeight: 600, fontSize: 12, marginBottom: 6 } }, t.meterTitle),
        bar,
        legend,
        readout,
      );
    }

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
        react.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
          renderCheckbox(react, primitives, {
            checked: deps.runAllowed === true,
            onChange: actions.onAllowRun,
            label: t.allowRun,
          }),
          deps.runAllowed && !deps.allSatisfied
            ? renderButton(
                react,
                primitives,
                'ghost',
                { onClick: actions.onRun, disabled: actions.installing },
                actions.installing ? t.running : '▶ ' + t.run,
              )
            : null,
          renderButton(
            react,
            primitives,
            'primary',
            { onClick: actions.onGet, disabled: !deps.allSatisfied },
            t.get,
          ),
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
        var lifecycleNoteState = react.useState('');
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
        var lifecycleNote = lifecycleNoteState[0];
        var timerRef = react.useRef(null);

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
                draftState[1]({
                  engine: next.engineId,
                  config: next.config,
                  platform: next.platformConfigs || {},
                });
                noteState[1]('');
              })
              .catch((error) => {
                noteState[1](t.loadFailed + ': ' + (error && error.message ? error.message : ''));
              });
          },
          [t],
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

        var load = react.useCallback(() => {
          fetchSummary(null, null);
          fetchDeps(null, null);
        }, [fetchSummary, fetchDeps]);

        react.useEffect(() => {
          if (data === null && draft === null) {
            load();
          }
        }, [data, draft, load]);

        // A field edit updates the draft config and re-prices the meter and
        // form gating. Debounced so a slider drag is one round trip, not one
        // per tick.
        var onValue = react.useCallback(
          (key, value) => {
            noteState[1]('');
            depsNoteState[1]('');
            lifecycleNoteState[1]('');
            draftState[1]((current) => {
              var config = Object.assign({}, current.config);
              config[key] = value;
              var next = {
                engine: current.engine,
                config: config,
                platform: current.platform || {},
              };
              if (timerRef.current) {
                clearTimeout(timerRef.current);
              }
              timerRef.current = setTimeout(() => {
                fetchSummary(next.engine, next.config);
                fetchDeps(next.engine, next.config);
              }, 300);
              return next;
            });
          },
          [fetchSummary, fetchDeps],
        );

        // A platform field edit updates the per-engine platform config in the
        // draft. The platform config drives the deploy step only, so it does
        // not re-price the meter; it persists on Save.
        var onPlatform = react.useCallback(
          (field, value) => {
            noteState[1]('');
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

        var onEngine = react.useCallback(
          (engine) => {
            noteState[1]('');
            depsNoteState[1]('');
            lifecycleNoteState[1]('');
            draftState[1]((_current) => {
              // The platform config is per-engine, so an engine switch keeps
              // the map and only resets the per-engine parameter config.
              var next = { engine: engine, config: {}, platform: _current.platform || {} };
              if (timerRef.current) {
                clearTimeout(timerRef.current);
              }
              timerRef.current = setTimeout(() => {
                fetchSummary(next.engine, next.config);
                fetchDeps(next.engine, next.config);
              }, 300);
              return next;
            });
          },
          [fetchSummary, fetchDeps],
        );

        var save = react.useCallback(() => {
          if (draft === null || saving) {
            return;
          }
          savingState[1](true);
          fetch('/local-infer/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              engine: draft.engine,
              config: draft.config,
              allowRunDeps: deps !== null && deps.runAllowed === true,
              platform: draft.platform || {},
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
              noteState[1](t.saved);
              savingState[1](false);
            })
            .catch((error) => {
              noteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
              savingState[1](false);
            });
        }, [draft, saving, deps, t]);

        var discard = react.useCallback(() => {
          noteState[1]('');
          depsNoteState[1]('');
          lifecycleNoteState[1]('');
          load();
        }, [load]);

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
          [draft, t, fetchDeps],
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

        var onGet = react.useCallback(() => {
          if (deps === null || draft === null) {
            return;
          }
          // "Get" is the gate: it re-checks the live dep state, so the button
          // opens only after a re-check passes.
          fetchDeps(draft.engine, draft.config);
          depsNoteState[1](t.depsSatisfied);
        }, [deps, draft, t, fetchDeps]);

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
        }, [draft, agentDefault, registering, t]);

        var onUnregister = react.useCallback(() => {
          if (draft === null || removing) {
            return;
          }
          removingState[1](true);
          registerNoteState[1]('');
          fetch('/local-infer/unregister', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: draft.engine, config: draft.config }),
          })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
            .then(({ ok, body }) => {
              if (ok) {
                registerNoteState[1](t.unregistered);
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
        }, [draft, removing, t]);

        // The engine lifecycle actions. Launch runs the deploy and the health
        // poll through the /local-infer/launch route, and Stop signals the
        // tracked process or container through /local-infer/stop. Both send
        // the card's unsaved Engine Directory / Engine Fork edits (the
        // per-engine platform entry) so a launch uses them without a prior
        // save, the same rule the route's LaunchRequest.platform documents.
        // The note reports the answer the route returned.
        var launchBody = () => {
          var platform = (draft.platform || {})[draft.engine];
          return JSON.stringify({
            engine: draft.engine,
            config: draft.config,
            platform: platform,
          });
        };

        var onLaunch = react.useCallback(() => {
          if (draft === null || launching) {
            return;
          }
          launchingState[1](true);
          lifecycleNoteState[1]('');
          fetch('/local-infer/launch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: launchBody(),
          })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
            .then(({ ok, body }) => {
              if (ok) {
                if (body.healthy) {
                  lifecycleNoteState[1](
                    t.runningOn + ' ' + (body.plan && body.plan.port ? body.plan.port : ''),
                  );
                } else {
                  lifecycleNoteState[1](t.notHealthy + (body.detail ? ': ' + body.detail : ''));
                }
              } else {
                lifecycleNoteState[1](t.launchFailed + (body.error ? ': ' + body.error : ''));
              }
            })
            .catch((error) => {
              lifecycleNoteState[1](
                t.launchFailed + (error && error.message ? ': ' + error.message : ''),
              );
            })
            .then(() => {
              launchingState[1](false);
            });
        }, [draft, launching, t]);

        var onStop = react.useCallback(() => {
          if (draft === null || stopping) {
            return;
          }
          stoppingState[1](true);
          lifecycleNoteState[1]('');
          fetch('/local-infer/stop', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: launchBody(),
          })
            .then((response) => response.json().then((body) => ({ ok: response.ok, body: body })))
            .then(({ ok, body }) => {
              if (ok) {
                lifecycleNoteState[1](t.stopped);
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
            });
        }, [draft, stopping, t]);

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
          react.createElement('div', { style: { fontWeight: 600, fontSize: 14 } }, t.section),
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
          (data.models || []).length > 0
            ? react.createElement(
                'div',
                { style: ROW_STYLE },
                react.createElement('label', { style: LABEL_STYLE }, t.model),
                (() => {
                  var modelValue =
                    draft.config && typeof draft.config.model === 'string'
                      ? draft.config.model
                      : '';
                  var modelItems = [{ id: '', label: t.modelAuto }].concat(
                    data.models.map((model) => ({ id: model.id, label: model.id })),
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
                  { style: ROW_STYLE },
                  react.createElement('label', { style: LABEL_STYLE }, t.build),
                  renderSelect(react, primitives, {
                    value: buildMode,
                    label:
                      (buildItems.find((item) => item.id === buildMode) || {}).label || buildMode,
                    items: buildItems,
                    onSelect: (id) => onValue('buildMode', id),
                  }),
                )
              : null;
          })(),
          // The Model Directory row: the global model download directory
          // (§3.10). A config field the deploy step's model download targets,
          // so it rides the config round trip, not the platform map.
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
                  onChange: (event) =>
                    onValue(
                      'modelDirectory',
                      event.target.value === '' ? undefined : event.target.value,
                    ),
                },
              ),
            ),
          ),
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
            );
          })(),
          hasFields
            ? formModel.sections.map((section) =>
                react.createElement(
                  'div',
                  { key: section.group },
                  react.createElement('div', { style: SECTION_STYLE }, section.group),
                  section.fields.map((field) =>
                    renderField(
                      react,
                      field,
                      onValue,
                      inlineWarnings[field.key],
                      primitives,
                    ),
                  ),
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
          renderDepsPanel(
            react,
            deps,
            t,
            {
              onCopy: onCopy,
              onAllowRun: onAllowRun,
              onRun: onRun,
              onGet: onGet,
              installing: installing,
              copyNote: copyNote,
              depsNote: depsNote,
            },
            primitives,
          ),
          // The engine lifecycle row: Launch runs the deploy and the health
          // poll through the /local-infer/launch route, and Stop signals the
          // tracked process or container through /local-infer/stop. Launch
          // stays disabled while a launch is in flight or while the deps
          // panel reports a missing host dependency, the same gate the panel's
          // "Get" button reads. The note reports the answer the route
          // returned, so a failed deploy names its broken step.
          react.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
            renderButton(
              react,
              primitives,
              'primary',
              {
                onClick: onLaunch,
                disabled:
                  launching || stopping || (deps !== null && deps.allSatisfied !== true),
              },
              launching ? t.launching : t.launch,
            ),
            renderButton(
              react,
              primitives,
              'ghost',
              { onClick: onStop, disabled: stopping || launching },
              stopping ? t.stopping : t.stop,
            ),
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
              { onClick: onRegister, disabled: registering },
              t.register,
            ),
            renderCheckbox(react, primitives, {
              checked: agentDefault,
              onChange: (next) => agentDefaultState[1](next),
              label: t.registerDefault,
            }),
            renderButton(
              react,
              primitives,
              'ghost',
              { onClick: onUnregister, disabled: removing },
              t.unregister,
            ),
          ),
          registerNote
            ? react.createElement('div', { style: { fontSize: 12 } }, registerNote)
            : null,
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
