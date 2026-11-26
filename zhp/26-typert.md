# Typert：类型图、Remote SDK 与 Host↔Client

| | |
|---|---|
| 状态 | 学习中（源码 + 已有 `lib/typert.remote-client.*`；未单独重跑 generate） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@b05e3b1810` |
| 证据 | 源码；权威见 [`packages/typert/`](../packages/typert/README.zh.md)、[`docs/subsystems/typert.zh.md`](../docs/subsystems/typert.zh.md)、[Remote Agent Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md)、[`docs/development.md`](../docs/development.md)、[`docs/api-gateway.zh.md`](../docs/api-gateway.zh.md)、[`web-app`](../packages/bundle/web-app/README.zh.md)、[`desktop`](../apps/desktop/README.zh.md)、[`webserver`](../packages/host/webserver/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。仓库地图 [08](./08-repo-layout.md)；模型工具链无关 → [17](./17-tools.md)。

## 一句话

**Typert 是仓库自造专名：构建时把 Host 上的 `@Remote` 等方法打成类型图产物，生成 Client `/remote` 投影与 Host `./typert` 反射；Browser Client 经 `api-remotes` `$mount` 后用 `ctx.remote.*` 调 Host，线上只传 endpoint + JSON。**（源码）

---

## 1. 名字与原意

| | |
|---|---|
| 英语词典 | **无**（不是 typewriter / typer） |
| 产品自述 | *build-time **type-graph** generator … **typed Host-to-Client** calls*（[`typert/README.md`](../packages/typert/README.md)） |
| 内部模型 | `TypeGraph` / `FaceModel`（[compiler-independent model](../.agents/notes/implemented/architecture/2026-07-27-compiler-independent-typert-model.md)） |
| 词源 | 文档无正式拆词；绑定 Type / TypeGraph 的品牌名（**推断**） |

**不是**模型 `ctx.tools` 流水线；是 **GUI/Client ↔ Host 的类型化 RPC 基础设施**（也喂文档目录等静态投影）。

包地图：`generator` / `registry`（`ctx.typert`）/ `loader` / `protocol`（`@Remote` 等）。下游：`api-gateway`（`ctx.typertGateway` / `ctx.remote`）、`api-remotes`（应用选挂哪些 `/remote`）、`connection`（物理 `/api`）。

---

## 2. 以 Goal Remote 为例：怎么用

### Host 声明

[`GoalService`](../packages/goal/goal/src/index.ts) `extends TypertRemoteService`，`super(ctx, 'goals')`；方法 `@Remote('get')` / `@Remote('create')`（可 `remoteExport*` 换 wire 形态）。

活对象：`Agent` → wire `agentId`；[`dsh-agent`](../packages/core/agent/src/index.ts) `typert.lookups.register('agent', { resolve: sessionId => this.get(sessionId), … })`。

### 产物出口

[`goal/package.json`](../packages/goal/goal/package.json)：`./typert` → Host 反射；`./remote` → Client 投影（`lib/typert.remote-client.{js,d.ts}`）。

### Client 调用

[`api-remotes` Client](../packages/api/remotes/src/client/index.ts) `$mount(goalsRemote)`；UI：

```ts
// packages/client/ui-goal — inject remote.goals
ctx.remote.goals.get(sessionId)
```

作者不手写路由表 / stub；Typert 从签名生成。

---

## 3. 怎么实现（端到端）

```text
构建：generator 读 Host @Remote → TypeGraph
     → typert.host.*（Loader → ctx.typert）
     → typert.remote-client.*（Client $mount）

运行：UI ctx.remote.goals.get(agentId)
     → Connection RPC { namespace, method, args }
     → typertGateway.prepareInvocation
       · codec 解 args · lookup 解 Agent
       · Reflect.apply(GoalService 方法)
     → 结果回传（descriptor 不走 wire）
```

Gateway 一元调用核心：[`api/gateway` `invoke` / `Reflect.apply`](../packages/api/gateway/src/index.ts#L424)；学习笔记 [40](./40-api-gateway.md)。

---

## 4. Build 是否生成「Client SDK」

**是**：构建阶段生成 **按包的 `/remote` 投影**（类型 + 运行时 contribution），不是手写独立 npm SDK。

- `.d.ts`：IDE / `tsc`；`.js`：打进前端 bundle
- Host `./typert` 另一套，给 Node Host
- 线上不传 descriptor；两端各自本地持有生成物

看例子（本机已有）：

| 文件 | 用途 |
|---|---|
| [`goal/.../typert.remote-client.d.ts`](../packages/goal/goal/lib/typert.remote-client.d.ts) | `goals.get(agentId)` 等类型 |
| [`typert.remote-client.js`](../packages/goal/goal/lib/typert.remote-client.js) | Zod factory + `TYPERT_REMOTE` |
| `.d.ts.map` | 跳回 Host 源码 |

重生成：`pnpm exec tsx scripts/generate-typert.ts`，或 `pnpm run typecheck` / `build:artifacts`。

---

## 5. 开发实践（写 Client 时）

1. **对着 `ctx.remote.*` 写**，不 import Host `GoalService` 实现。
2. 装配靠 **`api-remotes/client`**，UI 一般不自己 `$mount`。
3. **`/remote` 必须解析到 `lib/`**，不能被 `paths`→`src` 拐走（[Agent Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md)）。
4. 改 Host `@Remote` → 先 generate → 再改 UI；`typecheck` / `dev:web` 会带 Typert 准备。
5. SRC 弱路径不能当正式依赖；严格 schema 靠预构建产物。

见 [`docs/development.md`](../docs/development.md)（Typert 与 Host/Client 聚合、generate 顺序）。

---

## 6. Zod

**[Zod](https://zod.dev)**：TS 运行时 schema 校验库。生成的 `typert.remote-client.js` 用 Zod factory 校验 Remote 参数/结果（含 `strict`）；业务类型仍引用 `@deepseek-ai/dsh-goal/client` 等。

---

## 7. 打包部署：产物怎么进 Client；是几个进程

```text
goal/lib/typert.remote-client.js
  → api-remotes import / $mount
  → Client 模块图 → Vite/tsdown 前端 bundle
浏览器加载的是打好的静态资源（含 remote JS + Zod 等）
```

`.d.ts` 不进浏览器运行时。

| Profile | 进程形态 |
|---|---|
| **web** | **一个 Node Host**（agent + Gateway + **同一个** `ctx.webServer`）+ **浏览器文档**（不是第二个 Node） |
| **Desktop** | Electron 壳 + Host；页从 **`dsh-app://app/`** 加载打包入口；API 仍 HTTP/WS 到本机 Host（[desktop README](../apps/desktop/README.zh.md)） |
| **headless / sdk** | 常无 Browser Typert UI |

### Client 还要不要自己的 Web 服务？

**不要。** 静态 SPA 由 Host 上的 [`frontend-static`](../packages/host/frontend-static/README.zh.md) 认领 webserver **回退**；`/api` 挂在**同一** [`webserver`](../packages/host/webserver/README.zh.md) 监听器。
默认不是「前端 Nginx 一进程 + API 另一进程」；前面可再挂反向代理，那是部署拓扑。

### Electron：file 还是 web？

- **主产品 UI**：自定义协议 **`dsh-app://app/`**（不是用户点的 `http://127.0.0.1:3080`，也不是文档里偶尔概括的裸 `file://` 主路径）。
- **API**：仍到本机 Web Host。
- 壳内另有 `dsh-app://shell/` 等；欢迎页等可能 `loadFile`。

---

## 还没搞懂

1. `api-remotes` 与 Gateway 事件转发名单的完整边界（[08](./08-repo-layout.md) 旧问）。
2. Desktop `dsh-app://` 与 Host 认证 Cookie 转发的本机一次抓包对照。
3. 仅改 Remote 签名时 `generate-typert` 与全量 `build:artifacts` 的最小充分集。

## 读代码最短路径

1. [typert 组](../packages/typert/README.zh.md) + [Remote Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md)
2. Host：[`goal/.../index.ts` `@Remote`](../packages/goal/goal/src/index.ts) → 打开 `lib/typert.remote-client.d.ts`
3. Client：[`api-remotes` `$mount`](../packages/api/remotes/src/client/index.ts) → [`ui-goal`](../packages/client/ui-goal/src/client/index.ts)
4. 载体：[webserver](../packages/host/webserver/README.zh.md) + [frontend-static](../packages/host/frontend-static/README.zh.md)；学习笔记 [38](./38-webserver.md)；Desktop：[apps/desktop/README.zh.md](../apps/desktop/README.zh.md)
