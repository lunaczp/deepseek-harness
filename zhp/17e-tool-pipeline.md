# 工具执行流水线：设计、调用处、批次与并发

| | |
|---|---|
| 状态 | 学习中（源码走读；无本机多 call 并行实测） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@3397d6ba79` |
| 证据 | 源码；权威见 [`pipeline.ts`](../packages/core/tools/src/pipeline.ts)、[`batch.ts`](../packages/core/tools/src/batch.ts)、[`docs/tool-execution-pipeline.zh.md`](../docs/tool-execution-pipeline.zh.md)、[`tools` README.zh](../packages/core/tools/README.zh.md)、[并行 ADR](../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.zh.md)、[timeout ADR](../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。注册表总览 [17](./17-tools.md)；Native/PTC [24](./24-ptc.md)；Session 事件 [12](./12-session-implementation.md)。

## 一句话

**`ToolExecutionPipeline` 专门编排「单次」工具调用的门禁→分发→冻结结果；`executeToolBatch` / PTC 子调度编排「多条」call 的并行与 Session 顺序。Loop 只抽出模型 `tool-call` 再 `ctx.tools.execute`。**（源码）

---

## 1. 设计原因

| 动机 | 做法 |
|---|---|
| 扩展不改 loop | 策略挂 waterfall / guard，不硬编码进 agent-loop（AGENTS：plugins, not loop changes） |
| 横切与工具解耦 | `bash`/`read` 只写 `execute`；审批、超时、spill 旁路挂载 |
| Native 与 PTC 共用 | 根调用与 `run_code` 子调用都进同一套阶段 |
| 失败是结果 | deny / 抛错 → 通常 `isError` 的 `tool/result`，不默认掀翻 turn |
| 审计与展示一致 | 先物化冻结 `arguments` → `tool/call` → 再策略；不做参数改写（[proposed note](../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.zh.md)） |

超时为何用 `tools/execute` around：生命周期跨 pre+post 难清理 → [timeout ADR](../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.zh.md)。

---

## 2. 原理：单次调用阶段

[`ToolExecutionPipeline`](../packages/core/tools/src/pipeline.ts)：`prepare` → `dispatch` → `complete`。

```text
prepare
  参数快照+冻结 · 铸 token · 已 abort → 跳过策略
  tools/pre-execute → allow | deny | ask | cancel
  ask → ctx.approval（allowed-once 才过）
  tools.guard() 单调拒绝（不能再被 allow 救回）
  → dispatch | 早退结果

dispatch
  tools/execute 环绕（可换 signal，再与调用方 signal 融合）
  tool.execute(args, exec)
  → 规范值 + projectContent

complete
  tools/post-execute → accept | block
  finalizeContent（定义自有、仅改 content）
  快照冻结 → tools/result（只观测）
  → Session tool/result
```

| 不变量 | 含义 |
|---|---|
| 身份保护 | `name`/`callId`/`arguments` 进策略后只读冻结 |
| Waterfall 必须 `next()` | 不调就短路 |
| Guard 单调 | 只有 deny / 弃权，无 allow |
| 并发 fail-closed | 仅 `isConcurrencySafe(args) === true` 才 parallel |
| pre/post 按模型序 | 只有 body/dispatch 可重叠（[并行 ADR](../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.zh.md)） |
| 取消协作 | 已启动 body 排空后再 `ABORTED`；未启动 → `ABORTED_BEFORE_DISPATCH` |
| `tools/result` 只读 | 终态已冻结 |

决策类型：[`PreToolDecision` / `PostToolDecision`](../packages/core/tools/src/contracts.ts#L357)。图：[tool-execution-pipeline.zh.md](../docs/tool-execution-pipeline.zh.md)。

---

## 3. 分工：pipeline vs batch vs loop

| 层 | 职责 |
|---|---|
| **Pipeline** | 编排**一次** tool 执行（策略 + body + 冻结结果） |
| **`executeToolBatch` / PTC driver** | 编排**多条** call 的并行/串行与 `tool/call`·`tool/result` 顺序 |
| **Loop** | 抽出模型 `tool-call` → `ctx.tools.execute` |
| **ToolExecutor** | 模型看见什么 + 是否走 batch / 嵌套调度（[24](./24-ptc.md)） |

---

## 4. 生产调用处

```text
agent-loop
  → ctx.tools.execute(batch)
  → NativeToolExecutor | PtcExecutor.execute
       ├─ 根批次：executeToolBatch(…, pipeline)
       │     → executionMode / prepare / dispatch / complete
       └─ PTC 子调用：ptc.ts 直接 prepare / dispatch / complete
```

| 位置 | 做什么 |
|---|---|
| [`agent.ts` ~L590](../packages/core/agent-loop/src/agent.ts#L590) | `tools.execute({ calls, … })` —— 入口，不直接碰 pipeline |
| [`tools/index.ts` L375–L377](../packages/core/tools/src/index.ts#L375) | `selectExecutor(…).execute(input)` |
| [`tool-executor-native` L12, L19–L20](../packages/core/tool-executor-native/src/index.ts#L12) | `new ToolExecutionPipeline` → `executeToolBatch` |
| [`tool-executor-ptc` L39, L60–L61](../packages/core/tool-executor-ptc/src/index.ts#L39) | 同上（带 PTC `get`/`reject`） |
| [`batch.ts` L50+](../packages/core/tools/src/batch.ts#L50) | 分组并发；内部 ~L80/L144/L159/L163 调 pipeline |
| [`ptc.ts` L597–L611](../packages/core/tool-executor-ptc/src/ptc.ts#L597) | `run_code` 嵌套：直接 prepare→dispatch→complete |

测试夹具：[`tool-testkit` `executeToolFixture`](../packages/test-support/tool-testkit/src/index.ts#L62)；各 `*.spec.ts` 测 `executionMode`。

---

## 5. 批次请求与并行：模型告知什么

### 5.1 模型可以一次要多个 tool

一条 assistant 消息多个 `tool-call` block → 整包进 `execute(calls[])`（[`agent.ts` L586–L593](../packages/core/agent-loop/src/agent.ts#L586)）。
模型**告知**的是：调谁、参数、顺序。**不是**「请并行」。

### 5.2 哪些能并行：宿主决定

[`batch.ts`](../packages/core/tools/src/batch.ts)：对下一个 call 算 `executionMode` → exclusive 单跑 / parallel 尽量成组；再受 `maxParallelToolCalls`（agent-loop 默认 **10**，`1` = 全串行）。

`executionMode`（[`pipeline.ts` ~L105](../packages/core/tools/src/pipeline.ts#L105)）：

| 条件 | 结果 |
|---|---|
| 无 `isConcurrencySafe` | exclusive |
| `isConcurrencySafe(args) === true` | parallel |
| 其它真值 / 抛错 / 未知工具 | exclusive |

### 5.3 `isConcurrencySafe`：工具定义决定

`ToolDefinition` 可选字段（[`contracts.ts` L83](../packages/core/tools/src/contracts.ts#L83)）；作者在 `defineTool` 声明。

- 不写 → exclusive
- 可按 **本次 args** 判断（同工具读写分流）
- **不进**模型 schema

例：`read` 有 `() => true`（[`read.ts` L136](../packages/fs/tool-fs/src/read.ts#L136)）；`write` 通常不声明。

| 模型会告知 | 模型不会告知 |
|---|---|
| 一次几个 call、名字、参数、顺序 | 某 call 是否 concurrency-safe |
| PTC 里自己写不写 `Promise.all`（SDK 建议可读可叠） | Native 无 `parallel: true` 协议字段 |

---

## 6. 使用：谁挂扩展点

| 角色 | 做法 |
|---|---|
| 工具作者 | `defineTool({ execute, timeoutMs?, isConcurrencySafe?, … })` |
| 策略插件 | `tools/pre-execute`、`tools.guard`、`tools/execute`、`tools/post-execute`、`tools/result` |
| Loop | 只 `tools.execute` |

典型挂载：[`timeout-policy`](../packages/guard/timeout-policy/)（around）、[`spill-policy`](../packages/spill/spill-policy/)（post）、permission/hooks（pre）。

---

## 还没搞懂

1. 本机一次多 `read` 并行的 jsonl：`tool/call` 交错与 `tool/result` 按模型序提交。
2. 组内后位 call 再分类成 exclusive 时的 drain 时序对照。

## 读代码最短路径

1. [流水线图](../docs/tool-execution-pipeline.zh.md)
2. [`pipeline.ts`](../packages/core/tools/src/pipeline.ts) prepare / dispatch / complete
3. [`batch.ts`](../packages/core/tools/src/batch.ts) + [`agent.ts` L586+](../packages/core/agent-loop/src/agent.ts#L586)
4. PTC 嵌套：[ptc.ts L597+](../packages/core/tool-executor-ptc/src/ptc.ts#L597)
