# API Gateway：Typert Remote 分派与流 mux

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@6e6ef6857d` |
| 证据 | 源码；Upgrade 背景为二手（RFC）；权威见 [`packages/api/gateway/`](../packages/api/gateway/README.zh.md)、[`docs/api-gateway.zh.md`](../docs/api-gateway.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Typert 生成对照 [26](./26-typert.md)；HTTP 载体对照 [38](./38-webserver.md)；Client HMR（另一条 SSE）对照 [39](./39-hmr.md)；Web Client / Workspace 竖切对照 [41](./41-web-client.md)。

## 一句话

**Gateway = Typert Remote 的运行时闸门：校验 / 鉴权 / lookup 后调用活着的 Cordis 方法；一元走 Connection 的 `/api`，流式走自有多路 WebSocket `/api/remote.mux`。不管提示词与工具。**（源码）

---

## 1. 作用 & 定位

| | |
|---|---|
| **Host** | `ctx.typertGateway`（[`TypertGatewayService`](../packages/api/gateway/src/index.ts#L214)） |
| **Client** | `ctx.remote`（`@deepseek-ai/dsh-api-gateway/client`） |
| **硬依赖** | `typert`、`remoteAccess`；Web 上流还要 `connection` + `webServer` |
| **不是** | 业务服务本身；不是 webserver；不是 HMR；模型无直接体验 |

栈位置：

```text
业务 @Remote 方法
    ↑
typertGateway（分派 / 流）
    ↑
Connection（RPC envelope、Peer、重连、/api bridge）
    ↑
webserver（HTTP + upgrade 席位）→ [38](./38-webserver.md)
```

邻居分工（[`docs/api-gateway.zh.md`](../docs/api-gateway.zh.md)）：

| 包 | 职责 |
|---|---|
| `typert-protocol` / generator / registry | 声明、生成、`ctx.typert` |
| **`api-gateway`** | **运行时 invoke / stream / mux / `$events` 槽** |
| `api-remote-access` | 非 owner Peer 的 `decide` |
| `api-remotes` | 应用选挂哪些 `/remote`；拥有 `$events` 名单与队列 |
| `connection` | 一元 HTTP、Peer 接纳、重试 |

---

## 2. 使用 & 例子

### Host 声明

```ts
class GoalService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'goals')
  }

  @Remote('create')
  remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult {
    return this.create(agent, request)  // Agent 由 Gateway 从 wire agentId lookup
  }
}
```

真实：[`GoalService` `@Remote('create')`](../packages/goal/goal/src/index.ts#L645)。

- 流式：`@Remote({ mode: 'stream' })` → `Iterable` / `AsyncIterable` / `RemoteStream<Out, In>`
- 上行：`this.ctx.invocation.uplink()`，不进参数列表
- 可选末位 `signal: AbortSignal`：描述符元数据，**不进 wire args**
- `@RemoteScope(key)`：先解析作用域 Context 再调方法

### Client 调用

`api-remotes` `$mount` 后：

```ts
export const inject = ['remote', 'remote.goals']
await ctx.remote.goals.create(agentId, { objective: 'ship it' })
// 一元 → RemoteResult；载体故障折成 { ok:false }，不因断线 reject
```

流方法返回 `RemoteStreamHandle`：迭代下行；`send` / `end` / `dispose` 管上行。

### 两条物理通道

| 形态 | 载体 |
|---|---|
| **一元** | HTTP `POST /api`（Gateway `rpc.intercept` 认领 endpoint） |
| **流式** | WebSocket [`/api/remote.mux`](../packages/api/gateway/src/stream-protocol.ts#L7) |
| **进程内** | `connection.rpc.open` 等价流，**不开** WS |

内部 `$events` / `$events/result`：转发 Cordis 事件；Client `ctx.remote.$on(...)`。Gateway 只留 endpoint；名单在 api-remotes。

---

## 3. 实现要点

### 挂载（构造）

[`constructor`](../packages/api/gateway/src/index.ts#L242)：

1. `connection.rpc.intercept('/api', claimsEndpoint, dispatchRpc)`
2. 有 `webServer` → `registerUpgrade({ path: REMOTE_STREAM_MUX_PATH, … })`；`admitConnection` 定 Peer 后 `mux.handleUpgrade`；可等 `appReady` 再听
3. `wireStream`：WS mux 与进程内载体共用 `open` / `failure`

### 一次调用

```text
prepareInvocation
  · 描述符（strict / SRC）
  · codec 校验 args → gateway/input-invalid
  · 非 owner → resources → remoteAccess.decide
  · lookup / RemoteScope Context
  · 注入 signal、GatewayInvocation（含 uplink）

一元 invoke → Reflect.apply(method, receiver, args)   // L424
流式 stream → 同一 prepare，再泵 iterable + 帧
```

Peer **必填**；已释放 → `gateway/peer-disposed`。`TypertGatewayError` ⊂ `RemoteError`，码族 `gateway/*`。

### `/api/remote.mux`

一条物理 WS 上多条可独立取消的**逻辑流**（open / item / end / cancel…）。

| 方向 | 规则 |
|---|---|
| 下行（Host→Client） | Host 产出，不校验透传 |
| 上行（Client→Host） | 逐项 codec 校验；inbox 默认 256KiB，超限 `gateway/uplink-overflow`（不关整 socket） |
| 保活 | 默认 2s Ping；连续两周期无活动 terminate |
| 压缩 | 默认 `permessage-deflate`（长 JSON 帧） |

实现：[`RemoteStreamMuxServer`](../packages/api/gateway/src/stream-server.ts) + [`stream-protocol.ts`](../packages/api/gateway/src/stream-protocol.ts)。Client 激活后常驻连接；Connection 管重试。

### 为啥叫 `handleUpgrade`

[`handleUpgrade`](../packages/api/gateway/src/stream-server.ts#L94) 完成的是 **HTTP Upgrade → WebSocket** 握手，不是业务「升级版本」。mux 用 `WebSocketServer({ noServer: true })`，自己不听端口，转调 `ws` 库同名 API；webserver 的 `registerUpgrade` 把 raw `(req, socket, head)` 交进来。详见下节。

---

## 4. 附录：HTTP Upgrade（协议背景）

> 证据：**二手**（RFC 2616 / 2817 / 6455）；DSH 路径为**源码**。

### 是什么

在**已有 TCP** 上，用 HTTP 谈妥后改讲另一种应用层协议（最常见：WebSocket）。成功码 **`101 Switching Protocols`**。

### 完整流程（WS）

```text
客户端                              服务器
   |-------- TCP (+TLS) -------------->|
   |---- GET + Upgrade: websocket ---->|  ① 客户端发起（必须）
   |<--- 101 Switching Protocols ------|  ② 同意；否则普通 HTTP/毁连接
   |======== 之后 WebSocket 帧 ========|  ③ 同一条连接，不再 HTTP
```

请求关键头：`Connection: Upgrade`、`Upgrade: websocket`、`Sec-WebSocket-Key` / `Version`；浏览器还带 `Origin`、Cookie。`head` = 头解析后 socket 上可能已多读的字节，交给 `handleUpgrade` 以免丢数据。

### 一定是客户端发起吗？

**真正切换的那一跳：是。** 服务器不能单方面把连接改成 WS。

- 服务器可在响应里**广告** `Upgrade:`，或回 **`426 Upgrade Required`**（RFC 2817）**催**客户端再带 Upgrade 请求。
- 客户端再发带 `Upgrade` 的请求后，服务器才可能回 `101`。

### 除了 WS 还有吗？哪个 HTTP 版本引入？

| 用途 | 现状 |
|---|---|
| WebSocket | **主流**（DSH mux） |
| 明文 HTTP/2 `h2c` | 少用；TLS 上 h2 用 ALPN |
| `Upgrade: TLS/1.0`（RFC 2817） | 几乎没人用；直接 HTTPS |

**HTTP/1.1**（1999，RFC 2616 §14.42 + `101`）引入；HTTP/1.0 没有。原意是「用不兼容协议过渡时，先用大家都会的 HTTP 开口，再同连接切换」；WebSocket 是后来最成功的租户，不是 Upgrade 的发明原因。

**不是 Upgrade：** SSE / 长轮询（一直 HTTP）；`CONNECT`（隧道）；HTTP/2-over-TLS / HTTP/3（ALPN / QUIC）。

### DSH 映射

```text
new WebSocket('/api/remote.mux')
  → webserver upgrade 事件 → registerUpgrade 命中
  → admitConnection → mux.handleUpgrade → ws.handleUpgrade(101)
  → RemoteStreamMuxConnection.run()
```

---

## 与相邻概念

| | Gateway | webserver | client-hmr | Connection |
|---|---|---|---|---|
| 干什么 | Remote 分派 + 流 mux | 路由席位 | 开发态插件图/bundle | envelope / Peer / 重连 |
| 典型路径 | `/api`、`/api/remote.mux` | 全部监听 | `/plugins/events` SSE | 承载前两者的信任 |

---

## 还没搞懂

1. `$events` 与 api-remotes 转发名单、owner vs 非 owner waterfall 的一次抓包对照。
2. `prepareInvocation` 资源解析优先级与 `@Remote({ resources })` 自定义读取的边界用例。
3. 上行 `uplinkWindow` / 领域确认游标与 `gateway/uplink-overflow` 的真实触发条件。

## 读代码最短路径

1. [Gateway README](../packages/api/gateway/README.zh.md) + [docs/api-gateway.zh.md](../docs/api-gateway.zh.md)
2. Host：[`index.ts` `invoke` / 构造 upgrade](../packages/api/gateway/src/index.ts#L242)
3. Mux：[`stream-server.ts` `handleUpgrade`](../packages/api/gateway/src/stream-server.ts#L94) + [`stream-protocol.ts`](../packages/api/gateway/src/stream-protocol.ts)
4. 例子：[`goal` `@Remote('create')`](../packages/goal/goal/src/index.ts#L645) → Client `ctx.remote.goals.*`
