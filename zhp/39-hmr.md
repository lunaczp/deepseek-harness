# Client HMR：插件图同步与开发时 bundle 重载

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@3b54ee8b7e` |
| 证据 | 源码；权威见 [`packages/client/hmr/`](../packages/client/hmr/README.zh.md)、[`packages/client/modules/`](../packages/client/modules/) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。HTTP 载体对照 [38](./38-webserver.md)；启动树对照 [07](./07-startup.md)。

## 一句话

**`dsh-client-hmr` = 已打开的 Web 页与 Host 插件图保持同步，并在开发重建后整插件替换浏览器 bundle。不是 Vite/webpack 那种保 React 状态的组件级 HMR；也不是生产部署热更新。**（源码）

---

## 1. 先分清两种「HMR」

| 名字 | 包 | 面 |
|---|---|---|
| **Host / Cordis HMR** | base 里的 [`@deepseek-ai/dsh-hmr`](../packages/bundle/base/cordis.patch.yml)（`id: hmr`） | **Node** 侧插件树热替换；web 因有 `profileContext` 默认启用（[07](./07-startup.md)） |
| **Client HMR（本文）** | [`@deepseek-ai/dsh-client-hmr`](../packages/client/hmr/) | **浏览器** bundle 图同步 + 重建重载 |

聊天里说的「改 client 代码页面自动换插件」通常指后者；启动时 base 那行是前者。

---

## 2. 作用（是 / 不是）

| | |
|---|---|
| **是** | Host 轮询各插件 `client.js` 的 mtime/ctime/size → `clientModules.rebuilt` |
| **是** | SSE [`/plugins/events`](../packages/client/hmr/src/events.ts#L44) 推 `{ type:'graph' }` / `{ type:'rebuilt', id, rev }` |
| **是** | 开发链路：`pnpm run dev:web`（Host + tsdown watch）；watch 打完 sibling chunk 再 stamp 入口 |
| **不是** | 生产部署功能；生产吃静态产物（fallback → frontend-static），无 rebuild watcher |
| **不是** | 组件级热替换：重载 = **整插件 fiber** 卸挂，**组件状态丢**；Session / 连接可保留 |
| **不是** | `/api/remote.mux`（那是 Gateway 流式 Remote 多路 WS，业务实时流） |

模型看不到新输入输出（无新 session 事件专为 HMR）。

---

## 3. 链路

```text
pnpm run dev:web
  ├─ Host（挂 client-hmr）
  └─ tsdown watch 重建 client 产物（stamp lib/client.js）

Host 每 pollIntervalMs（默认 500）stat 各图行的 client bundle
  → 变了 → clientModules.rebuilt(id)
  → SSE /plugins/events
       graph   → 浏览器 modules.entries.sync(graph)
       rebuilt → entries.reload(id, rev)
                  invalidate → prefetch → 卸旧 fiber → 挂新 export
```

路由挂在 webserver 上（exact），见 [38](./38-webserver.md)。Host 入口：[`apply`](../packages/client/hmr/src/index.ts#L68)；浏览器半：[`src/client/index.ts`](../packages/client/hmr/src/client/index.ts)。

**故意轮询、不用 inotify**：网络盘不可靠（[`index.ts` L1–L5](../packages/client/hmr/src/index.ts#L1)）。revision = mtime + ctime + size，不读内容哈希。

---

## 4. 浏览器侧要点

1. 新连上先收整份 **graph**，再听增量。
2. **依赖级联**：换提供方 fiber 时 Cordis 按 inject 自动重载依赖方；HMR **不算**依赖图。
3. HMR 自己也可被 rebuild：进行中的重载在**旧**闭包跑完，新 apply 开新 SSE。
4. 失败显示在插件列表，可重试；**不**自动回滚到旧 bundle。

---

## 5. 与经典前端 HMR 对照

| | DSH client-hmr | 典型 Vite/webpack HMR |
|---|---|---|
| 粒度 | 整插件 fiber | 模块 / 组件 |
| React 状态 | 丢掉 | 常可保留 |
| Session / 连接 | 可保留 | 通常也保留 |
| 发现变更 | Host **stat 轮询** | 多为 watcher 推送 |
| 生产 | 不走 rebuild 路径 | 一般也不进生产 |

图同步（启停插件、不刷整页）是 Web 组合挂的传输能力；**「改代码自动换 bundle」**才是开发专用。

---

## 还没搞懂

1. Host `dsh-hmr` 与 client-hmr 同时开着时，改一个 Host 插件 vs 改一个 Client 插件的可见边界实测。
2. `clientModules.rebuilt` → entries.reload 在 [`modules/src/index.ts`](../packages/client/modules/src/index.ts) 内的精确状态机。
3. Electron / 非页面载体是否挂同一套 SSE（文档称主要服务 Web SSE 路径）。

## 读代码最短路径

1. [client-hmr README](../packages/client/hmr/README.zh.md)
2. Host：[`packages/client/hmr/src/index.ts`](../packages/client/hmr/src/index.ts)（poll + SSE）
3. 协议：[`events.ts`](../packages/client/hmr/src/events.ts)（`graph` / `rebuilt`）
4. 浏览器：[`src/client/index.ts`](../packages/client/hmr/src/client/index.ts) + modules reload
