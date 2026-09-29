(function () {
  'use strict';

  var features = [
    {
      id: 'containerQueries',
      short: '容器查询',
      category: 'Responsive Layout',
      title: '容器查询',
      fallback: 0.88,
      summary: '检测 @container、container-type、命名容器以及查询命中后的真实样式变化。',
      solution: '不支持时用 ResizeObserver 观察组件容器，把宽度断点映射为 data-width；布局 CSS 同样使用移动优先和增强层。',
      code: '.card { display: grid; gap: .5rem; }\n@container (min-width: 230px) {\n  .card { grid-template-columns: 42px 1fr; }\n}\n\n/* 降级：JS 只负责设置容器状态 */\n.wrapper[data-width="wide"] .card {\n  grid-template-columns: 42px 1fr;\n}'
    },
    {
      id: 'subgrid',
      short: '子网格',
      category: 'Grid Alignment',
      title: '子网格',
      fallback: 0.82,
      summary: '检测 subgrid 语法、旧 WebKit 声明以及子网格轨道是否真的继承父轨道几何。',
      solution: '不支持时为嵌套网格显式声明重复轨道，或使用 CSS 变量统一轨道尺寸和 gap。',
      code: '.parent { display: grid; grid-template-columns: 12px 1fr 1fr 12px; }\n.child {\n  display: grid;\n  grid-column: 2 / 4;\n  grid-template-columns: subgrid;\n}\n\n.child {\n  grid-template-columns: 1fr 1fr;\n}'
    },
    {
      id: 'color',
      short: '颜色函数',
      category: 'Modern Color',
      title: '现代颜色函数',
      fallback: 0.92,
      summary: '同时验证 oklch、lab、color-mix 与相对颜色语法的声明接受度和 Canvas 绘制结果。',
      solution: '先写十六进制/RGB 兜底色，再在下一条声明写现代颜色；旧浏览器会丢弃无法解析的层。',
      code: '.surface {\n  background-color: #9ab2f3;\n  background-color: color-mix(in oklch, #3561e8 55%, white);\n  color: #172033;\n  color: oklch(0.24 0.03 255);\n}'
    },
    {
      id: 'logical',
      short: '逻辑属性',
      category: 'Writing Modes',
      title: '逻辑属性',
      fallback: 0.95,
      summary: '检测 margin/padding/border/inset 的 inline 系列、旧 WebKit 别名及 RTL 下的物理映射。',
      solution: '不支持时使用 left/right 物理属性，并用 [dir="rtl"] 或 [data-direction="rtl"] 覆盖。',
      code: '.item {\n  margin-inline-start: 22px;\n  padding-inline: 14px;\n  border-inline-start: 5px solid #3561e8;\n}\n\n[dir="rtl"] .item {\n  margin-right: 22px;\n  border-right: 5px solid #3561e8;\n}'
    },
    {
      id: 'scroll',
      short: '滚动时间线',
      category: 'Scroll-driven Animation',
      title: '滚动时间线',
      fallback: 0.78,
      summary: '检测 animation-timeline: scroll()、ScrollTimeline API、旧 @scroll-timeline 草稿和滚动时的动画推进。',
      solution: '不支持或用户要求减少动态时，用 scroll 事件加 requestAnimationFrame 计算进度；保留 transform 合成动画。',
      code: '.progress { transform: scaleX(var(--progress, 0)); }\n@supports (animation-timeline: scroll()) {\n  .progress {\n    animation: grow linear;\n    animation-timeline: scroll(block);\n  }\n}\n\n/* 降级：scroll/rAF 设置 --progress */'
    },
    {
      id: 'view',
      short: '视图过渡',
      category: 'View Transitions',
      title: '视图过渡',
      fallback: 0.7,
      summary: '检测 SPA API、伪元素树、MPA 规则、回调执行结果以及减少动态效果设置。',
      solution: '不支持时立即执行 DOM 更新；动画是增强层，不应阻塞状态变化或交互反馈。',
      code: 'function changeTheme(update) {\n  if (!document.startViewTransition) {\n    update();\n    return;\n  }\n  document.startViewTransition(update);\n}'
    }
  ];

  var els = {
    cards: document.getElementById('featureCards'),
    template: document.getElementById('featureCardTemplate'),
    state: document.getElementById('detectionState'),
    meta: document.getElementById('environmentMeta'),
    globalMode: document.getElementById('globalMode'),
    canvas: document.getElementById('compareChart'),
    legend: document.getElementById('chartLegend'),
    historyBody: document.getElementById('historyBody'),
    historyEmpty: document.getElementById('historyEmpty'),
    rerun: document.getElementById('rerunDetection'),
    clear: document.getElementById('clearHistory'),
    watch: document.getElementById('watchRuntime')
  };

  var currentResults = {};
  var lastResults = null;
  var modes = loadModes();
  var globalMode = 'auto';
  var cleanup = [];
  var scrollRerun = [];
  var watchEnabled = true;
  var watchTimer = null;
  var runtimeSignature = '';
  var lightweightRuntimeSignature = '';
  var activeRunId = 0;

  var detectorMap = {
    containerQueries: window.CSSFeatureDetectors.detectContainerQueries,
    subgrid: window.CSSFeatureDetectors.detectSubgrid,
    color: window.CSSFeatureDetectors.detectColorFunctions,
    logical: window.CSSFeatureDetectors.detectLogicalProperties,
    scroll: window.CSSFeatureDetectors.detectScrollTimeline,
    view: window.CSSFeatureDetectors.detectViewTransitions
  };


  function capabilityHints() {
    var supports = window.CSSFeatureDetectors.cssSupports;
    return [
      supports('container-type', 'inline-size'),
      supports('grid-template-columns', 'subgrid'),
      supports('background-color', 'oklch(0.7 0.1 250)'),
      supports('background-color', 'color-mix(in oklch, red, white)'),
      supports('margin-inline-start', '10px'),
      supports('animation-timeline', 'scroll()'),
      typeof document.startViewTransition === 'function'
    ].map(function (value) { return value ? '1' : '0'; }).join('');
  }

  function loadModes() {
    try {
      return JSON.parse(localStorage.getItem('css-support-lab-modes') || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveModes() {
    try {
      localStorage.setItem('css-support-lab-modes', JSON.stringify(modes));
    } catch (error) {
      return false;
    }
    return true;
  }

  function text(value) {
    return String(value === undefined || value === null ? '' : value);
  }

  function statusLabel(status) {
    return status === 'supported' ? '完全支持' : status === 'partial' ? '部分支持' : '不支持';
  }

  function statusScore(status) {
    return status === 'supported' ? 1 : status === 'partial' ? 0.48 : 0;
  }

  function effectiveMode(featureId, status) {
    var selected = modes[featureId] || globalMode || 'auto';
    if (selected !== 'auto') return selected;
    return status === 'supported' ? 'native' : 'fallback';
  }

  function parseBrowser() {
    var ua = navigator.userAgent;
    var candidates = [
      ['Edg', 'Microsoft Edge'],
      ['OPR', 'Opera'],
      ['Chrome', 'Chrome/Chromium'],
      ['Firefox', 'Firefox'],
      ['Safari', 'Safari']
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (ua.indexOf(candidates[i][0]) !== -1) return candidates[i][1];
    }
    return '未知浏览器';
  }

  function parseEngine() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Gecko/') !== -1 && ua.indexOf('like Gecko') === -1) return 'Gecko';
    if (ua.indexOf('Edg/') !== -1 || ua.indexOf('Chrome/') !== -1) return 'Blink';
    if (ua.indexOf('Safari/') !== -1 && ua.indexOf('Chrome/') === -1) return 'WebKit';
    return '未知引擎';
  }

  function getEnvironment() {
    var motion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      browser: parseBrowser(),
      engine: parseEngine(),
      language: navigator.language || '未知',
      platform: navigator.platform || navigator.userAgentData && navigator.userAgentData.platform || '未知',
      cssSupports: Boolean(window.CSS && typeof CSS.supports === 'function'),
      indexedDB: 'indexedDB' in window,
      reducedMotion: Boolean(motion),
      online: navigator.onLine,
      devicePixelRatio: window.devicePixelRatio || 1,
      userAgent: navigator.userAgent
    };
  }

  function renderEnvironment(env, error) {
    var entries = [
      ['浏览器/引擎', env.browser + ' · ' + env.engine],
      ['CSS.supports / IndexedDB', (env.cssSupports ? '可用' : '不可用') + ' / ' + (env.indexedDB ? '可用' : '不可用')],
      ['减少动态效果', env.reducedMotion ? '开启，自动降级' : '未开启'],
      ['DPR / 网络', String(env.devicePixelRatio) + ' / ' + (env.online ? '在线' : '离线')]
    ];
    els.meta.innerHTML = entries.map(function (entry) {
      return '<div><dt>' + entry[0] + '</dt><dd>' + entry[1] + '</dd></div>';
    }).join('');
    els.state.dataset.state = error ? 'error' : 'done';
    els.state.textContent = error ? '检测异常' : '检测完成';
  }

  async function runDetection(trigger) {
    var runId = ++activeRunId;
    els.state.dataset.state = 'running';
    els.state.textContent = '正在运行行为探针…';
    cleanup.forEach(function (fn) { try { fn(); } catch (error) {} });
    cleanup = [];
    scrollRerun = [];

    var env = getEnvironment();
    var previous = currentResults;
    var detected = {};
    var errors = [];

    for (var i = 0; i < features.length; i += 1) {
      var feature = features[i];
      if (runId !== activeRunId) return;
      try {
        var result = await detectorMap[feature.id]();
        detected[feature.id] = normalizeResult(feature, result, env);
      } catch (error) {
        errors.push(feature.short + ': ' + error.message);
        detected[feature.id] = fallbackResult(feature, error, env);
      }
    }

    if (runId !== activeRunId) return;
    currentResults = detected;
    var snapshot = makeSnapshot(trigger || 'manual', env, errors);
    var changed = detectChanges(previous, detected);
    if (!lastResults || trigger === 'manual' || trigger === 'rerun' || changed.length) {
      snapshot.changed = changed;
      await window.SupportHistory.add(snapshot);
    }
    lastResults = detected;
    renderEnvironment(env, errors.length);
    renderCards();
    drawChart();
    await renderHistory();
    updateRuntimeSignature(env);
    lightweightRuntimeSignature = lightweightSignature(env);
    if (changed.length && trigger !== 'manual' && trigger !== 'rerun') {
      els.state.textContent = '运行时状态已变化，已重新检测';
    }
  }

  function normalizeResult(feature, result, env) {
    var signals = result.signals || [];
    var corrections = result.corrections || [];

    if (!window.CSS || typeof CSS.supports !== 'function') {
      corrections.unshift('当前环境缺少 CSS.supports；已改用 CSSOM/DOM 行为探针，置信度降低。');
    }

    var hardFail = signals.some(function (signal) {
      return /真实命中|实际对齐|实际推进|回调成功执行|RTL/.test(signal.name) && signal.value === false;
    });
    var status = result.status;
    if (status === 'supported' && hardFail) {
      status = 'partial';
      corrections.unshift('语法层面通过但关键行为探针失败，已自动从“支持”修正为“部分支持”。');
    }
    if (feature.id === 'scroll' && env.reducedMotion && status === 'supported') status = 'partial';
    if (feature.id === 'view' && env.reducedMotion && status === 'supported') status = 'partial';

    return {
      status: status,
      signals: signals,
      corrections: corrections,
      prefixes: result.prefixes || []
    };
  }

  function fallbackResult(feature, error, env) {
    return {
      status: 'partial',
      signals: [{ name: '检测探针执行失败，不武断判定为不支持', value: 'partial' }],
      corrections: ['探针异常：' + error.message + '。页面使用安全降级，开发者可手动强制原生复测。'],
      prefixes: []
    };
  }

  function detectChanges(previous, next) {
    return features
      .filter(function (feature) {
        return previous[feature.id] && previous[feature.id].status !== next[feature.id].status;
      })
      .map(function (feature) {
        return feature.short + ': ' + statusLabel(previous[feature.id].status) + ' → ' + statusLabel(next[feature.id].status);
      });
  }

  function makeSnapshot(trigger, env, errors) {
    return {
      createdAt: Date.now(),
      trigger: trigger,
      browser: env.browser,
      engine: env.engine,
      reducedMotion: env.reducedMotion,
      online: env.online,
      errors: errors,
      results: features.map(function (feature) {
        var result = currentResults[feature.id];
        return {
          id: feature.id,
          name: feature.short,
          status: result.status,
          corrections: result.corrections.length
        };
      })
    };
  }

  function updateRuntimeSignature(env) {
    runtimeSignature = features.map(function (feature) {
      return feature.id + ':' + currentResults[feature.id].status;
    }).join('|') + ':motion:' + env.reducedMotion + ':online:' + env.online;
  }

  function renderCards() {
    els.cards.innerHTML = '';
    features.forEach(function (feature) {
      var result = currentResults[feature.id];
      var node = els.template.content.firstElementChild.cloneNode(true);
      node.dataset.featureId = feature.id;

      node.querySelector('.feature-category').textContent = feature.category;
      node.querySelector('.feature-title').textContent = feature.title;
      node.querySelector('.feature-summary').textContent = feature.summary;

      var badge = node.querySelector('.status-badge');
      badge.dataset.status = result.status;
      badge.textContent = statusLabel(result.status);

      node.querySelector('.signal-list').innerHTML = result.signals.map(function (signal) {
        var value = signal.value === true ? 'true' : signal.value === false ? 'false' : 'partial';
        var marker = value === 'true' ? '通过' : value === 'false' ? '失败' : '部分';
        return '<li><span class="signal-dot" data-value="' + value + '"></span><span><strong>' + marker + '</strong>：' + signal.name + '</span></li>';
      }).join('');

      var correctionBox = node.querySelector('.correction-box');
      if (result.corrections.length) {
        correctionBox.hidden = false;
        correctionBox.innerHTML = '<strong>误判/差异修正</strong>' +
          result.corrections.map(function (item) { return text(item); }).join('<br>');
      }

      node.querySelector('.prefix-row').innerHTML = result.prefixes.map(function (prefix) {
        return '<span class="prefix-chip" data-available="' + Boolean(prefix.available) + '">' +
          (prefix.available ? '✓' : '×') + ' ' + text(prefix.label) + '</span>';
      }).join('');

      var solution = node.querySelector('.solution-content');
      solution.innerHTML = '<div><h4>降级策略</h4><p>' + text(feature.solution) + '</p></div>' +
        '<pre><code></code></pre>';
      solution.querySelector('code').textContent = feature.code;

      renderDemo(node, feature, result);
      updateModeUI(node, feature, result);
      els.cards.appendChild(node);
    });
  }

  function renderDemo(card, feature, result) {
    var stage = card.querySelector('.demo-stage');
    var build = window.CSSDemos[feature.id];
    if (typeof build === 'function') {
      var cleanFn = build(stage, result, scrollRerun);
      if (typeof cleanFn === 'function') cleanup.push(cleanFn);
    }
  }

  function updateModeUI(card, feature, result) {
    result = result || currentResults[feature.id];
    var selected = modes[feature.id] || 'auto';
    var applied = effectiveMode(feature.id, result.status);
    var buttons = card.querySelectorAll('.segmented button');
    buttons.forEach(function (button) {
      var active = button.dataset.mode === selected;
      button.setAttribute('aria-pressed', String(active));
    });
    card.dataset.appliedMode = applied;

    var previews = card.querySelectorAll('.demo-preview');
    if (previews.length >= 2) {
      previews[0].classList.toggle('is-muted', applied !== 'native');
      previews[1].classList.toggle('is-muted', applied !== 'fallback');
      previews[0].classList.toggle('is-risk', applied === 'native' && result.status !== 'supported');
    }

    var labelMap = {
      auto: '自动选择',
      native: '已手动强制原生',
      fallback: '已手动强制降级'
    };
    var note = labelMap[selected] + '，当前实际：' + (applied === 'native' ? '原生方案' : '降级方案');
    if (selected === 'auto' && result.status === 'partial') note += '（部分支持保守降级）';
    card.querySelector('.active-mode-note').textContent = note;
  }

  function setMode(featureId, mode) {
    if (mode === 'auto') delete modes[featureId];
    else modes[featureId] = mode;
    saveModes();
    var card = els.cards.querySelector('[data-feature-id="' + featureId + '"]');
    if (card) updateModeUI(card, features.find(function (feature) { return feature.id === featureId; }), currentResults[featureId]);
  }

  function applyGlobalMode(mode) {
    globalMode = mode;
    if (mode === 'auto') modes = {};
    else {
      features.forEach(function (feature) {
        modes[feature.id] = mode;
      });
    }
    saveModes();
    renderCards();
  }

  function drawChart() {
    var canvas = els.canvas;
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(360 * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var width = rect.width;
    var height = 360;
    var pad = { left: 96, right: 22, top: 22, bottom: 32 };
    var rowHeight = (height - pad.top - pad.bottom) / features.length;
    var barHeight = Math.min(13, rowHeight * 0.24);
    var maxWidth = width - pad.left - pad.right - 120;

    ctx.clearRect(0, 0, width, height);
    ctx.font = '13px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';

    features.forEach(function (feature, index) {
      var result = currentResults[feature.id];
      var y = pad.top + index * rowHeight + rowHeight / 2;
      var nativeScore = statusScore(result.status);
      var fallbackScore = feature.fallback;
      var nativeColor = result.status === 'supported' ? '#16834f' : result.status === 'partial' ? '#c77700' : '#bf3333';

      ctx.fillStyle = '#172033';
      ctx.fillText(feature.short, 0, y - 2);

      drawTrack(ctx, pad.left, y - 12, maxWidth, barHeight);
      drawBar(ctx, pad.left, y - 12, maxWidth * nativeScore, barHeight, nativeColor);
      drawTrack(ctx, pad.left, y + 5, maxWidth, barHeight);
      drawBar(ctx, pad.left, y + 5, maxWidth * fallbackScore, barHeight, '#8ba0c4');

      ctx.fillStyle = '#5d6a7d';
      ctx.fillText(Math.round(nativeScore * 100) + '% / ' + Math.round(fallbackScore * 100) + '%', pad.left + maxWidth + 8, y);
    });

    ctx.fillStyle = '#5d6a7d';
    ctx.font = '12px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText('原生支持 / 降级覆盖', pad.left, height - 10);
  }

  function drawTrack(ctx, x, y, width, height) {
    ctx.fillStyle = '#e8edf5';
    roundedRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
  }

  function drawBar(ctx, x, y, width, height, color) {
    if (width <= 0) return;
    ctx.fillStyle = color;
    roundedRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, height / 2, width / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(value));
  }

  function triggerLabel(trigger) {
    return {
      initial: '首次检测',
      manual: '手动检测',
      rerun: '重新检测',
      runtime: '运行时变化'
    }[trigger] || trigger;
  }

  async function renderHistory() {
    var records = await window.SupportHistory.list();
    els.historyBody.innerHTML = records.map(function (record) {
      var results = (record.results || []).map(function (item) {
        return '<span class="' + item.status + '">' + text(item.name) + ' ' + statusLabel(item.status) + '</span>';
      }).join('');
      var corrections = (record.results || []).reduce(function (sum, item) { return sum + (item.corrections || 0); }, 0);
      var detail = record.changed && record.changed.length ? record.changed.join('；') : (record.errors && record.errors.length ? record.errors.join('；') : '无状态变化');
      return '<tr>' +
        '<td>' + formatTime(record.createdAt) + '</td>' +
        '<td>' + triggerLabel(record.trigger) + (record.fallbackStorage ? '（localStorage）' : '') + '</td>' +
        '<td>' + text(record.browser) + '<br><small>' + text(record.engine) + (record.reducedMotion ? ' · 减少动态' : '') + '</small></td>' +
        '<td><div class="history-results">' + results + '</div></td>' +
        '<td>' + corrections + ' 条</td>' +
        '<td class="history-detail">' + text(detail) + '</td>' +
      '</tr>';
    }).join('');
    els.historyEmpty.hidden = records.length > 0;
  }

  function runtimePoll() {
    if (!watchEnabled || document.visibilityState !== 'visible') return;
    var env = getEnvironment();
    var signature = lightweightSignature(env);
    if (signature !== lightweightRuntimeSignature) runDetection('runtime');
  }

  function startWatcher() {
    if (!('matchMedia' in window)) return;
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var motionHandler = function () { if (watchEnabled) runDetection('runtime'); };
    if (typeof motion.addEventListener === 'function') motion.addEventListener('change', motionHandler);
    else if (typeof motion.addListener === 'function') motion.addListener(motionHandler);

    window.addEventListener('online', function () { if (watchEnabled) runDetection('runtime'); });
    window.addEventListener('offline', function () { if (watchEnabled) runDetection('runtime'); });
    document.addEventListener('visibilitychange', function () {
      if (watchEnabled && document.visibilityState === 'visible') {
        var env = getEnvironment();
        var signature = features.map(function (feature) {
          return feature.id + ':' + currentResults[feature.id].status;
        }).join('|') + ':motion:' + env.reducedMotion + ':online:' + env.online;
        if (signature !== runtimeSignature) runDetection('runtime');
      }
    });

    watchTimer = window.setInterval(runtimePoll, 5000);
  }

  function lightweightSignature(env) {
    env = env || getEnvironment();
    return 'motion:' + env.reducedMotion + ':online:' + env.online + ':dpr:' + env.devicePixelRatio + ':api:' + capabilityHints();
  }

  function setWatchState(enabled) {
    watchEnabled = enabled;
    els.watch.setAttribute('aria-pressed', String(enabled));
    els.watch.textContent = '运行时监视：' + (enabled ? '开' : '关');
    if (!enabled && watchTimer) {
      window.clearInterval(watchTimer);
      watchTimer = null;
    } else if (enabled && !watchTimer) {
      watchTimer = window.setInterval(runtimePoll, 5000);
    }
  }

  function bindEvents() {
    els.rerun.addEventListener('click', function () { runDetection('rerun'); });
    els.clear.addEventListener('click', async function () {
      await window.SupportHistory.clear();
      await renderHistory();
    });
    els.watch.addEventListener('click', function () {
      setWatchState(!watchEnabled);
    });
    els.globalMode.addEventListener('change', function () {
      applyGlobalMode(els.globalMode.value);
    });

    els.cards.addEventListener('click', function (event) {
      var button = event.target.closest('.segmented button');
      if (!button) return;
      var card = event.target.closest('[data-feature-id]');
      setMode(card.dataset.featureId, button.dataset.mode);
    });

    window.addEventListener('resize', function () {
      if (currentResults && Object.keys(currentResults).length) drawChart();
    }, { passive: true });
  }

  function init() {
    bindEvents();
    renderEnvironment(getEnvironment());
    renderHistory();
    startWatcher();
    runDetection('initial');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
