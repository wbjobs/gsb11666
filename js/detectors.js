(function () {
  'use strict';

  function cssSupports(property, value) {
    return Boolean(window.CSS && typeof CSS.supports === 'function' && CSS.supports(property, value));
  }

  function selectorSupports(selector) {
    if (!window.CSS || typeof CSS.supports !== 'function') return false;
    try {
      return CSS.supports('selector(' + selector + ')');
    } catch (error) {
      return false;
    }
  }

  function ruleSupported(ruleText) {
    var style = document.createElement('style');
    style.textContent = ruleText;
    document.documentElement.appendChild(style);
    var supported = false;
    try {
      supported = Boolean(style.sheet && style.sheet.cssRules && style.sheet.cssRules.length > 0);
    } catch (error) {
      supported = false;
    }
    style.remove();
    return supported;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function timeoutAfter(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('probe timeout')); }, ms);
      })
    ]);
  }

  function makeProbe(className, styles, html) {
    var probe = document.createElement('div');
    probe.className = className;
    probe.setAttribute('aria-hidden', 'true');
    probe.setAttribute('data-detection-probe', '');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;pointer-events:none;opacity:0;z-index:-1;';
    probe.innerHTML = html || '<span class="probe-child">probe</span>';
    var style = document.createElement('style');
    style.textContent = styles;
    document.documentElement.appendChild(style);
    document.body.appendChild(probe);
    return {
      element: probe,
      style: style,
      clean: function () {
        probe.remove();
        style.remove();
      }
    };
  }

  function createIframe() {
    return new Promise(function (resolve, reject) {
      var iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:360px;height:220px;border:0;pointer-events:none;opacity:0;z-index:-1;';
      iframe.onload = function () {
        var doc = iframe.contentDocument;
        doc.open();
        doc.write('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;}</style><body></body>');
        doc.close();
        resolve({ iframe: iframe, document: doc, window: iframe.contentWindow });
      };
      iframe.onerror = reject;
      document.body.appendChild(iframe);
    });
  }

  function detectContainerQueries() {
    var token = 'cq' + Date.now();
    var rule = '@container (min-width: 1px) { .' + token + ' .probe-child { color: rgb(1, 2, 3); } }';
    var containerProperty = cssSupports('container-type', 'inline-size');
    var ruleParsed = ruleSupported(rule);

    var probe = makeProbe(
      token,
      '.' + token + '{container-type:inline-size;container-name:' + token + ';}' +
      '@container ' + token + ' (min-width: 1px){.' + token + ' .probe-child{color:rgb(4,5,6);}}',
      '<span class="probe-child">x</span>'
    );

    var matched = false;
    try {
      matched = getComputedStyle(probe.element.firstElementChild).color === 'rgb(4, 5, 6)';
    } finally {
      probe.clean();
    }

    var signals = [
      { name: 'CSS.supports("container-type", "inline-size")', value: containerProperty },
      { name: '@container 规则可被 CSSOM 解析', value: ruleParsed },
      { name: '命名容器查询真实命中元素', value: matched }
    ];
    var corrections = [];
    if (containerProperty && !matched) corrections.push('声明被接受，但命名容器查询没有实际命中，按部分/异常实现处理。');
    if (!containerProperty && ruleParsed) corrections.push('解析器认识 @container，但容器声明不可用，不能视为完整支持。');

    return Promise.resolve({
      status: containerProperty && ruleParsed && matched ? 'supported' : (containerProperty || ruleParsed ? 'partial' : 'unsupported'),
      signals: signals,
      corrections: corrections,
      prefixes: [{ label: '标准属性', available: containerProperty }, { label: '无主流厂商前缀', available: false }]
    });
  }

  function detectSubgrid() {
    var token = 'sg' + Date.now();
    var standard = cssSupports('grid-template-columns', 'subgrid');
    var webkit = cssSupports('-webkit-grid-template-columns', 'subgrid');
    var probe = makeProbe(
      token,
      '.' + token + '{display:grid;grid-template-columns:50px 150px 100px;gap:0;width:300px;}' +
      '.' + token + ' .standard{display:grid;grid-column:2 / 4;grid-template-columns:subgrid;gap:0;}' +
      '.' + token + ' .legacy{display:-ms-grid;-webkit-grid-template-columns:subgrid;}',
      '<div class="nested standard"><span class="a">A</span><span class="b">B</span></div>'
    );
    var nested = probe.element.querySelector('.nested');
    var second = probe.element.querySelector('.b');
    var aligned = false;
    try {
      aligned = standard && Math.abs(second.offsetLeft - 200) < 3 && Math.abs(second.offsetWidth - 100) < 3;
    } finally {
      probe.clean();
    }

    if (standard && !aligned) {
      var retry = makeProbe(
        token + 'b',
        '.' + token + 'b{display:grid;grid-template-columns:50px 150px 100px;gap:0;width:300px;}' +
        '.' + token + 'b .nested{display:grid;grid-column:2 / 4;grid-template-columns:subgrid;gap:0;}',
        '<div class="nested"><span>A</span><span>B</span></div>'
      );
      try {
        var box = retry.element.querySelectorAll('span')[1];
        aligned = Math.abs(box.offsetLeft - 200) < 4 && Math.abs(box.offsetWidth - 100) < 4;
      } finally {
        retry.clean();
      }
    }

    var signals = [
      { name: 'CSS.supports("grid-template-columns", "subgrid")', value: standard },
      { name: '-webkit- 子网格声明', value: webkit },
      { name: '子轨道与父网格轨道实际对齐', value: aligned }
    ];
    var corrections = [];
    if (standard && !aligned) corrections.push('语法探针通过但轨道几何不正确，降级为部分支持，避免只凭 CSS.supports 误判。');

    return Promise.resolve({
      status: standard && aligned ? 'supported' : (standard || webkit ? 'partial' : 'unsupported'),
      signals: signals,
      corrections: corrections,
      prefixes: [
        { label: 'subgrid', available: standard },
        { label: '-webkit-', available: webkit }
      ]
    });
  }

  function canvasAccepts(value) {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#123456';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 2, 2);
    var data = ctx.getImageData(1, 1, 1, 1).data;
    return !(data[0] === 18 && data[1] === 52 && data[2] === 86);
  }


  function computedColorAccepts(value) {
    var probe = document.createElement('div');
    probe.style.backgroundColor = 'rgb(1, 2, 3)';
    probe.style.backgroundColor = value;
    document.body.appendChild(probe);
    var accepted = false;
    try {
      accepted = getComputedStyle(probe).backgroundColor !== 'rgb(1, 2, 3)';
    } finally {
      probe.remove();
    }
    return accepted;
  }

  function detectColorFunctions() {
    var values = {
      oklch: 'oklch(0.72 0.17 250)',
      colorMix: 'color-mix(in oklch, #3561e8 55%, white)',
      relative: 'rgb(from #f05138 r g b / 0.78)',
      lab: 'lab(72% 35 -42)'
    };
    var results = {};
    var corrections = [];
    Object.keys(values).forEach(function (key) {
      var api = cssSupports('background-color', values[key]);
      var computed = computedColorAccepts(values[key]);
      var paint = canvasAccepts(values[key]);
      results[key] = { api: api, computed: computed, paint: paint };
      if (api !== computed) corrections.push(values[key] + ' 的声明探针与计算样式结果不一致，已按行为结果修正。');
      if (api && computed && !paint) corrections.push(values[key] + ' 的 CSS 计算样式有效，但当前 Canvas 解析器存在差异；页面 CSS 不降级，Canvas 可视化另行使用 RGB 色值。');
    });

    var accepted = function (key) { return results[key].api && results[key].computed; };
    var core = accepted('oklch') && accepted('colorMix') && accepted('lab');
    var relative = accepted('relative');
    var any = Object.keys(results).some(function (key) {
      return results[key].api || results[key].computed;
    });

    var signals = [
      { name: 'oklch() 声明与实际绘制', value: accepted('oklch') ? true : (results.oklch.api || results.oklch.computed ? 'partial' : false) },
      { name: 'color-mix(in oklch, ...)', value: accepted('colorMix') ? true : (results.colorMix.api || results.colorMix.computed ? 'partial' : false) },
      { name: 'lab()/lch() 颜色空间', value: accepted('lab') ? true : (results.lab.api || results.lab.computed ? 'partial' : false) },
      { name: '相对颜色语法 rgb(from ...)', value: relative ? true : (results.relative.api || results.relative.computed ? 'partial' : false) }
    ];

    return Promise.resolve({
      status: core && relative ? 'supported' : any ? 'partial' : 'unsupported',
      signals: signals,
      corrections: corrections,
      prefixes: [
        { label: 'oklch', available: accepted('oklch') },
        { label: 'color-mix', available: accepted('colorMix') },
        { label: 'relative syntax', available: relative }
      ]
    });
  }

  function detectLogicalProperties() {
    var token = 'lp' + Date.now();
    var props = [
      ['margin-inline-start', '18px'],
      ['padding-inline-start', '19px'],
      ['border-inline-start-width', '20px'],
      ['inset-inline-start', '21px']
    ];
    var api = props.every(function (entry) { return cssSupports(entry[0], entry[1]); });
    var webkitProps = ['-webkit-margin-start', '-webkit-padding-start', '-webkit-border-start-width'];
    var webkit = webkitProps.every(function (prop) { return cssSupports(prop, '10px'); });

    var probe = makeProbe(
      token,
      '.' + token + '{direction:rtl;position:relative;}' +
      '.' + token + ' .standard{position:absolute;inset-inline-start:23px;margin-inline-start:24px;padding-inline-start:25px;border-inline-start:7px solid #3561e8;}',
      '<span class="standard"></span>'
    );
    var child = probe.element.firstElementChild;
    var rtlBehavior = false;
    try {
      var styles = getComputedStyle(child);
      rtlBehavior = api && styles.marginRight === '24px' && styles.paddingRight === '25px' && styles.borderRightWidth === '7px';
    } finally {
      probe.clean();
    }

    var corrections = [];
    if (api && !rtlBehavior) corrections.push('浏览器接受逻辑属性，但 RTL 下没有映射到正确物理侧，按部分支持处理。');

    return Promise.resolve({
      status: api && rtlBehavior ? 'supported' : (api || webkit ? 'partial' : 'unsupported'),
      signals: [
        { name: 'inline-start 系列标准属性', value: api },
        { name: '旧 WebKit 别名', value: webkit },
        { name: 'RTL 模式写入正确物理侧', value: rtlBehavior }
      ],
      corrections: corrections,
      prefixes: [
        { label: 'margin-inline-start', available: api },
        { label: '-webkit-margin-start', available: webkit }
      ]
    });
  }

  async function detectScrollTimeline() {
    var property = cssSupports('animation-timeline', 'scroll()');
    var standardApi = 'ScrollTimeline' in window;
    var viewApi = 'ViewTimeline' in window;
    var legacyRule = ruleSupported('@scroll-timeline st' + Date.now() + ' { time-range: 1s; }');
    var motionAllowed = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var runtime = false;
    var corrections = [];

    if (property && motionAllowed) {
      var iframeTest = null;
      try {
        iframeTest = await timeoutAfter(createIframe(), 2500);
        var win = iframeTest.window;
        var doc = iframeTest.document;
        var style = doc.createElement('style');
        style.textContent =
          '.scroller{position:relative;height:90px;width:230px;overflow:scroll;}' +
          '.bar{position:sticky;top:0;height:8px;background:#3561e8;transform:scaleX(0);transform-origin:0 50%;animation:grow linear both;animation-timeline:scroll(block);}' +
          '.long{height:1000px;}' +
          '@keyframes grow{from{transform:scaleX(0);}to{transform:scaleX(1);}}';
        doc.body.appendChild(style);
        doc.body.innerHTML = '<div class="scroller"><div class="bar"></div><div class="long"></div></div>';
        doc.body.appendChild(style);
        var scroller = doc.querySelector('.scroller');
        var bar = doc.querySelector('.bar');
        await new Promise(function (resolve) { win.requestAnimationFrame(resolve); });
        var before = win.getComputedStyle(bar).transform;
        scroller.scrollTop = 480;
        scroller.dispatchEvent(new win.Event('scroll'));
        await new Promise(function (resolve) { setTimeout(resolve, 120); });
        var after = win.getComputedStyle(bar).transform;
        runtime = after !== 'none' && before !== after;
      } catch (error) {
        corrections.push('运行时滚动探针超时或不可执行，因此只采用语法/API 结果。');
      } finally {
        if (iframeTest) iframeTest.iframe.remove();
      }
    }

    if (property && !runtime && motionAllowed) corrections.push('animation-timeline 被接受，但隔离滚动容器中的动画值没有随滚动变化，按部分支持处理。');
    if (!motionAllowed) corrections.push('系统启用了“减少动态效果”，页面按可访问性要求降级；滚动驱动动画的行为探针被跳过。');
    if (legacyRule) corrections.push('检测到旧 @scroll-timeline 草稿语法；它与现在的 scroll() 不兼容，需要单独草稿降级。');

    return {
      status: property && runtime && motionAllowed ? 'supported' : (property || standardApi || viewApi || legacyRule ? 'partial' : 'unsupported'),
      signals: [
        { name: 'CSS.supports("animation-timeline", "scroll()")', value: property },
        { name: 'ScrollTimeline / ViewTimeline API', value: standardApi && viewApi ? true : (standardApi || viewApi ? 'partial' : false) },
        { name: '隔离滚动容器中真实推进动画', value: runtime },
        { name: '旧 @scroll-timeline 草稿', value: legacyRule }
      ],
      corrections: corrections,
      prefixes: [
        { label: 'scroll()', available: property },
        { label: 'ScrollTimeline', available: standardApi },
        { label: '@scroll-timeline 草稿', available: legacyRule }
      ]
    };
  }

  async function detectViewTransitions() {
    var api = typeof document.startViewTransition === 'function';
    var pseudo = ruleSupported('::view-transition {color:red;}');
    var oldPseudo = ruleSupported('::view-transition-old(root){color:red;}');
    var mpaRule = ruleSupported('@view-transition {navigation:auto;}');
    var runtime = false;
    var corrections = [];
    var motionAllowed = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (api && motionAllowed) {
      var iframeTest = null;
      try {
        iframeTest = await timeoutAfter(createIframe(), 2500);
        var doc = iframeTest.document;
        var iframeApi = typeof iframeTest.document.startViewTransition === 'function';
        var changed = false;
        var transition = iframeApi ? doc.startViewTransition(function () {
          doc.body.dataset.vtProbe = 'updated';
          changed = true;
        }) : null;
        await wait(70);
        runtime = Boolean(transition) && changed && doc.body.dataset.vtProbe === 'updated';
        if (transition && transition.skipTransition) transition.skipTransition();
      } catch (error) {
        corrections.push('startViewTransition 存在但隔离文档执行抛出异常，按部分支持处理。');
      } finally {
        if (iframeTest) iframeTest.iframe.remove();
      }
    }

    if (api && !pseudo && !oldPseudo) corrections.push('存在 DOM API 但视图过渡伪元素不可用，跨文档/样式能力不完整。');
    if (!api && mpaRule) corrections.push('仅检测到跨文档 @view-transition 规则，不等同于当前 SPA 的 document.startViewTransition。');
    if (!motionAllowed) corrections.push('“减少动态效果”开启时自动禁用视图过渡动画；这是可访问性降级，不代表 API 不存在。');

    return {
      status: api && (pseudo || oldPseudo) && runtime && motionAllowed ? 'supported' : (api || pseudo || oldPseudo || mpaRule ? 'partial' : 'unsupported'),
      signals: [
        { name: 'document.startViewTransition()', value: api },
        { name: '::view-transition 伪元素树', value: pseudo || oldPseudo },
        { name: '隔离文档回调成功执行', value: runtime },
        { name: '@view-transition MPA 规则', value: mpaRule }
      ],
      corrections: corrections,
      prefixes: [
        { label: '标准 API', available: api },
        { label: 'MPA 规则', available: mpaRule },
        { label: '无前缀生产方案', available: api && (pseudo || oldPseudo) }
      ]
    };
  }

  window.CSSFeatureDetectors = {
    detectContainerQueries: detectContainerQueries,
    detectSubgrid: detectSubgrid,
    detectColorFunctions: detectColorFunctions,
    detectLogicalProperties: detectLogicalProperties,
    detectScrollTimeline: detectScrollTimeline,
    detectViewTransitions: detectViewTransitions,
    cssSupports: cssSupports,
    ruleSupported: ruleSupported
  };
}());
