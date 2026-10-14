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
// with a factory returning cordis-plugin exports), so no build step and no
// imports from dsh client packages: the same zero-dependency stance as the
// host half. React comes from the browser module table.
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
        over: 'Over budget',
        tight: 'Fits tightly',
        guidelineOne: 'hardware guideline',
        guidelineMany: 'hardware guidelines',
        fired: 'fired',
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
        over: '超出预算',
        tight: '勉强可容纳',
        guidelineOne: '硬件准则',
        guidelineMany: '硬件准则',
        fired: '触发',
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
    var SEGMENT_COLORS = {
      weights: '#4f8ff7',
      kv: '#34c38f',
      overhead: '#f7b84f',
      workspace: '#b07ff7',
      free: '#d9d9d9',
      reserve: '#bdbdbd',
    };

    var CARD_STYLE = {
      border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
      borderRadius: 12,
      background: 'var(--dsw-alias-background-secondary, rgba(128,128,128,0.06))',
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
    // The input background follows the host theme: a solid #fff fallback
    // painted the dropdowns and text fields as white blocks on the dark
    // Plugins page. The tertiary fill token reads as a subtle field in both
    // themes, and the neutral fallback keeps a host without the token usable.
    var INPUT_STYLE = {
      flex: 1,
      minWidth: 0,
      padding: '4px 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,0.24))',
      background: 'var(--dsw-alias-background-tertiary, rgba(128,128,128,0.12))',
      color: 'inherit',
      font: 'inherit',
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

    // One rendered field: the control the `control` model names, greyed out
    // with its reason while `disabled` is set, and the inline guideline
    // warnings anchored to the field's key beneath it.
    function renderField(react, field, onValue, inlineWarnings) {
      var value = field.value;
      var common = {
        key: field.key,
        disabled: field.disabled,
        style: Object.assign({}, INPUT_STYLE, field.disabled ? { opacity: 0.5 } : {}),
      };
      var control = field.control;
      var input;
      if (control.kind === 'checkbox') {
        input = react.createElement(
          'input',
          Object.assign({}, common, {
            type: 'checkbox',
            checked: value === true,
            onChange: (event) => onValue(field.key, event.target.checked),
          }),
        );
      } else if (control.kind === 'dropdown') {
        input = react.createElement(
          'select',
          Object.assign({}, common, {
            value: value === undefined || value === null ? '' : String(value),
            onChange: (event) => onValue(field.key, event.target.value),
          }),
          react.createElement('option', { value: '' }, '—'),
          (control.options || []).map((option) =>
            react.createElement(
              'option',
              { key: option.value, value: option.value },
              option.note ? option.label + ' · ' + option.note : option.label,
            ),
          ),
        );
      } else if (control.kind === 'slider') {
        var numeric = typeof value === 'number' ? value : undefined;
        input = react.createElement(
          'span',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 } },
          react.createElement('input',
            Object.assign(
              {
                style: { flex: 1, accentColor: 'var(--dsw-alias-accent, #0a84ff)' },
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
          react.createElement(
            'span',
            {
              style: {
                width: 88,
                flex: 'none',
                textAlign: 'right',
                color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))',
              },
            },
            numeric !== undefined ? String(numeric) + (control.unit ? ' ' + control.unit : '') : '—',
          ),
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
                      ' 4px, #9e9e9e 4px, #9e9e9e 8px)'
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
      var readout = react.createElement(
        'div',
        { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))' } },
        react.createElement('span', null, t.largestContext + ': '),
        meter.largestFittingContext !== null
          ? react.createElement('strong', null, String(meter.largestFittingContext) + ' ' + t.tokens)
          : react.createElement('span', null, '—'),
        react.createElement('span', null, '  ·  ' + sourceLabel),
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

    // The card. It owns its draft and validation display; the page draws the
    // title, icon, and crumb, and the form drops its staged edits when left.
    function ConfigCard(react, localeRef) {
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
        var data = dataState[0];
        var draft = draftState[0];
        var note = noteState[0];
        var saving = savingState[0];
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
                draftState[1]({ engine: next.engineId, config: next.config });
                noteState[1]('');
              })
              .catch((error) => {
                noteState[1](t.loadFailed + ': ' + (error && error.message ? error.message : ''));
              });
          },
          [t],
        );

        var load = react.useCallback(() => {
          fetchSummary(null, null);
        }, [fetchSummary]);

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
            draftState[1]((current) => {
              var config = Object.assign({}, current.config);
              config[key] = value;
              var next = { engine: current.engine, config: config };
              if (timerRef.current) {
                clearTimeout(timerRef.current);
              }
              timerRef.current = setTimeout(() => {
                fetchSummary(next.engine, next.config);
              }, 300);
              return next;
            });
          },
          [fetchSummary],
        );

        var onEngine = react.useCallback(
          (engine) => {
            noteState[1]('');
            draftState[1]((_current) => {
              var next = { engine: engine, config: {} };
              if (timerRef.current) {
                clearTimeout(timerRef.current);
              }
              timerRef.current = setTimeout(() => {
                fetchSummary(next.engine, next.config);
              }, 300);
              return next;
            });
          },
          [fetchSummary],
        );

        var save = react.useCallback(() => {
          if (draft === null || saving) {
            return;
          }
          savingState[1](true);
          fetch('/local-infer/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: draft.engine, config: draft.config }),
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
              draftState[1]({ engine: next.engineId, config: next.config });
              noteState[1](t.saved);
              savingState[1](false);
            })
            .catch((error) => {
              noteState[1](t.saveFailed + ': ' + (error && error.message ? error.message : ''));
              savingState[1](false);
            });
        }, [draft, saving, t]);

        var discard = react.useCallback(() => {
          noteState[1]('');
          load();
        }, [load]);

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
            react.createElement(
              'select',
              {
                style: INPUT_STYLE,
                value: draft.engine,
                onChange: (event) => onEngine(event.target.value),
              },
              (data.engines || []).map((engine) =>
                react.createElement('option', { key: engine.id, value: engine.id }, engine.label),
              ),
            ),
          ),
          (data.models || []).length > 0
            ? react.createElement(
                'div',
                { style: ROW_STYLE },
                react.createElement('label', { style: LABEL_STYLE }, t.model),
                react.createElement(
                  'select',
                  {
                    style: INPUT_STYLE,
                    value:
                      draft.config && typeof draft.config.model === 'string' ? draft.config.model : '',
                    onChange: (event) =>
                      onValue('model', event.target.value === '' ? undefined : event.target.value),
                  },
                  react.createElement('option', { value: '' }, t.modelAuto),
                  data.models.map((model) =>
                    react.createElement('option', { key: model.id, value: model.id }, model.id),
                  ),
                ),
              )
            : null,
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
          data.verdict && (data.verdict.status === 'over' || data.verdict.status === 'tight')
            ? react.createElement(
                'div',
                { style: BANNER_STYLE(data.verdict.status) },
                (data.verdict.status === 'over' ? t.over : t.tight) + ': ' + data.verdict.detail,
              )
            : null,
          react.createElement(
            'div',
            { style: FOOTER_STYLE },
            react.createElement('button', { type: 'button', style: GHOST_BUTTON, onClick: discard }, t.discard),
            react.createElement(
              'button',
              { type: 'button', style: PRIMARY_BUTTON, onClick: save, disabled: saving },
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
      var Card = ConfigCard(react, localeRef);
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
