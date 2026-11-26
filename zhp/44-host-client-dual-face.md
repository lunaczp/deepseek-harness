# Host / Client 双面同库：设计背景、原理与对比

| | |
|---|---|
| 状态 | 学习中（源码 + 文档 / Agent Note） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@556aab592b` |
| 证据 | 源码与文档；权威见 [`docs/development.md`](../docs/development.md)、[`docs/subsystems/web-client.zh.md`](../docs/subsystems/web-client.zh.md)、[Typert Remote Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。竖切例子 [41](./41-web-client.md)；Typert [26](./26-typert.md)；Gateway [40](./40-api-gateway.md)；Cordis plugin/service [20](./20-plugin-and-service.md)；modules [42](./42-client-modules.md)。

## 一句话

**同一 monorepo、同一 TS、同一 Cordis `Context` 类与插件哲学，但是 Host / Client 两棵树、两个 TS Program；跨边界靠 Typert 生成 Remote + Gateway，不是共享一个 `ctx`。相对 Java 分仓更同构，相对糊成一团的 Node 全栈更分离。**（源码 / 文档）

---

## 1. 仓库里「同类设计」有哪些

| 模式 | 例子 |
|---|---|
| **一包两面** | `workspace-controller`、`gateway`、`workspace-files`：`"."` Host + `"./client"` |
| **同 Context 类、不同实例** | Node Host 树 vs 浏览器 Client 树 |
| **生成对称契约** | `@Remote` → Host 反射 + Client `/remote` |
| **能力竖切** | 实体 Host-only + controller 双面 + `ui-*` |
| **编译面隔离** | `tsconfig.host` / `tsconfig.client`（两边 `Context` 合并不能进同一 Program） |

**不是：** 一个进程里前后端糊成同一个 `ctx`；浏览器也拿不到 Host 的 `workspaceRegistry`。

---

## 2. 设计背景（要解决什么）

[Typert Remote Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md) 方向：

1. 旧 API Proxy 把定向调用、交互、事件流缠在一起 → 业务改一处要同步路由 / stub / schema / 客户端。
2. Host 与 Browser **都声明合并同名 `Context`，服务不同** → 一个 TS Program 类型碰撞 → 必须双面。
3. 产品是 **常驻 Host（agent / 工具 / 持久化）+ 浏览器（或未来 TUI）控制面**：权威在 Host，UI 要类型安全调用，又不能把 Node API 打进浏览器。
4. 双侧都要 **Cordis 插件心智**（`inject` / `effect` / 启停 / HMR）。

选型：**同构编程模型 + 异构运行时 + 生成边界**。

---

## 3. 原理

```text
业务 @Remote
  → Typert 从 Host Program 生成约定（descriptor 不进 wire）
  → Client ctx.remote.*（平台无关投影）
  → Connection / Gateway
  → Host 活 Service

UI → controller Client model（无 React）→ ui-* / slots / resources
权威状态只在 Host；Client 是投影 + 竞态合并（web-client 文档）
```

关键纪律（[development](../docs/development.md)）：

- 普通包只进 **一个** aggregate；少数 shared leaf 两边都引用同一份源码做检查。
- 拆 `tsconfig.host` / `tsconfig.client` leaf：会撞 Context 合并或 Typert 图的包（gateway、workspace-controller、remotes…）。
- **有 Node 入口 + 浏览器入口 ≠ 必须拆 Program**；多数 Client 插件只在 Client 面构建。

`Context`：类相同、effect 机制相同；**实例与服务面不同**——跨树只走 wire。

---

## 4. 好处

1. Remote 签名驱动两侧，少手维护平行 stub。
2. 能力竖切（Workspace 一条链路可读可改）。
3. 同一 Cordis 学习迁移成本（Host ↔ Client）。
4. 边界比「假同构全栈」硬：浏览器无 `fs`，要数据走 Remote / resources。
5. Remote 投影平台无关（Note：未来 TUI）；Desktop/Web 共用 Client 图思路。
6. 贴合本机 agent：daemon Host + 控制面，不是「请求来了算一下的 BFF」。

---

## 5. 代价 / 问题

1. 心智重：同包哪段跑 Node/浏览器；yml vs `dsh.client`。
2. 工具链重：双 Program、双构建、modules combo、HMR、release。
3. 调试要双侧（Host 日志 + 浏览器 + mux）。
4. 生成/build 漂移风险（门禁扛，仍有运营成本）。
5. 语言锁定 TS/Node；难直接给纯 Java 后端组。
6. 包数量膨胀（实体 + 双面 controller + ui + 测试）。

---

## 6. 与其他形态对比

### Java 前后端分仓（Spring + Vue/React）

| | DSH | 典型 Java 分仓 |
|---|---|---|
| 语言 | 两侧 TS | 后端 Java / 前端 TS |
| 契约 | Typert 生成 | OpenAPI / 手写 DTO，易漂 |
| 部署 | 常同机 Host+页 | 多机常态 |
| 插件 | Cordis 双侧 | 后端扩展 ≠ 前端扩展 |

分仓强在团队墙与异语言缩放；DSH 强在本机 agent 与端到端类型。

### Node「一个 Express 糊前后端」

DSH **更分离**：双 Context、强制 Remote、Client 独立树；避免服务端模块被打进浏览器。

### Next.js / Remix 类全栈 TS

Next 绑 web 请求生命周期；DSH Host 是 **常驻 agent 运行时**（工具、沙箱、session）。页面是壳，不是框架中心。

### Electron main / preload / renderer

粗类比 main≈Host、renderer≈Client；DSH 用 **统一 Cordis + 生成 Remote**，少手写 ipc 表，Web/Desktop 尽量共用 Client。

### gRPC + 共享 proto monorepo

契约同源像 Typert；DSH 额外在浏览器跑第二棵 Cordis，不止生成 stub。

---

## 7. 定位公式

```text
不是：一个 ctx 前后端共用
而是：同语言同插件哲学 × 双运行时 × 生成边界 × Host 权威

相对 Java 分仓 → 更同构、更贴本机 agent
相对糊团 Node 全栈 → 更分离、更安全
相对 Next 全栈 → Host 是常驻运行时，不是页面附带 BFF
```

---

## 还没搞懂

1. 七个拆 leaf 包的完整名单与各自「为何必须拆」对照表深读。
2. 进程内 Connection（不开 WS）与浏览器 mux 在同构 API 下的体验差实测。
3. 若引入非 TS 控制面，Remote 投影复用边界到哪一步为止。

## 读代码 / 文档最短路径

1. [development § TypeScript project layout](../docs/development.md#typescript-project-layout)
2. [web-client § Client models](../docs/subsystems/web-client.zh.md)
3. [Typert Remote Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.zh.md)
4. 实例竖切：[41](./41-web-client.md) + [40](./40-api-gateway.md)
