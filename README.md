# CSS 新特性支持与降级实验室

一个不依赖框架的静态页面，用于检测当前浏览器对 CSS 新特性的支持情况，并展示可手动切换的降级方案、Canvas 对比图和 IndexedDB 检测历史。

## 运行

无需构建工具：

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080`。也可以直接打开 `index.html`，但建议使用本地 HTTP 服务，避免个别浏览器对本地文件的限制。

## 检测范围

- 容器查询：`container-type`、`@container`、命名容器和查询命中。
- 子网格：标准 `subgrid`、旧 WebKit 声明和父子轨道几何对齐。
- 颜色函数：`oklch()`、`lab()`、`color-mix()`、相对颜色语法，以及 Canvas 解析差异。
- 逻辑属性：`margin/padding/border/inset-inline-*`、旧 WebKit 别名和 RTL 物理侧映射。
- 滚动时间线：`animation-timeline: scroll()`、`ScrollTimeline/ViewTimeline`、旧 `@scroll-timeline` 草稿和真实滚动推进。
- 视图过渡：`document.startViewTransition()`、伪元素树、MPA `@view-transition` 规则和隔离文档回调。

## 判定机制

每个特性拆成多个信号，而不是只调用一次 `CSS.supports`：

1. 语法/API 探针：检测声明、规则和 DOM API 是否存在。
2. CSSOM 探针：确认未知规则是否被解析器保留。
3. 行为探针：通过隐藏元素、布局几何、隔离 iframe 或计算样式验证真实效果。
4. 修正机制：语法通过但关键行为失败时，把结果从“完全支持”修正为“部分支持”。
5. 可访问性：开启系统“减少动态效果”时，滚动时间线和视图过渡自动使用降级方案。

状态分为：

- `完全支持`：关键语法和行为探针均通过。
- `部分支持`：只支持部分函数、旧前缀/草稿、API 不完整，或探针发现行为不一致。
- `不支持`：语法、规则和行为探针均不可用。

## 手动切换

每个特性卡片都支持：

- 自动：完全支持时使用原生；部分支持和不支持时使用稳定降级。
- 原生：强制运行原生示例；当前浏览器不支持时会高亮风险。
- 降级：强制展示兼容方案。

全局下拉会批量设置；单卡按钮可以覆盖全局设置。选择会保存在 `localStorage`。

## 数据存储

检测历史使用 IndexedDB，保存触发方式、环境、各项状态、修正条数和变化详情。IndexedDB 不可用时自动降级到 `localStorage`；两者都不可用时只保留当前页面结果，不阻断检测。

## 文件结构

- `index.html`：页面结构和卡片模板。
- `styles.css`：页面样式、原生示例和降级示例。
- `js/detectors.js`：CSS/DOM/CSSOM/iframe 行为检测。
- `js/demos.js`：六项特性的双方案可视化示例。
- `js/db.js`：IndexedDB 历史存储与 localStorage 兜底。
- `js/app.js`：状态汇总、模式切换、Canvas 图表、历史和运行时监听。
