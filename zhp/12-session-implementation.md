# Session 实现：事件日志、Surface 与一次问答 trace

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机落盘实测） |
| 日期 | 2026-11-19 |
| 基线 | `zhp@a451bc4e2c` |
| 证据 | 源码；权威文档见 `docs/subsystems/session.md` |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**Session 是 append-only 的 `SessionEvent` 日志（内存真源）；模型上下文靠 Surface / `deriveMessages()` 派生，落盘靠 persistence 订阅 `session/event`，UI 状态靠另一套 session projection——都不另存一份对话历史。**（源码）

关联：[06 会话与恢复](./06-session-and-resume.md)（补账 / resume / fork）；[02 请求链路](./02-request-lifecycle.md)（用户提问到回复的九步）；官方 [session 子系统](../docs/subsystems/session.md)、[architecture Turn flow](../docs/architecture.md)。

## 1. 核心概念

| 概念 | 含义 |
|---|---|
| **Session** | 进程内一份仅追加的 `SessionEvent[]`；`seq` 连续，已提交不可改 |
| **SessionEvent** | `{ type, seq, time, data, … }`；类型由可声明合并的 `SessionEventMap` 定义 |
| **Surface** | 从日志折出的「模型可见消息节点」有序视图 |
| **deriveMessages()** | 把 Surface 折成发给 LLM 的 `Message[]`（增量缓存） |
| **turn / step** | turn = 一次驱动围栏（可含多 step）；step = 一次模型调用 + 它请求的工具 |
| **SessionStore (`ctx.sessions`)** | 内存注册表：create / enter / list / fork / flush；**不做落盘** |
| **SessionHandle / Persistence** | 持久化缝：订阅 `session/event` write-behind 到 JSONL |
| **Projection** | message projection 改模型可见内容；`sessionProjections` 折 title/todo 等客户端状态 |

数据流（源码）：

```text
写入方 (agent-loop / tools / plugins)
  → Session.append          # 内存真源，同步 commit
  → session/event           # 通知观察者
  → SessionHandle (JSONL)   # 异步落盘
  → Surface / deriveMessages  # 模型请求
  → sessionProjections        # 客户端状态
```

最重要的不变量（仓库根 `AGENTS.md` / architecture）：**Model-visible ⟺ logged**——进模型请求的事实必须能从日志重建。

## 2. 包与文件地图

| 层 | 包 / 路径 | 职责 |
|---|---|---|
| 内存真源 | `packages/core/session` (`dsh-session`) | `Session` / `SessionStore` / Surface |
| 驱动写入 | `packages/core/agent-loop` | turn/step 机，边界与消息 append |
| 工具写入 | `packages/core/tools` | `tool/call` / `tool/result` |
| 持久化 API | `packages/session/session-persistence` | `SessionHandle` |
| JSONL 后端 | `packages/session/session-persistence-jsonl` | `session.vN.jsonl[.zstd]` |
| 状态投影 | `packages/session/session-projection` | todo / title / stats 等 |

| 文件 | 角色 |
|---|---|
| [`packages/core/session/src/types.ts`](../packages/core/session/src/types.ts) | `SessionEventMap`、`SessionEvent`、`EpochHeader`、`SurfaceEventType` |
| [`packages/core/session/src/index.ts`](../packages/core/session/src/index.ts) | `Session`、`SessionStore` |
| [`packages/core/session/src/surface.ts`](../packages/core/session/src/surface.ts) | Surface 折算、`deriveEventMessage` |
| [`packages/core/session/src/request-header.ts`](../packages/core/session/src/request-header.ts) | `foldRequestHeader` |
| [`packages/core/agent-loop/src/agent.ts`](../packages/core/agent-loop/src/agent.ts) | `turn()` / `step()` / `buildRequest()` |
| [`packages/core/tools/src/batch.ts`](../packages/core/tools/src/batch.ts) | 工具批次结算与 append |

## 3. 事件词汇

### Surface（进模型历史，必须带 `surfaceOp`）

`system/message` · `developer/message` · `user/message` · `assistant/message` · `tool/result`

`SurfaceOp`（[`types.ts`](../packages/core/session/src/types.ts) 附近）：

- `'append'`：接到 surface 尾部
- `{ op: 'replace', startSeq, endSeq }`：用本节点遮住一段 surface（compaction 等）；**原始事件仍在日志里**，只是派生视图看不见

### Log-only（不进 `Message[]`）

`turn/start|end` · `step/start|end` · `request/header` · `request/context` · `tool/call` · `assistant/attempt` · `session/end-seed`

要点（源码）：

- 模型看到的「要调工具」在 `assistant/message` 的 content blocks 里；`tool/call` 只是执行侧配对记录，不是 Surface。
- 成功/可见结算 → `assistant/message`（内嵌 compact timed `stream`）；失败/取消无表面消息 → `assistant/attempt`。
- `request/header` 存完整 `EpochHeader` 快照（config + tools）；系统提示词**不在 header 里**，在 `system/message`（surface node 0）。`foldRequestHeader` 取最新快照重建请求信封。

## 4. 关键 API

```text
# 内存 Session
Session.create / Session.fromRestore
session.append(type, data, opts?)
session.deriveMessages()
session.requestHeader() / requestContext() / toolHistory()

# Store（ctx.sessions）
create | prepare | enter | announce | get | list | fork | flush
registerMessageProjection(...)

# 持久化（另一包）
persistence.create(header) / open(id, 'read'|'write')
handle.append / flush / close
```

Store 生命周期（有持久化时，源码 / agent-loop README）：`prepare` → persistence create/open → `enter` → `announce`（`session/created`）。裸 `create` 不绑 write handle，进程结束即失。

`append` 热路径：校验 JSON-serializable → 分配 `seq` → 提交 → 同步发 `session/event`；观察者失败不影响 append 返回。（源码）

## 5. 一次问答的 Session trace

### 前置

Host/SDK/Web 把用户输入放进 Agent inbox → loop 在 turn 边界 **claim** → 开 durable turn → 进 step。入队细节见 [02](./02-request-lifecycle.md)。

### A. 简单问答（无工具）

典型顺序（[`agent.ts`](../packages/core/agent-loop/src/agent.ts) 的 `turn` / `step` / `buildRequest`）：

1. `turn/start` `{ turn }`
2. `step/start` `{ turn, step }`
3. `system/message`（surface append，通常 node 0）
4. `user/message`（claimed 用户内容，surface append）
5. `request/header`（`reason: 'initial'|'resume'|…`；可能带 `startsSeries`）
6. 可选 `request/context`（provider / model / capacity 等相对上次变化时）
7. **`session.deriveMessages()`** → 冻结后作为 LLM `messages`
8. 流结束后 `assistant/message`（组装正文 + 内嵌 `stream` + 可选 `usage`）
9. `step/end`
10. `turn/end` `{ reason: { kind: 'completed' } }`（或 aborted / error / …）

失败重试可能先写 `assistant/attempt`（不进 surface）再重试；取消且已有可见文本 → `assistant/message` + `interrupted: true`。

Live UI 增量靠进程内 `agent/assistant-stream`；**持久化的是结算后的** `assistant/message` / `assistant/attempt`。

### B. 带一次工具调用（同一 turn 常两个 step）

**Step 1 — 模型请求工具**

1. `turn/start` → `step/start(1)`
2. `system/message` / `user/message` / `request/header`（同上）
3. `assistant/message` — content 含 `tool-call` block
4. `tools.execute`（[`batch.ts`](../packages/core/tools/src/batch.ts)）对每个 call：
   - `tool/call` `{ callId, name, arguments }`（log-only）
   - 执行完 `tool/result`（surface append，`callId` / `sourceEventSeqs` 配对）
5. `step/end(1)`

**Step 2 — 模型看结果再答**

6. `step/start(2)`（通常不再重复 admit 同一批 user）
7. 需要时再写 `request/header`（`change`/`series`），否则继承最新 snapshot
8. `deriveMessages()` 现含：system + user + assistant(with tool-call) + tool result …
9. `assistant/message`（最终文本）
10. `step/end(2)` → `turn/end`

Step 失败关闭前，loop 用 `ToolCallRecovery` 给未配对 call 补合成 `tool/result`（`TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`），再关 step/turn——与 [06](./06-session-and-resume.md) 的崩溃补账同一套 recovery 语义，场景不同。

### 同一次问答里 Session 做了什么 / 没做什么

| 做了 | 没做 |
|---|---|
| 同步 append + 广播 `session/event` | 自己调模型 |
| 维护 Surface / 缓存 `deriveMessages` | 自己决定 turn 策略（那是 loop） |
| 校验 JSON、`surfaceOp` 规则 | 保证落盘完成（checkpoint / `flush` 另有 policy） |

## 6. Store vs Persistence vs Projections

```text
SessionStore (内存 Map + publication)
  Session.append → session/event
        │
        ▼
SessionPersistence + SessionHandle
  write-behind → handle.append；ctx.sessions.flush → handle.flush
  路径形态：~/.dsh/sessions/<cwd>/<id>/session.vN.jsonl[.zstd]
        │
派生（都不改写日志）
  Surface / deriveMessages     → 模型 Message[]
  Message projections          → 改派生内容（如图像卸载）
  sessionProjections           → title / todo / stats
```

（落盘路径与 generation 选择细节见 persistence 子系统；本机路径形状在 [AGENTS.md 环境事实](./AGENTS.md)。）

## 7. 重要不变量（清单）

1. Model-visible ⟺ logged
2. Append-only + 连续 `seq`
3. append 点拒绝非 JSON-serializable `data`/`meta`
4. Surface 事件必须带 `surfaceOp`；log-only 禁止 surface 元数据
5. `tool/call` ≠ surface；工具意图在 `assistant/message` blocks
6. 一次 settled attempt 一条记录：`assistant/message` 或 `assistant/attempt`
7. `session/event` 观察者失败不回滚已提交事件
8. Store 拥有的 Session 在 `announce` 成功前只读；detach 后禁写
9. Compaction 用 `replace` 遮挡，不删除原始事件
10. `session/end-seed` 只应由构造 / `buildForkSeed` 写入（fork/resume 叙事见 [06](./06-session-and-resume.md)）

## 还没搞懂

1. **system prompt 调和细节**：`in-history` vs 无法力路由下，空/非空 `system/message` 如何 normalize、何时触发 `replace`？（机制见 [14](./14-prompt-assembly.md)；06 也问过；本文只标了 node 0）
2. **`request/context` 与 prepared call**：admission 用的是当前 prepared call 能力，还是日志里上一条 context？边界条件？
3. **checkpoint policy**：谁在何时 `flush`？turn 边界不 await flush 时，崩溃窗口多大？
4. **message projection 注册生命周期**：卸载已用过的 projection 如何挡住缓存读？
5. **本机对照**：对一条真实 `session.v4.jsonl.zstd` 解压，核对本篇 A/B 事件顺序（待实测）

## 读代码最短路径

1. [`docs/subsystems/session.md`](../docs/subsystems/session.md)
2. `types.ts` → `index.ts` → `surface.ts`
3. `agent-loop/.../agent.ts`（`turn` / `step` / `buildRequest`）
4. `tools/.../batch.ts`
5. persistence 子系统 + JSONL provider
