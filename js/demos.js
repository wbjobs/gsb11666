(function () {
  'use strict';

  function preview(title, badge, body, modifier) {
    return '<article class="demo-preview ' + (modifier || '') + '">' +
      '<div class="preview-label"><span>' + title + '</span><span class="mini-badge" data-status="' + badge.status + '">' + badge.label + '</span></div>' +
      body +
    '</article>';
  }

  function buildContainerDemo(stage, feature) {
    var nativeBadge = feature.status === 'supported' ? { status: 'supported', label: '当前可用' } : { status: feature.status, label: feature.status === 'partial' ? '部分' : '不可用' };
    var fallbackBadge = { status: 'supported', label: '稳定降级' };
    stage.innerHTML =
      '<div class="demo-control-row"><label>拖动改变容器宽度 <output>270px</output></label>' +
      '<input class="cq-range" type="range" min="140" max="320" value="270" aria-label="容器宽度"></div>' +
      '<div class="compare-pair">' +
        preview('原生 @container', nativeBadge,
          '<div class="cq-wrap cq-native"><div class="cq-card"><div><strong>容器查询布局</strong><small>宽度 ≥230px 时自动增强</small></div></div></div>') +
        preview('ResizeObserver 降级', fallbackBadge,
          '<div class="cq-wrap cq-fallback" data-width="wide"><div class="cq-card"><div><strong>JS 观测布局</strong><small>读取容器宽度后切换 data-width</small></div></div></div>') +
      '</div>' +
      '<p class="demo-note">两种方案都基于容器宽度，而不是视口宽度，保证布局意图一致。</p>';

    var range = stage.querySelector('.cq-range');
    var output = stage.querySelector('output');
    var wraps = stage.querySelectorAll('.cq-wrap');
    var fallback = stage.querySelector('.cq-fallback');

    function syncFallback() {
      fallback.dataset.width = fallback.offsetWidth >= 230 ? 'wide' : 'narrow';
    }

    function update() {
      output.textContent = range.value + 'px';
      wraps.forEach(function (wrap) { wrap.style.width = range.value + 'px'; });
      syncFallback();
    }

    if ('ResizeObserver' in window) {
      var observer = new ResizeObserver(syncFallback);
      observer.observe(fallback);
      range.addEventListener('input', update);
      update();
      return function () { observer.disconnect(); };
    }

    range.addEventListener('input', update);
    update();
    return function () {};
  }

  function buildSubgridDemo(stage, feature) {
    var badge = feature.status === 'supported' ? { status: 'supported', label: '当前可用' } : { status: feature.status, label: feature.status === 'partial' ? '部分' : '不可用' };
    stage.innerHTML =
      '<div class="compare-pair">' +
        preview('原生 subgrid', badge,
          '<div class="subgrid-demo"><div class="subgrid-track"></div><div class="subgrid-native"><span class="box">1</span><span class="box">2</span></div><div class="subgrid-track"></div></div>') +
        preview('显式轨道降级', { status: 'supported', label: '稳定降级' },
          '<div class="subgrid-demo"><div class="subgrid-track"></div><div class="subgrid-fallback"><span class="box">1</span><span class="box">2</span></div><div class="subgrid-track"></div></div>') +
      '</div>' +
      '<p class="demo-note">若子元素不能继承父轨道，降级为固定/重复轨道，并通过变量或 CSS Grid 类保持间距一致。</p>';
    return function () {};
  }

  function buildColorDemo(stage, feature) {
    var badge = feature.status === 'supported' ? { status: 'supported', label: '当前可用' } : { status: feature.status, label: feature.status === 'partial' ? '部分' : '不可用' };
    var swatches = function (prefix) {
      return '<div class="color-demo ' + prefix + '"><div class="swatch-row">' +
        '<div class="color-swatch sw1">oklch</div><div class="color-swatch sw2">mix</div>' +
        '<div class="color-swatch sw3">relative</div><div class="color-swatch sw4">lab</div>' +
      '</div><div class="color-formula">先声明十六进制/RGB，再声明现代颜色；旧浏览器自动忽略不认识的层。</div></div>';
    };
    stage.innerHTML =
      '<div class="compare-pair">' +
        preview('现代颜色函数', badge, swatches('color-native')) +
        preview('静态色值降级', { status: 'supported', label: '稳定降级' }, swatches('color-fallback')) +
      '</div>';
    return function () {};
  }

  function buildLogicalDemo(stage, feature) {
    var badge = feature.status === 'supported' ? { status: 'supported', label: '当前可用' } : { status: feature.status, label: feature.status === 'partial' ? '部分' : '不可用' };
    var body = function (prefix, text) {
      return '<div class="logical-demo"><div class="logical-box ' + prefix + '">' + text + '</div></div>';
    };
    stage.innerHTML =
      '<button class="button direction-toggle" type="button">切换 LTR / RTL</button>' +
      '<div class="compare-pair">' +
        preview('逻辑属性', badge, body('logical-native', '边距、内边距和边框跟随书写方向')) +
        preview('物理属性 + RTL 覆盖', { status: 'supported', label: '稳定降级' }, body('logical-fallback', '为 RTL 单独覆盖 left/right')) +
      '</div>';
    var button = stage.querySelector('.direction-toggle');
    button.addEventListener('click', function () {
      stage.querySelectorAll('.logical-demo').forEach(function (demo) {
        demo.dataset.direction = demo.dataset.direction === 'rtl' ? 'ltr' : 'rtl';
      });
    });
    return function () {};
  }

  function buildScrollDemo(stage, feature, rerunTrigger) {
    var badge = feature.status === 'supported' ? { status: 'supported', label: '当前可用' } : { status: feature.status, label: feature.status === 'partial' ? '部分/已降级' : '不可用' };
    var body = function (prefix) {
      return '<div class="scroll-demo"><div class="scroll-viewport ' + prefix + '"><div class="scroll-progress"></div><div class="scroll-track"></div></div>' +
        '<p class="scroll-scrollbar-note">滚动测试区域：' + (prefix === 'scroll-native' ? '动画由 scroll() 时间线推进' : '由 scroll 事件计算 transform') + '</p></div>';
    };

    stage.innerHTML =
      '<div class="compare-pair">' +
        preview('animation-timeline: scroll()', badge, body('scroll-native')) +
        preview('scroll 事件 / rAF 降级', { status: 'supported', label: '稳定降级' }, body('scroll-fallback')) +
      '</div>';

    var viewports = stage.querySelectorAll('.scroll-viewport');
    function paintFallback(viewport) {
      if (!viewport.classList.contains('scroll-fallback')) return;
      var progress = viewport.querySelector('.scroll-progress');
      var max = viewport.scrollHeight - viewport.clientHeight;
      progress.style.transform = 'scaleX(' + (max ? viewport.scrollTop / max : 0) + ')';
    }
    viewports.forEach(function (viewport) {
      viewport.addEventListener('scroll', function () { paintFallback(viewport); }, { passive: true });
      paintFallback(viewport);
    });
    rerunTrigger.push(function () {
      viewports.forEach(function (viewport) {
        viewport.scrollTop = 0;
        paintFallback(viewport);
      });
    });
    return function () {};
  }

  function buildViewDemo(stage, feature) {
    var badge = feature.status === 'supported' ? { status: 'supported', label: '当前可用' } : { status: feature.status, label: feature.status === 'partial' ? '部分/已降级' : '不可用' };
    var body = function (prefix) {
      return '<div class="view-demo ' + prefix + '" data-view-theme="light"><div class="view-box"><strong>主题卡片</strong><p>切换主题时，原生方案使用 View Transition；降级方案立即更新 DOM，保证状态正确。</p></div><button class="button view-toggle" type="button">切换主题</button></div>';
    };

    stage.innerHTML =
      '<div class="compare-pair">' +
        preview('View Transition API', badge, body('view-native')) +
        preview('即时 DOM 降级', { status: 'supported', label: '稳定降级' }, body('view-fallback')) +
      '</div>';

    function toggleTheme(card, animated) {
      var update = function () {
        card.dataset.viewTheme = card.dataset.viewTheme === 'dark' ? 'light' : 'dark';
      };
      if (animated && typeof document.startViewTransition === 'function' && card.closest('.view-native')) {
        document.startViewTransition(update);
      } else {
        update();
      }
    }

    stage.querySelectorAll('.view-demo').forEach(function (card) {
      card.querySelector('.view-toggle').addEventListener('click', function () {
        toggleTheme(card, feature.status === 'supported');
      });
    });

    return function () {};
  }

  window.CSSDemos = {
    containerQueries: buildContainerDemo,
    subgrid: buildSubgridDemo,
    color: buildColorDemo,
    logical: buildLogicalDemo,
    scroll: buildScrollDemo,
    view: buildViewDemo
  };
}());
