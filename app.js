(function () {
  "use strict";

  var STATUS_LABEL = {
    supported: "完全支持",
    partial: "部分支持",
    unsupported: "不支持"
  };

  var MODE_LABEL = {
    auto: "自动",
    modern: "强制现代",
    fallback: "强制降级"
  };

  var selectedModes = {};
  var lastDetection = null;
  var canvasObserver = null;
  var probeId = 0;

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $all(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function frame() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  function supportsProperty(property, value) {
    if (!window.CSS || typeof CSS.supports !== "function") return false;
    try {
      return CSS.supports(property, value || "initial");
    } catch (error) {
      return false;
    }
  }

  function supportsAtRule(rule) {
    if (!window.CSS || !CSS.supports || typeof CSS.supports.at !== "function") return null;
    try {
      return CSS.supports.at(rule);
    } catch (error) {
      return null;
    }
  }

  function cssSupportsAtRuleFallback(name, params, body) {
    var style = document.createElement("style");
    style.textContent = "@" + name + " " + params + " {" + body + "}";
    document.head.appendChild(style);
    var sheet = style.sheet;
    var valid = Boolean(sheet && sheet.cssRules && sheet.cssRules.length);
    style.remove();
    return valid;
  }

  function createProbeHost() {
    probeId += 1;
    var host = document.createElement("div");
    host.id = "css-lab-probe-" + probeId;
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-99999px;top:0;visibility:hidden;" +
      "pointer-events:none;width:360px;height:240px;overflow:hidden;";
    document.body.appendChild(host);
    return host;
  }

  function addStyle(css) {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }

  function computed(element, property) {
    return window.getComputedStyle(element).getPropertyValue(property);
  }

  function makeResult(id, name, summary) {
    return {
      id: id,
      name: name,
      summary: summary,
      status: "unsupported",
      score: 0,
      rawSupported: false,
      runtimePassed: false,
      prefix: {
        standard: false,
        active: "无",
        aliases: []
      },
      checks: [],
      notes: [],
      corrections: [],
      browserNotes: [],
      fallback: "",
      canvasHint: ""
    };
  }

  function finishResult(result) {
    result.status = result.score >= 90
      ? "supported"
      : result.score > 0
        ? "partial"
        : "unsupported";

    if (result.prefix.active === "无" && result.status === "supported") {
      result.prefix.active = "标准语法";
    }

    if (!result.rawSupported && result.runtimePassed) {
      result.corrections.unshift("CSS.supports 漏报：运行时探针确认特性可用，按可用处理。");
    }
    if (result.rawSupported && !result.runtimePassed && result.score < 90) {
      result.corrections.unshift("CSS.supports 可能误报：真实布局、绘制或时间线探针未通过，降级处理。");
    }
    return result;
  }

  function checkColorInCanvas(value) {
    var canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    var context = canvas.getContext("2d");
    if (!context) return false;
    try {
      context.fillStyle = "#000000";
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      var data = context.getImageData(0, 0, 1, 1).data;
      return data[0] !== 0 || data[1] !== 0 || data[2] !== 0 || data[3] !== 255;
    } catch (error) {
      return false;
    }
  }

  function colorParsesInStyle(value) {
    var element = document.createElement("div");
    element.style.backgroundColor = "rgb(1, 2, 4)";
    element.style.backgroundColor = value;
    var accepted = element.style.backgroundColor.length > 0;
    var normalized = accepted ? computed(element, "background-color") : "";
    return {
      accepted: accepted,
      valid: accepted && normalized !== "rgb(1, 2, 4)"
    };
  }

  var storage = {
    db: null,
    mode: "idb",

    open: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (!window.indexedDB) {
          self.mode = "memory";
          resolve();
          return;
        }

        var request = indexedDB.open("css-feature-lab", 1);
        request.onupgradeneeded = function () {
          var database = request.result;
          if (!database.objectStoreNames.contains("history")) {
            var store = database.createObjectStore("history", {
              keyPath: "id",
              autoIncrement: true
            });
            store.createIndex("createdAt", "createdAt");
          }
        };
        request.onsuccess = function () {
          self.db = request.result;
          self.mode = "idb";
          resolve();
        };
        request.onerror = function () {
          self.mode = "memory";
          resolve();
        };
      });
    },

    tx: function (type) {
      return this.db.transaction("history", type).objectStore("history");
    },

    addHistory: function (entry) {
      var self = this;
      return new Promise(function (resolve) {
        if (self.db) {
          var request = self.tx("readwrite").add(entry);
          request.onsuccess = function () { resolve(); };
          request.onerror = function () {
            self.localAdd(entry);
            resolve();
          };
        } else {
          self.localAdd(entry);
          resolve();
        }
      });
    },

    localAdd: function (entry) {
      try {
        var list = JSON.parse(localStorage.getItem("css-lab-history") || "[]");
        list.unshift(entry);
        localStorage.setItem("css-lab-history", JSON.stringify(list.slice(0, 50)));
        this.mode = "localStorage";
      } catch (error) {
        this.mode = "memory";
      }
    },

    listHistory: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (self.db) {
          var request = self.tx("readonly").getAll();
          request.onsuccess = function () {
            resolve(request.result.reverse().slice(0, 50));
          };
          request.onerror = function () {
            resolve(self.localList());
          };
        } else {
          resolve(self.localList());
        }
      });
    },

    localList: function () {
      try {
        return JSON.parse(localStorage.getItem("css-lab-history") || "[]").slice(0, 50);
      } catch (error) {
        return [];
      }
    },

    clear: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (self.db) {
          var request = self.tx("readwrite").clear();
          request.onsuccess = resolve;
          request.onerror = resolve;
        }
        try { localStorage.removeItem("css-lab-history"); } catch (error) {}
        resolve();
      });
    }
  }

  async function detectContainer() {
    var result = makeResult(
      "container",
      "容器查询",
      "@container、container-type 与 cqw 容器单位"
    );
    var ruleImmediate = supportsAtRule("@container");
    var ruleSupport = ruleImmediate === null
      ? cssSupportsAtRuleFallback("container", "(min-width: 1px)", "#" + host.id + "-rule{opacity:1}")
      : ruleImmediate;
    var styleSupport = supportsProperty("container-type", "inline-size");
    var unitSupport = supportsProperty("width", "50cqw");
    var host = createProbeHost();
    var child = document.createElement("div");
    child.className = "cq-probe-child";
    host.appendChild(child);

    var style = addStyle(
      "#" + host.id + ".cq-probe-native{container-type:inline-size;}" +
      "#" + host.id + ".cq-probe-native .cq-probe-child{width:100px;}" +
      "@container (min-width: 300px){#" + host.id + " .cq-probe-child{width:222px;}}" +
      "#" + host.id + ".cq-probe-no-rule{container-type:inline-size;}" +
      "#" + host.id + ".cq-probe-no-rule .cq-probe-child{width:30cqw;}"
    );

    await frame();
    host.classList.add("cq-probe-native");
    await frame();
    var ruleWidth = child.getBoundingClientRect().width;
    var runtimeRule = Math.abs(ruleWidth - 222) < 4;

    host.className = "cq-probe-no-rule";
    await frame();
    var unitWidth = child.getBoundingClientRect().width;
    var runtimeUnit = Math.abs(unitWidth - 108) < 6;

    host.remove();
    style.remove();

    result.checks = [
      ["@container 规则", ruleSupport],
      ["container-type", styleSupport],
      ["cqw 容器单位", unitSupport],
      ["真实响应布局", runtimeRule],
      ["容器单位计算", runtimeUnit]
    ];
    result.rawSupported = ruleSupport !== false && (styleSupport || unitSupport);
    result.runtimePassed = runtimeRule && runtimeUnit;
    result.score = (ruleSupport !== false ? 25 : 0) + (styleSupport ? 20 : 0) +
      (unitSupport ? 15 : 0) + (runtimeRule ? 25 : 0) + (runtimeUnit ? 15 : 0);
    result.prefix.standard = result.rawSupported;
    result.prefix.aliases = [];
    result.fallback = "ResizeObserver / matchMedia 测量容器宽度，切换 data-size 类名。";
    result.notes = [
      "声明支持不等于规则真的生效：必须创建可查询容器并改变宽度验证。",
      "容器查询没有生产可用的 WebKit/Blink 前缀；旧提案不应被当作正式兼容。",
      "部分支持常见于仅识别 container-type 但 cqw 单位或规则条件不完整。"
    ];
    result.corrections = [
      runtimeRule ? "真实子元素在 360px 容器中变为 222px，确认 @container 生效。" :
        "运行时未观察到 @container 触发布局，已避免仅凭声明误判。"
    ];
    result.browserNotes = [
      "旧版 Safari 对容器查询曾落后，版本差异应优先看运行时探针。",
      "所有浏览器统一使用标准属性；降级方案不伪造前缀。"
    ];
    result.canvasHint = "同一卡片在宽容器使用双列大封面，窄容器折叠为紧凑信息；降级类名产生相同断点。";
    return finishResult(result);
  }

  async function detectSubgrid() {
    var result = makeResult(
      "subgrid",
      "CSS 子网格",
      "grid-template-columns / rows: subgrid 继承父网格轨道"
    );
    var columnSupport = supportsProperty("grid-template-columns", "subgrid");
    var rowSupport = supportsProperty("grid-template-rows", "subgrid");
    var host = createProbeHost();
    host.innerHTML =
      '<div class="sub-probe-parent">' +
      '<div class="sub-probe-item">A</div>' +
      '<div class="sub-probe-nested"><span>1</span><span>2</span><span>3</span></div>' +
      "</div>";
    var nested = $(".sub-probe-nested", host);
    var spans = Array.prototype.slice.call(nested.children);
    var style = addStyle(
      "#" + host.id + " .sub-probe-parent{display:grid;grid-template-columns:70px 110px 150px;gap:8px;}" +
      "#" + host.id + " .sub-probe-item{grid-column:1;}" +
      "#" + host.id + " .sub-probe-nested{display:grid;grid-template-columns:subgrid;grid-column:1/-1;grid-template-rows:none;}" +
      "#" + host.id + " span{min-height:20px;}"
    );
    await frame();
    var lefts = spans.map(function (item) { return Math.round(item.getBoundingClientRect().left); });
    var parentLeft = Math.round($(".sub-probe-parent", host).getBoundingClientRect().left);
    var expected = [0, 78, 196];
    var runtimeColumn = expected.every(function (offset, index) {
      return Math.abs(lefts[index] - (parentLeft + offset)) < 5;
    });
    var usedValue = computed(nested, "grid-template-columns").indexOf("subgrid") !== -1;

    host.remove();
    style.remove();

    result.checks = [
      ["columns: subgrid", columnSupport],
      ["rows: subgrid", rowSupport],
      ["继承父级列轨道", runtimeColumn],
      ["计算值保留 subgrid", usedValue]
    ];
    result.rawSupported = columnSupport;
    result.runtimePassed = runtimeColumn;
    result.score = (columnSupport ? 30 : 0) + (rowSupport ? 20 : 0) +
      (runtimeColumn ? 40 : 0) + (usedValue ? 10 : 0);
    result.prefix.standard = columnSupport || rowSupport;
    result.fallback = "嵌套容器显式声明 repeat(n, 1fr)，并用 gap、minmax(0,1fr) 保持轨道一致。";
    result.notes = [
      "列子网格和行子网格可能分别落地，只支持一项必须标记为部分支持。",
      "subgrid 没有应依赖的浏览器前缀；写 display:subgrid 是错误语法。",
      "声明解析成功仍需验证嵌套元素是否真的沿用父轨道。"
    ];
    result.corrections = [
      runtimeColumn ? "嵌套第三列位置与父级 70/110/150px 轨道对齐。" :
        "嵌套元素未继承父轨道，使用显式网格降级。"
    ];
    result.browserNotes = [
      "Chromium、Firefox、Safari 对行列子网格的发布节奏不同，需分别探测。"
    ];
    result.canvasHint = "子网格让嵌套按钮与父级三列轨道严格对齐；显式 repeat(3,1fr) 在等宽示例中保持视觉一致。";
    return finishResult(result);
  }

  async function detectColor() {
    var result = makeResult(
      "color",
      "现代颜色函数",
      "lab、lch、oklab、oklch、color() 与相对颜色语法"
    );
    var values = [
      { id: "lab", value: "lab(50% 40 -50)", fallback: "rgb(112, 93, 171)" },
      { id: "lch", value: "lch(58% 44 270)", fallback: "rgb(101, 119, 195)" },
      { id: "oklab", value: "oklab(0.62 0.12 -0.16)", fallback: "rgb(70, 135, 176)" },
      { id: "oklch", value: "oklch(0.70 0.15 230)", fallback: "rgb(64, 145, 181)" },
      { id: "color", value: "color(srgb 0.1 0.45 0.95)", fallback: "rgb(26, 115, 242)" }
    ];
    var runtimeCount = 0;
    values.forEach(function (item) {
      item.claim = supportsProperty("background-color", item.value);
      item.dom = colorParsesInStyle(item.value).valid;
      item.canvas = checkColorInCanvas(item.value);
      item.runtime = item.dom && item.canvas;
      if (item.runtime) runtimeCount += 1;
    });

    var relativeValue = "rgb(from #e63946 r g b)";
    var relativeClaim = supportsProperty("background-color", relativeValue);
    var relativeStyle = colorParsesInStyle(relativeValue);
    var relativeCanvas = checkColorInCanvas(relativeValue);
    var relativeRuntime = relativeStyle.valid && relativeCanvas;
    var relative = {
      id: "relative",
      claim: relativeClaim,
      dom: relativeStyle.valid,
      canvas: relativeCanvas,
      runtime: relativeRuntime
    };

    result.checks = values.concat([relative]).map(function (item) {
      return [item.id + " 实际解析/绘制", item.runtime];
    });
    result.rawSupported = values.some(function (item) { return item.claim; });
    result.runtimePassed = runtimeCount >= 4;
    result.score = Math.round((runtimeCount / values.length) * 75) +
      (relativeRuntime ? 25 : 0);
    result.prefix.standard = result.rawSupported;
    result.fallback = "@supports 选择现代颜色，否则提供静态 sRGB rgb()/hex 色板；Canvas 同步使用相同后备色。";
    result.notes = [
      "仅 CSS.supports 通过不代表能被 Canvas 2D 解析，必须做 DOM 与 Canvas 双探针。",
      "广色域 color(display-p3 ...) 在普通 sRGB 屏应映射显示，不能因色域不同判为失败。",
      "相对颜色语法通常晚于基础 lab/lch/oklch 支持，因此单独计分。"
    ];
    values.forEach(function (item) {
      if (item.claim && !item.runtime) {
        result.corrections.push(item.id + " 声明通过但未完成真实绘制，色板使用 sRGB 后备。");
      }
    });
    if (!result.corrections.length) {
      result.corrections.push("所有基础函数均通过计算样式和 1px Canvas 填色验证。");
    }
    result.browserNotes = [
      "Safari 对 LCH/OKLCH 与广色域支持较早；Firefox/Chrome 版本节奏不同。",
      "这些函数无标准前缀，不应编写 -webkit-lab 等虚构写法。"
    ];
    result.canvasHint = "六个色值各有预定 sRGB 后备；现代与降级模式保持相同色相、布局和说明。";
    result.colorValues = values.concat([relative]);
    result.colorValues[result.colorValues.length - 1].value = relativeValue;
    result.colorValues[result.colorValues.length - 1].fallback = "rgb(230, 57, 70)";
    return finishResult(result);
  }

  async function detectLogical() {
    var result = makeResult(
      "logical",
      "逻辑属性",
      "margin、padding、border、inset 等逻辑方向属性"
    );
    var standardProps = [
      ["margin-inline-start", "34px", "marginRight"],
      ["padding-inline-start", "22px", "paddingRight"],
      ["border-inline-start-width", "8px", "borderRightWidth"],
      ["inset-inline-start", "13px", "right"]
    ];
    var standardClaims = standardProps.map(function (item) {
      return supportsProperty(item[0], item[1]);
    });
    var host = createProbeHost();
    host.style.direction = "rtl";
    var element = document.createElement("div");
    element.style.position = "absolute";
    host.appendChild(element);

    standardProps.forEach(function (item) {
      element.style.setProperty(item[0], item[1]);
    });
    element.style.setProperty("border-inline-start-style", "solid");
    await frame();

    var styles = window.getComputedStyle(element);
    var standardRuntime = styles.marginRight === "34px" &&
      styles.paddingRight === "22px" &&
      styles.borderRightWidth === "8px" &&
      styles.right === "13px";

    var aliases = [
      { property: "-webkit-margin-start", value: "31px", physical: "marginRight" },
      { property: "-webkit-padding-start", value: "19px", physical: "paddingRight" },
      { property: "-webkit-border-start-width", value: "7px", physical: "borderRightWidth" }
    ];

    aliases.forEach(function (alias) {
      var probe = document.createElement("div");
      probe.style.direction = "rtl";
      probe.style.setProperty(alias.property, alias.value);
      if (alias.property.indexOf("border") !== -1) {
        probe.style.setProperty("-webkit-border-start-style", "solid");
      }
      host.appendChild(probe);
      alias.claim = supportsProperty(alias.property, alias.value);
    });

    await frame();
    var aliasProbes = $all("div", host).filter(function (node) { return node !== element; });
    aliases.forEach(function (alias, index) {
      alias.runtime = aliasProbes[index] &&
        window.getComputedStyle(aliasProbes[index])[alias.physical] === alias.value;
    });

    var standardCount = standardClaims.filter(Boolean).length;
    var activeAliases = aliases.filter(function (alias) { return alias.runtime; });
    host.remove();

    result.checks = standardProps.map(function (item, index) {
      return [item[0], standardClaims[index]];
    }).concat([
      ["RTL 下映射到物理右侧", standardRuntime],
      ["旧 WebKit 别名可用", activeAliases.length > 0]
    ]);
    result.rawSupported = standardCount > 0;
    result.runtimePassed = standardRuntime;
    result.score = Math.round((standardCount / standardProps.length) * 70) +
      (standardRuntime ? 30 : 0);
    result.prefix.standard = standardCount === standardProps.length;
    result.prefix.aliases = activeAliases.map(function (alias) {
      return alias.property;
    });
    result.prefix.active = standardRuntime
      ? "标准属性"
      : activeAliases.length
        ? activeAliases[0].property
        : "无";
    result.fallback = "按 dir/writing-mode 推导物理方向；RTL 用 margin-right/padding-right/border-right，竖排再切换 top/bottom。";
    result.notes = [
      "逻辑属性集合很大，单个 margin-inline 支持不代表 inset-inline 或 border-inline 也支持。",
      "旧 WebKit 曾使用 -webkit-margin-start、-webkit-padding-start 等别名，现代代码应优先标准属性。",
      "检测必须切换 direction 或 writing-mode，确认映射随书写模式变化，而不是只看属性能否解析。"
    ];
    result.corrections.push(
      standardRuntime
        ? "RTL 探针中 inline-start 正确映射到物理 right。"
        : "逻辑映射探针未通过；示例使用物理属性降级。"
    );
    if (activeAliases.length && !standardRuntime) {
      result.corrections.push("检测到旧前缀可运行，已将其标记为部分支持而非标准支持。");
    }
    result.browserNotes = [
      "旧 EdgeHTML 与旧移动 WebKit 差异明显，现代 Edge/Chromium 应使用无前缀写法。",
      "iOS 上第三方浏览器使用 WebKit 内核，前缀判断不能只看浏览器品牌。"
    ];
    result.canvasHint = "RTL 示例中逻辑起始边在视觉右侧；降级 margin-right 与 border-right 保持同一位置。";
    return finishResult(result);
  }

  function timelineProgress(currentTime) {
    if (!currentTime) return 0;
    if (typeof currentTime.value === "number") {
      return /percent/i.test(currentTime.unit || "") ? currentTime.value / 100 : currentTime.value;
    }
    return Number(currentTime) || 0;
  }

  async function detectScrollTimeline() {
    var result = makeResult(
      "scroll",
      "滚动驱动动画 / 时间线",
      "animation-timeline、scroll()、ScrollTimeline 与 view()"
    );
    var propertySupport = supportsProperty("animation-timeline", "scroll()");
    var scrollSupport = supportsProperty("animation-timeline", "scroll(block self)");
    var viewFunctionSupport = supportsProperty("animation-timeline", "view(block)");
    var scrollTimelineApi = "ScrollTimeline" in window;
    var viewTimelineApi = "ViewTimeline" in window;

    var host = createProbeHost();
    host.innerHTML =
      '<div class="scroll-probe-scroll"><div class="scroll-probe-bar"></div>' +
      '<div class="scroll-probe-pad"></div>' +
      '<div class="scroll-probe-view">view</div></div>';
    var scroller = $(".scroll-probe-scroll", host);
    var bar = $(".scroll-probe-bar", host);
    var viewProbe = $(".scroll-probe-view", host);
    var style = addStyle(
      "#" + host.id + " .scroll-probe-scroll{width:300px;height:100px;overflow:scroll;background:#fff;}" +
      "#" + host.id + " .scroll-probe-pad{height:430px;}" +
      "#" + host.id + " .scroll-probe-bar{width:20px;height:12px;background:#2563eb;}" +
      "#" + host.id + " .scroll-probe-view{height:50px;background:#06b6d4;color:#fff;}" +
      "@keyframes probe-scroll{from{width:4%}to{width:100%}}" +
      "@keyframes probe-view{from{opacity:0}to{opacity:1}}" +
      "#" + host.id + ".scroll-native .scroll-probe-bar{animation-name:probe-scroll;animation-duration:1ms;animation-timing-function:linear;animation-fill-mode:both;animation-timeline:scroll(block self);}" +
      "#" + host.id + ".scroll-view .scroll-probe-view{animation-name:probe-view;animation-duration:1ms;animation-timing-function:linear;animation-fill-mode:both;animation-timeline:view(block);}"
    );

    await frame();
    host.classList.add("scroll-native");
    await frame();
    scroller.scrollTop = 210;
    await frame();
    await frame();

    var scrollAnimation = bar.getAnimations ? bar.getAnimations()[0] : null;
    var scrollProgress = scrollAnimation ? timelineProgress(scrollAnimation.currentTime) : 0;
    var scrollRuntime = scrollProgress > 0.1 && scrollProgress < 1;

    scroller.scrollTop = 0;
    host.classList.remove("scroll-native");
    host.classList.add("scroll-view");
    scroller.scrollTop = 350;
    await frame();
    await frame();
    var viewAnimation = viewProbe.getAnimations ? viewProbe.getAnimations()[0] : null;
    var viewProgress = viewAnimation ? timelineProgress(viewAnimation.currentTime) : 0;
    var viewTimelineType = viewAnimation && viewAnimation.timeline &&
      typeof viewAnimation.timeline.constructor === "function"
      ? viewAnimation.timeline.constructor.name
      : "";
    var viewRuntime = Boolean(
      viewAnimation && viewProgress >= 0 && viewProgress < 0.9 &&
        /ViewTimeline/.test(viewTimelineType)
    );

    host.remove();
    style.remove();

    result.checks = [
      ["animation-timeline 属性", propertySupport],
      ["scroll() 语法", scrollSupport],
      ["滚动后时间线推进", scrollRuntime],
      ["ScrollTimeline API", scrollTimelineApi],
      ["view() 语法", viewFunctionSupport],
      ["ViewTimeline API / 可视阶段", viewTimelineApi || viewRuntime]
    ];
    result.rawSupported = propertySupport || scrollSupport;
    result.runtimePassed = scrollRuntime;
    result.score = (propertySupport ? 10 : 0) + (scrollSupport ? 20 : 0) +
      (scrollRuntime ? 35 : 0) + (scrollTimelineApi ? 10 : 0) +
      (viewFunctionSupport ? 10 : 0) + ((viewTimelineApi || viewRuntime) ? 15 : 0);
    result.prefix.standard = propertySupport;
    result.fallback = "监听 scroll / IntersectionObserver，计算 scrollTop / maxScroll 并写入 CSS 变量驱动 width 或 transform。";
    result.notes = [
      "部分浏览器可能解析 animation-timeline 字符串，但没有真正创建滚动时间线，因此必须滚动后读取动画进度。",
      "scroll() 元素滚动、容器滚动和 view() 可视阶段是不同能力，不能合并成一个布尔值。",
      "该特性没有可用于生产的 -webkit- / -moz- 前缀。"
    ];
    result.corrections.push(
      scrollRuntime
        ? "滚动到中段后动画 currentTime 为 " + scrollProgress.toFixed(2) + "，确认时间线随滚动推进。"
        : "滚动后未读到推进的时间线，按 scroll 事件降级。"
    );
    if (scrollRuntime && !(viewTimelineApi || viewRuntime)) {
      result.corrections.push("滚动时间线可用但 view() 阶段不完整，状态降为部分支持。");
    }
    result.browserNotes = [
      "Chromium 较早支持；Firefox/Safari 的版本与语法阶段差异应通过运行时进度确认。"
    ];
    result.canvasHint = "现代方案由时间线直接插值；降级在 0%、50%、100% 滚动位置写入相同宽度。";
    return finishResult(result);
  }

  async function detectViewTransition() {
    var result = makeResult(
      "viewtransition",
      "视图过渡 View Transitions",
      "同文档 startViewTransition、view-transition-name 与跨文档规则"
    );
    var apiSupport = typeof document.startViewTransition === "function";
    var propertySupport = supportsProperty("view-transition-name", "lab-test");
    var atRuleImmediate = supportsAtRule("@view-transition");
    var crossDocument = atRuleImmediate === null
      ? cssSupportsAtRuleFallback("view-transition", "", "navigation:auto")
      : atRuleImmediate;

    result.checks = [
      ["document.startViewTransition", apiSupport],
      ["view-transition-name", propertySupport],
      ["@view-transition 跨文档", crossDocument]
    ];
    result.rawSupported = apiSupport || propertySupport;
    result.runtimePassed = apiSupport && propertySupport;
    result.score = (apiSupport ? 45 : 0) + (propertySupport ? 45 : 0) +
      (crossDocument ? 10 : 0);
    result.prefix.standard = apiSupport || propertySupport;
    result.fallback = "检测 API；不存在时直接改 DOM，并用 class + keyframes 或 Web Animations API 播放淡入滑动。";
    result.notes = [
      "同文档 View Transition 与跨文档 @view-transition 是两套能力，需要分别展示。",
      "只有 view-transition-name 而无 startViewTransition 时不能认定页面可启动过渡。",
      "无标准前缀；降级动画必须尊重 prefers-reduced-motion。"
    ];
    result.corrections.push(
      apiSupport && propertySupport
        ? "API 与过渡命名属性同时可用，同文档流程成立。"
        : "API 与 CSS 能力不完整，示例切换到 class 动画降级。"
    );
    if (apiSupport && !propertySupport) {
      result.corrections.push("检测到 API 但命名属性缺失，防止把跨文档或旧试验状态误判为完整支持。");
    }
    result.browserNotes = [
      "Chromium 同文档支持较早；跨文档导航、Safari/Firefox 支持需单独验证。",
      "SPA 可安全使用 API 降级；多页应用还需服务端快照和回退导航策略。"
    ];
    result.canvasHint = "现代方案截图旧态/新态交叉淡入；降级通过同一元素 opacity 与 transform 达成近似一致效果。";
    return finishResult(result);
  }

  var detectors = [
    detectContainer,
    detectSubgrid,
    detectColor,
    detectLogical,
    detectScrollTimeline,
    detectViewTransition
  ];

  function createStage(feature, card) {
    var stage = $(".demo-stage", card);
    if (feature.id === "container") return createContainerStage(stage);
    if (feature.id === "subgrid") return createSubgridStage(stage);
    if (feature.id === "color") return createColorStage(stage, feature);
    if (feature.id === "logical") return createLogicalStage(stage);
    if (feature.id === "scroll") return createScrollStage(stage);
    return createViewStage(stage);
  }

  function stageHeader(title, actionText) {
    var header = document.createElement("div");
    header.className = "demo-toolbar";
    header.innerHTML =
      '<span class="demo-chip"></span>' +
      "<strong>" + escapeHtml(title) + "</strong>" +
      (actionText ? '<button class="demo-action" type="button"></button>' : "");
    if (actionText) $(".demo-action", header).textContent = actionText;
    return header;
  }

  function motionAllowed() {
    return !window.matchMedia ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function createContainerStage(stage) {
    stage.innerHTML =
      '<div class="cq-host native fallback"><div class="cq-card">' +
      '<div class="cq-thumb"></div><div><span class="cq-title">容器响应卡片</span>' +
      '<span class="cq-copy">拖动右下角改变容器宽度</span></div></div></div>' +
      '<p class="demo-caption">现代：@container；降级：ResizeObserver 更新 data-size。</p>';
    var host = $(".cq-host", stage);
    var update = function (effective) {
      host.classList.toggle("native", effective === "modern");
      host.classList.toggle("fallback", effective === "fallback");
      var width = host.getBoundingClientRect().width;
      host.setAttribute("data-width", String(Math.round(width)));
      if (effective === "fallback") {
        host.classList.toggle("wide", width >= 280);
      } else {
        host.classList.remove("wide");
      }
    };
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () {
        update(host.classList.contains("native") ? "modern" : "fallback");
      });
      observer.observe(host);
    } else {
      window.addEventListener("resize", function () {
        if (host.classList.contains("fallback")) update("fallback");
      });
      host.addEventListener("pointerup", function () {
        if (host.classList.contains("fallback")) update("fallback");
      });
    }
    return { update: update };
  }

  function createSubgridStage(stage) {
    var items = ["父列 1", "父列 2", "父列 3"];
    var nested = ["嵌套 A", "嵌套 B", "嵌套 C"];
    stage.innerHTML =
      '<div class="subgrid-demo native fallback"><div class="subgrid-parent">' +
      items.map(function (item) {
        return '<div class="grid-item">' + item + "</div>";
      }).join("") +
      '<div class="subgrid-nested">' + nested.map(function (item) {
        return '<div class="grid-item">' + item + "</div>";
      }).join("") + "</div></div></div>" +
      '<p class="demo-caption">现代：嵌套网格继承父轨道；降级：显式 repeat(3, minmax(0,1fr))。</p>';
    var demo = $(".subgrid-demo", stage);
    return {
      update: function (effective) {
        demo.classList.toggle("native", effective === "modern");
        demo.classList.toggle("fallback", effective === "fallback");
      }
    };
  }

  function createColorStage(stage, feature) {
    var labels = {
      lab: "lab",
      lch: "lch",
      oklab: "oklab",
      oklch: "oklch",
      color: "sRGB",
      relative: "相对"
    };
    stage.innerHTML =
      '<div class="color-swatches">' + feature.colorValues.map(function (item) {
        return '<button class="color-swatch" type="button" data-id="' + item.id + '">' +
          "<span>" + labels[item.id] + "</span><span>现代 / 后备</span></button>";
      }).join("") + "</div>" +
      '<p class="demo-caption">现代值无法解析时，该色板自动使用对应 sRGB 后备色。</p>';
    return {
      update: function (effective, featureData) {
        $all(".color-swatch", stage).forEach(function (button) {
          var item = featureData.colorValues.filter(function (value) {
            return value.id === button.dataset.id;
          })[0];
          var runtime = item.runtime !== false;
          var useModern = effective === "modern" && runtime;
          button.style.backgroundColor = useModern ? item.value : item.fallback;
          button.querySelector("span:last-child").textContent =
            effective === "modern" && !runtime ? "已修正为后备" :
              useModern ? "现代颜色" : "sRGB 降级";
        });
      }
    };
  }

  function createLogicalStage(stage) {
    stage.innerHTML =
      '<div class="logical-demo native fallback"><div class="logical-box">' +
      "<strong>RTL 逻辑起始边</strong><p class=\"demo-caption\">现代属性在右侧；" +
      "物理属性降级也明确放到右侧。</p></div></div>";
    var demo = $(".logical-demo", stage);
    return {
      update: function (effective) {
        demo.classList.toggle("native", effective === "modern");
        demo.classList.toggle("fallback", effective === "fallback");
      }
    };
  }

  function createScrollStage(stage) {
    stage.innerHTML =
      '<div class="scroll-demo native fallback"><div class="scroll-track">' +
      '<div class="scroll-bar"></div></div><div class="scroll-content">' +
      Array(7).join('<p>向下滚动：现代方案由滚动时间线驱动，降级方案由 scrollTop 计算同一进度。</p>') +
      "</div></div>";
    var demo = $(".scroll-demo", stage);
    var bar = $(".scroll-bar", demo);
    var updateFallback = function () {
      if (!demo.classList.contains("fallback")) return;
      var max = demo.scrollHeight - demo.clientHeight;
      var progress = max > 0 ? demo.scrollTop / max : 0;
      bar.style.width = (4 + progress * 96) + "%";
    };
    demo.addEventListener("scroll", updateFallback);
    return {
      update: function (effective) {
        demo.classList.toggle("native", effective === "modern");
        demo.classList.toggle("fallback", effective === "fallback");
        if (effective === "modern") bar.style.width = "";
        updateFallback();
      }
    };
  }

  function createViewStage(stage) {
    var header = stageHeader("点击卡片切换状态", "切换");
    var view = document.createElement("div");
    view.className = "view-demo native fallback";
    view.innerHTML =
      '<div class="view-card" data-state="a"><strong>视图状态 A</strong>' +
      '<p class="demo-caption">现代：startViewTransition；降级：class keyframes。</p></div>';
    stage.appendChild(header);
    stage.appendChild(view);

    var card = $(".view-card", view);
    var states = ["a", "b", "c"];
    var index = 0;
    var current = "fallback";

    var applyState = function () {
      index = (index + 1) % states.length;
      card.dataset.state = states[index];
      card.querySelector("strong").textContent = "视图状态 " + states[index].toUpperCase();
      if (current === "fallback" && motionAllowed()) {
        card.classList.remove("is-changing");
        void card.offsetWidth;
        card.classList.add("is-changing");
      }
    };

    var click = function () {
      if (current === "modern" && typeof document.startViewTransition === "function") {
        document.startViewTransition(applyState);
      } else {
        applyState();
      }
    };

    card.addEventListener("click", click);
    $(".demo-action", header).addEventListener("click", click);

    return {
      update: function (effective, featureData) {
        var modernAvailable = featureData.status !== "unsupported";
        current = effective === "modern" && modernAvailable ? "modern" : "fallback";
        view.classList.toggle("native", current === "modern");
        view.classList.toggle("fallback", current === "fallback");
        $(".demo-chip", header).textContent =
          effective === "modern" && !modernAvailable ? "现代不可用，已回退" :
            effective === "modern" ? "现代 API" : "降级动画";
        $(".demo-chip", header).className = "demo-chip " +
          (effective === "modern" && modernAvailable ? "modern" : "fallback");
      }
    };
  }

  function effectiveMode(feature, mode) {
    if (mode === "modern") return "modern";
    if (mode === "fallback") return "fallback";
    return feature.status === "unsupported" ? "fallback" : "modern";
  }

  function renderFeatureCard(feature) {
    var template = $("#featureCardTemplate");
    var card = template.content.firstElementChild.cloneNode(true);
    card.dataset.feature = feature.id;
    $(".feature-name", card).textContent = feature.name;
    $(".feature-summary", card).textContent = feature.summary;

    var badge = $(".status-badge", card);
    badge.dataset.status = feature.status;
    badge.textContent = STATUS_LABEL[feature.status] + " · " + feature.score;

    var raw = $(".raw-result", card);
    raw.dataset.ok = String(feature.rawSupported);
    raw.textContent = feature.rawSupported ? "有声明通过" : "声明未通过";

    $(".corrected-result", card).textContent =
      feature.runtimePassed ? "运行时通过" : "运行时不完整";

    var aliases = feature.prefix.aliases.length
      ? feature.prefix.aliases.join(" / ")
      : "无可用旧前缀";
    $(".prefix-value", card).textContent =
      (feature.prefix.standard ? "标准可用；" : "标准不完整；") +
      "当前生效：" + feature.prefix.active + "；旧形态：" + aliases;

    var checks = feature.checks.map(function (check) {
      var value = check[1];
      var text = value === true ? "通过" : value === false ? "未通过" : String(value);
      return "<li><strong>[检测] " + escapeHtml(check[0]) + "：" +
        escapeHtml(text) + "</strong></li>";
    });
    var notes = checks.concat(
      feature.notes.map(function (note) { return "<li>" + escapeHtml(note) + "</li>"; }),
      feature.corrections.map(function (note) {
        return "<li><strong>[修正] " + escapeHtml(note) + "</strong></li>";
      }),
      feature.browserNotes.map(function (note) {
        return "<li><em>[差异] " + escapeHtml(note) + "</em></li>";
      })
    );
    $(".note-list", card).innerHTML = notes.map(function (note) {
      return note;
    }).join("");
    $(".fallback-text", card).textContent = feature.fallback;

    var stageApi = createStage(feature, card);
    var buttons = $all(".mode-button", card);
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        selectedModes[feature.id] = button.dataset.mode;
        try {
          localStorage.setItem("css-lab-modes", JSON.stringify(selectedModes));
        } catch (error) {}
        updateCardMode(feature, card, stageApi, "手动切换");
      });
    });

    card._stageApi = stageApi;
    updateCardMode(feature, card, stageApi, "初始化");
    return card;
  }

  function updateCardMode(feature, card, stageApi, source) {
    stageApi = stageApi || card._stageApi;
    var mode = selectedModes[feature.id] || "auto";
    var effective = effectiveMode(feature, mode);
    var validity = effective === "fallback" || feature.status === "supported";

    $all(".mode-button", card).forEach(function (button) {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    $(".effective-value", card).textContent =
      MODE_LABEL[mode] + " → " + (effective === "modern" ? "现代样式" : "降级样式");

    var chip = $(".validity-chip", card);
    chip.dataset.valid = String(validity);
    chip.textContent = validity ? "路径可用" : "强制观察不可用路径";

    stageApi.update(effective, feature, source);
    drawComparison($(".compare-canvas", card), feature, effective);
  }

  function roundedRect(context, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function prepareCanvas(canvas) {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, rect.width || 640);
    var height = Math.max(160, rect.height || 178);
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    var context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context: context, width: width, height: height };
  }

  function drawPanel(context, x, y, width, height, title, active) {
    context.save();
    roundedRect(context, x, y, width, height, 13);
    context.fillStyle = active ? "#ffffff" : "#f8fafc";
    context.fill();
    context.lineWidth = active ? 2.5 : 1;
    context.strokeStyle = active ? "#2563eb" : "#cbd5e1";
    context.stroke();
    context.fillStyle = "#0f172a";
    context.font = "800 12px sans-serif";
    context.fillText(title, x + 11, y + 19);
    context.fillStyle = active ? "#1d4ed8" : "#64748b";
    context.font = "700 10px sans-serif";
    context.fillText(active ? "当前生效" : "备选路径", x + 11, y + height - 10);
    context.restore();
  }

  function drawCardMock(context, x, y, width, height, mode) {
    roundedRect(context, x, y, width, height, 10);
    context.fillStyle = "#eff6ff";
    context.fill();
    context.strokeStyle = "#93c5fd";
    context.stroke();
    context.beginPath();
    context.arc(x + 24, y + height / 2, mode === "modern" ? 17 : 13, 0, Math.PI * 2);
    context.fillStyle = "#2563eb";
    context.fill();
    context.fillStyle = "#1e293b";
    context.font = "800 10px sans-serif";
    context.fillText(mode === "modern" ? "大封面双列" : "紧凑单列", x + 44, y + height / 2 - 3);
    context.fillStyle = "#64748b";
    context.font = "9px sans-serif";
    context.fillText(mode === "modern" ? "@container 命中" : "data-size=wide", x + 44, y + height / 2 + 12);
  }

  function drawSubgridMock(context, x, y, width, height, mode) {
    var columns = [0, 48, 96];
    context.strokeStyle = "#94a3b8";
    context.lineWidth = 1;
    columns.forEach(function (offset) {
      context.strokeRect(x + offset, y + 6, 44, 18);
      context.strokeRect(x + offset, y + 32, 44, mode === "modern" ? 31 : 25);
    });
    context.fillStyle = "#0f172a";
    context.font = "9px sans-serif";
    context.fillText(mode === "modern" ? "subgrid 继承父轨道" : "repeat(3,1fr)", x + 4, y + height - 12);
  }

  function drawColorMock(context, x, y, width, height, feature, useModern) {
    var colors = feature.colorValues || [];
    var swatchWidth = (width - 30) / 3;
    colors.slice(0, 6).forEach(function (item, index) {
      var col = index % 3;
      var row = Math.floor(index / 3);
      context.fillStyle = useModern && item.runtime !== false ? item.value : item.fallback;
      roundedRect(context, x + 9 + col * (swatchWidth + 5), y + 27 + row * 29,
        swatchWidth, 24, 6);
      context.fill();
      context.fillStyle = "#fff";
      context.font = "800 8px sans-serif";
      context.fillText(item.id, x + 14 + col * (swatchWidth + 5), y + 42 + row * 29);
    });
    context.fillStyle = "#334155";
    context.font = "9px sans-serif";
    context.fillText(useModern ? "现代色彩空间" : "预定 sRGB 后备", x + 9, y + height - 12);
  }

  function drawLogicalMock(context, x, y, width, height, mode) {
    roundedRect(context, x + 10, y + 28, width - 20, 48, 8);
    context.fillStyle = "#fff";
    context.fill();
    context.strokeStyle = "#2563eb";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(x + width - 12, y + 31);
    context.lineTo(x + width - 12, y + 73);
    context.stroke();
    context.fillStyle = "#0f172a";
    context.font = "9px sans-serif";
    context.fillText("RTL", x + 18, y + 50);
    context.fillStyle = "#64748b";
    context.fillText(mode === "modern" ? "inset/inline-start" : "物理 right", x + 18, y + 65);
  }

  function drawScrollMock(context, x, y, width, height, mode) {
    roundedRect(context, x + 10, y + 30, width - 20, 14, 7);
    context.fillStyle = "#dbeafe";
    context.fill();
    var barWidth = (width - 20) * (mode === "modern" ? 0.72 : 0.72);
    roundedRect(context, x + 10, y + 30, barWidth, 14, 7);
    context.fillStyle = "#2563eb";
    context.fill();
    context.strokeStyle = "#94a3b8";
    context.strokeRect(x + 10, y + 52, width - 20, 24);
    context.fillStyle = "#334155";
    context.font = "9px sans-serif";
    context.fillText(mode === "modern" ? "animation-timeline" : "scrollTop / max", x + 14, y + 68);
    context.fillText("72%", x + width - 42, y + 41);
  }

  function drawViewMock(context, x, y, width, height, mode) {
    var gradient = context.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, "#1d4ed8");
    gradient.addColorStop(1, mode === "modern" ? "#0891b2" : "#db2777");
    roundedRect(context, x + 12, y + 28, width - 24, 54, 11);
    context.fillStyle = gradient;
    context.fill();
    context.fillStyle = "#fff";
    context.font = "800 11px sans-serif";
    context.fillText("状态 B", x + 24, y + 53);
    context.font = "9px sans-serif";
    context.fillText(mode === "modern" ? "双快照交叉" : "同元素淡入位移", x + 24, y + 70);
  }

  function drawComparison(canvas, feature, effective) {
    if (!canvas) return;
    var prepared = prepareCanvas(canvas);
    var context = prepared.context;
    var width = prepared.width;
    var height = prepared.height;
    var gap = 12;
    var panelWidth = (width - gap * 3) / 2;
    var left = gap;
    var right = gap * 2 + panelWidth;
    var top = 8;
    var panelHeight = height - 16;

    drawPanel(context, left, top, panelWidth, panelHeight, "现代方案", effective === "modern");
    drawPanel(context, right, top, panelWidth, panelHeight, "降级方案", effective === "fallback");

    var renderer;
    if (feature.id === "container") {
      renderer = drawCardMock;
    } else if (feature.id === "subgrid") {
      renderer = drawSubgridMock;
    } else if (feature.id === "color") {
      renderer = function (ctx, x, y, w, h, mode) {
        drawColorMock(ctx, x, y, w, h, feature, mode === "modern");
      };
    } else if (feature.id === "logical") {
      renderer = drawLogicalMock;
    } else if (feature.id === "scroll") {
      renderer = drawScrollMock;
    } else {
      renderer = drawViewMock;
    }

    renderer(context, left + 4, top + 24, panelWidth - 8, panelHeight - 48, "modern");
    renderer(context, right + 4, top + 24, panelWidth - 8, panelHeight - 48, "fallback");

    context.fillStyle = "#0f172a";
    context.font = "800 11px sans-serif";
    context.fillText("视觉目标一致：" + feature.canvasHint, 12, height - 2);
  }

  function detectBrowser() {
    var ua = navigator.userAgent;
    var brand = "未知浏览器";
    var engine = "未知引擎";
    var platform = navigator.platform || "未知平台";

    if (/Edg\//.test(ua)) {
      brand = "Microsoft Edge";
    } else if (/OPR\/|Opera/.test(ua)) {
      brand = "Opera";
    } else if (/SamsungBrowser/.test(ua)) {
      brand = "Samsung Internet";
    } else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) {
      brand = "Chrome / Chromium";
    } else if (/Firefox\//.test(ua)) {
      brand = "Firefox";
    } else if (/Version\/.*Safari\//.test(ua)) {
      brand = /iPhone|iPad|iPod/.test(ua) ? "iOS Safari / WebKit 容器" : "Safari";
    }

    if (/iPhone|iPad|iPod/.test(ua) && /WebKit/.test(ua)) {
      engine = "WebKit（iOS 第三方浏览器也使用系统内核）";
    } else if (/Gecko\/|Firefox\//.test(ua)) {
      engine = "Gecko";
    } else if (/AppleWebKit/.test(ua) && /Chrome\//.test(ua)) {
      engine = "Blink";
    } else if (/AppleWebKit/.test(ua)) {
      engine = "WebKit";
    }

    return {
      brand: brand,
      engine: engine,
      platform: platform,
      userAgent: ua
    };
  }

  function countStatus(results, status) {
    return results.filter(function (result) {
      return result.status === status;
    }).length;
  }

  function signature(results) {
    return results.map(function (result) {
      return [
        result.id,
        result.score,
        result.rawSupported ? 1 : 0,
        result.runtimePassed ? 1 : 0,
        result.prefix.aliases.join(",")
      ].join(":");
    }).join("|");
  }

  function renderOverview(results, browserInfo) {
    var stats = [
      ["完全支持", countStatus(results, "supported"), "supported"],
      ["部分支持", countStatus(results, "partial"), "partial"],
      ["不支持", countStatus(results, "unsupported"), "unsupported"],
      ["需修正声明", results.filter(function (item) {
        return item.rawSupported !== item.runtimePassed;
      }).length, "corrections"],
      ["旧前缀/别名命中", results.reduce(function (count, item) {
        return count + item.prefix.aliases.length;
      }, 0), "prefix"],
      ["历史存储", storage.mode, "storage"]
    ];

    $("#statsGrid").innerHTML =
      '<div class="stat-card environment"><p><strong>' +
      escapeHtml(browserInfo.brand) + "</strong> · " + escapeHtml(browserInfo.engine) + "</p>" +
      "<p>" + escapeHtml(browserInfo.platform) + "</p>" +
      '<p><code>' + escapeHtml(browserInfo.userAgent) + "</code></p></div>" +
      stats.map(function (stat) {
        return '<div class="stat-card"><strong>' + stat[1] +
          '</strong><span>' + escapeHtml(String(stat[0])) + "</span></div>";
      }).join("");
  }

  function renderFeatures(results) {
    var grid = $("#featureGrid");
    grid.innerHTML = "";
    results.forEach(function (feature) {
      grid.appendChild(renderFeatureCard(feature));
    });

    if (window.ResizeObserver) {
      if (canvasObserver) canvasObserver.disconnect();
      canvasObserver = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var canvas = entry.target;
          var card = canvas.closest(".feature-card");
          if (!card || !lastDetection) return;
          var feature = lastDetection.results.filter(function (item) {
            return item.id === card.dataset.feature;
          })[0];
          if (!feature) return;
          var mode = selectedModes[feature.id] || "auto";
          drawComparison(canvas, feature, effectiveMode(feature, mode));
        });
      });
      $all(".compare-canvas").forEach(function (canvas) {
        canvasObserver.observe(canvas);
      });
    }
  }

  function refreshCards() {
    if (!lastDetection) return;
    $all(".feature-card").forEach(function (card) {
      var feature = lastDetection.results.filter(function (item) {
        return item.id === card.dataset.feature;
      })[0];
      var badge = $(".status-badge", card);
      badge.dataset.status = feature.status;
      badge.textContent = STATUS_LABEL[feature.status] + " · " + feature.score;
      updateCardMode(feature, card);
    });
  }

  function formatDate(value) {
    var date = new Date(value);
    var pad = function (number) {
      return number < 10 ? "0" + number : String(number);
    };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function renderHistory(entries) {
    var list = $("#historyList");
    if (!entries.length) {
      list.textContent = "暂无检测记录";
      return;
    }
    list.innerHTML = entries.map(function (entry) {
      return '<div class="history-item"><span class="history-time">' +
        formatDate(entry.createdAt) + '</span><span class="history-reason">' +
        escapeHtml(entry.reason) + '</span><span class="history-counts">' +
        "完全 " + entry.counts.supported + " / 部分 " + entry.counts.partial +
        " / 不支持 " + entry.counts.unsupported + "</span></div>";
    }).join("");
  }

  async function loadHistory() {
    renderHistory(await storage.listHistory());
  }

  function showToast(message) {
    var toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2600);
  }

  var running = false;
  var watchEnabled = true;
  var pollTimer = 0;

  async function runDetection(reason) {
    if (running) return;
    running = true;
    $("#detectState").dataset.state = "running";
    $("#detectState").textContent = "检测中";

    var browserInfo = detectBrowser();
    var results = [];
    for (var index = 0; index < detectors.length; index += 1) {
      results.push(await detectors[index]());
    }

    var currentSignature = signature(results);
    var changed = Boolean(lastDetection && lastDetection.signature !== currentSignature);
    var entry = {
      createdAt: Date.now(),
      reason: reason === "runtime" ? (changed ? "运行时变化" : "运行时复查") : reason,
      browser: browserInfo.brand,
      engine: browserInfo.engine,
      userAgent: browserInfo.userAgent,
      signature: currentSignature,
      counts: {
        supported: countStatus(results, "supported"),
        partial: countStatus(results, "partial"),
        unsupported: countStatus(results, "unsupported")
      }
    };

    var shouldRecord = !lastDetection || changed || reason === "manual";
    lastDetection = {
      signature: currentSignature,
      results: results,
      browser: browserInfo
    };

    renderOverview(results, browserInfo);
    if (changed || !$("#featureGrid").children.length) {
      renderFeatures(results);
    } else {
      refreshCards();
    }

    $("#detectState").dataset.state = changed ? "changed" : "ready";
    $("#detectState").textContent = changed ? "检测到运行时变化" : "检测完成";
    if (shouldRecord) {
      await storage.addHistory(entry);
      await loadHistory();
    }
    if (changed) showToast("检测到特性支持状态发生变化，已重新选择降级路径。");
    running = false;
  }

  function scheduleWatch() {
    clearInterval(pollTimer);
    if (!watchEnabled) return;
    pollTimer = setInterval(function () {
      if (!document.hidden) runDetection("runtime");
    }, 10000);
  }

  function loadModes() {
    try {
      selectedModes = JSON.parse(localStorage.getItem("css-lab-modes") || "{}");
    } catch (error) {
      selectedModes = {};
    }
  }

  async function init() {
    loadModes();
    await storage.open();
    await loadHistory();
    await runDetection("首次检测");
    scheduleWatch();

    $("#rerunBtn").addEventListener("click", function () {
      runDetection("手动复查");
    });
    $("#toggleWatchBtn").addEventListener("click", function () {
      watchEnabled = !watchEnabled;
      this.setAttribute("aria-pressed", String(watchEnabled));
      this.textContent = "运行时监听：" + (watchEnabled ? "开" : "关");
      scheduleWatch();
      showToast(watchEnabled ? "已开启运行时特性复查。" : "已关闭自动复查，仍可手动重新检测。");
    });
    $("#clearHistoryBtn").addEventListener("click", async function () {
      await storage.clear();
      await loadHistory();
      showToast("检测历史已清空。");
    });

    ["orientationchange", "focus"].forEach(function (eventName) {
      window.addEventListener(eventName, function () {
        if (watchEnabled) runDetection("runtime");
      });
    });

    if (window.matchMedia) {
      var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      var updateMotion = function () {
        refreshCards();
      };
      if (motionQuery.addEventListener) {
        motionQuery.addEventListener("change", updateMotion);
      } else if (motionQuery.addListener) {
        motionQuery.addListener(updateMotion);
      }
    }

    window.CSSFeatureLab = {
      detect: function () { return runDetection("手动复查"); },
      getResults: function () { return lastDetection; },
      setMode: function (id, mode) {
        selectedModes[id] = mode;
        refreshCards();
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
