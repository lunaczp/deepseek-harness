# Client Modules：浏览器插件图、加载与 chunk

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@60ede81c53` |
| 证据 | 源码；权威见 [`packages/client/modules/`](../packages/client/modules/README.zh.md)、[`docs/subsystems/client-modules.zh.md`](../docs/subsystems/client-modules.zh.md)、[`packages/client/web/`](../packages/client/web/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。启动 [07](./07-startup.md)；HMR [39](./39-hmr.md)；Web Client 竖切 [41](./41-web-client.md)；Slot/React [41b](./41b-web-client-slots.md)；HTTP [38](./38-webserver.md)。

## 一句话

**`dsh-client-modules` = 把各包 `dsh.client` 变成可加载的浏览器 bundle 图：Host 组合并提供 `/plugins`，浏览器惰性物化。模型看不见。插件入口开页从 Host 拉并注册 factory；chunk 是构建拆包的技术优化，用到再请求。**（源码）

---

## 1. 作用 & 定位

| | |
|---|---|
| **Host** | `ctx.clientModules`（`ClientModuleRegistry`）：扫 Loader、组 `WebBootGraph`、`/plugins`、index 注入 `__DSH_BOOT__` |
| **浏览器** | `ctx.modules`（`ClientModuleSystem`）：按图注册 factory、物化、跟 HMR 换图 |
| **不是** | 业务 Remote、slot UI、SPA 静态壳本身 |
| **和 HMR** | HMR 调 `rebuilt` + SSE；本包管图与 bundle 服务 → [39](./39-hmr.md) |

```text
Host Loader 启用的 dsh.client 包
  → client-modules 组成 WebBootGraph
  → index：__DSH_BOOT__ + combo script
  → 浏览器 modules load / materialize
  → ui-* / controller ./client 等 Cordis 插件跑起来 → [41](./41-web-client.md)
```

---

## 2. Client 模式下「plugin」指啥

**带 `dsh.client`、打成 `lib/client.js`、进浏览器 Cordis 树的浏览器半插件**——不是 VS Code 扩展那种商店插件（设置里的「插件列表」展示的也是这类图条目）。

| | Host 插件 | Client 插件 |
|---|---|---|
| 跑哪 | Node | **浏览器** |
| 声明 | cordis.yml Loader | + `dsh.client` + `./client` |

### 例子

| 包 | 浏览器里干什么 |
|---|---|
| `dsh-client-ui-workspace` | slot 注册侧栏 / Picker（纯 UI） |
| `dsh-api-workspace-controller` 的 `./client` | `ctx.workspaces` + follow（一包两面） |
| `dsh-client-ui-layout` | register `root` → `AppFrame` |
| `dsh-client-ui-renderer` | `slots` + `uiRenderer.mount(#root)` |
| `dsh-client-modules` 的 `./client` | `ctx.modules`（常 `immediately: true`） |
| `dsh-client-hmr` 的 `./client` | `/plugins/events` |
| `dsh-workspace`（仅 Host） | **不是** Client 插件（无 `dsh.client`） |

---

## 3. 使用：怎么声明

```json
"exports": { "./client": { "default": "./lib/client.js" } },
"dsh": {
  "client": {
    "platform": "web",
    "external": ["@deepseek-ai/dsh-api-gateway/client"],
    "inject": ["…"]
  }
}
```

- `external`：基座 `PLATFORM_MODULES`（React/Cordis/…）之外要从模块表解析的请求
- 启动前必须 `pnpm run build` 产出 `lib/client.js`；缺失 → 激活失败（[07](./07-startup.md) 实测）
- 作者一般不手调 `clientModules`；HMR Host 半调 `rebuilt(id)`

---

## 4. 加载模型：不是一个 Vite 大包，也不是点到才首次要入口

```text
apps/web Vite          薄壳（main.ts、共享基座）
各包 lib/client.js     Host 构建产物
  → combo /plugins     开页按图下载入口、注册 factory
  → 物化               首次激活/import 才跑 apply、CSS
  → require.async      走到动态 import 再拉 chunk
```

| 东西 | 行为 |
|---|---|
| 入口 `client.js` | 启动图 row → 开页 combo **从 Host 拉并注册** |
| factory 副作用 | **惰性**物化 |
| `client.<name>.js` chunk | **按需**再 GET |
| React 等 | 外壳共享表，不进每个插件包 |
| 设置里新启用 | 图变更后再拉（常单资源 URL） |

**结论：** 代码在 Host 侧已构建，经 `/plugins` 下发；开页批量拿入口，执行按需，chunk 更按需。

---

## 5. 「惰性 CJS」是啥

**CJS = CommonJS**（`require` / `module.exports`），相对 ESM（`import`/`export`）。

浏览器插件**源码是 ESM**；运行时约定是 **像 CJS 的惰性模型**：

1. 执行脚本 → 只 **注册 factory**
2. 用到时 `factory(require)` **物化**（同步 require 依赖）
3. 动态拆包 → `require.async("./client.<name>.js")`

不是让业务手写老式 `require`；也和仓库 Host「一律 ESM」不矛盾（那是源码/包格式）。

---

## 6. Chunk 干啥用

**构建把一包浏览器代码拆出的后续脚本**（真 JS），首屏不随入口下载执行。

| | |
|---|---|
| 来源 | 源码 `import()` → tsdown → `require.async("./client.<name>.js")` |
| 目的 | 减小首包；少用路径晚加载（渐进） |
| 业务？ | **基本无关**——技术优化，不是 Workspace/Remote 领域边界 |
| 约束 | chunk 自包含；不可同步 `require` 另一 `client*.js`（[client AGENTS](../packages/client/AGENTS.md)） |

两层惰性：

```text
开页 client.js     → 注册 factory
激活/首次用        → 物化入口
再走动态 import    → 拉 chunk → 执行那一块
```

---

## 7. 实现要点

### Host：`ClientModuleRegistry`

[`src/index.ts`](../packages/client/modules/src/index.ts)：`inject: ['loader']`

- `internal/plugin` → dirty → flush 增量对账（读 manifest + `client.js` mtime/ctime/size → **revision**，不内容哈希）
- `compose()` → `WebBootGraph`；`bootInjections` → `webserver/index-inject`
- `register` prefix `/plugins` → `fetchBundle`
- `rebuilt(id)`：HMR 换 rev

### 浏览器

[`src/client/`](../packages/client/modules/src/client/)：`system.ts` 物化、`entries.ts` 图更新/重试/重载。
**release**（version+commit）不一致则不应用图/rebuilt，提示刷新。

### 和相邻

| | client-modules | client-hmr | ui-slots | resources |
|---|---|---|---|---|
| 干什么 | 插件 bundle 图 + `/plugins` | 发现重建、SSE | UI 插槽账本 | `dsh-resource://` 值流 → [43](./43-client-resources.md) |

---

## 还没搞懂

1. bootstrap combo vs application combo 在本机 Network 面板的实际 URL/体积对照。
2. `immediately: true` 行与普通行预取顺序的边界。
3. 设置里启停一个可选 UI 插件时，单资源 URL 与 factory 清理的一次抓包。

## 读代码最短路径

1. [modules README](../packages/client/modules/README.zh.md) + [子系统](../docs/subsystems/client-modules.zh.md)
2. Host：[`ClientModuleRegistry`](../packages/client/modules/src/index.ts#L646)
3. 浏览器：[`src/client/system.ts`](../packages/client/modules/src/client/system.ts) + [`entries.ts`](../packages/client/modules/src/client/entries.ts)
4. 外壳启动：[web README](../packages/client/web/README.zh.md) → [41b](./41b-web-client-slots.md) `#root`
