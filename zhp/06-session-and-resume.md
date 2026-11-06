# 会话与恢复：中断的 turn 为什么是"关闭"而不是"续跑"

| | |
|---|---|
| 状态 | 学习中（讲解已完成，待补 surface 投影） |
| 日期 | 2026-11-06 |
| 基线 | `zhp@3fdf527f73`（master `fcc0ad4621`） |
| 证据 | 源码为主；无实测 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**DSH 恢复会话不做"续命"，只做"补账"——给没闭合的 turn 补上合成事件把它关掉，再让模型在下一轮自己决定要不要重试。**（源码）

## 1. 日志里有什么

一个 session 是一条只能追加的事件流，事件带 `seq` 与 `time`（[types.ts:287](../packages/core/session/src/types.ts#L287) 附近）。

| 事件 | 记什么 |
|---|---|
| `turn/start` / `turn/end` | 一轮的边界，`turn/end` 带 `reason` |
| `step/start` / `step/end` | 一次模型调用 + 它请求的工具执行 |
| `system/message` / `user/message` / `assistant/message` | 模型可见的消息面 |
| `tool/call` | 工具名 + 原始 JSON 参数（未解析） |
| `tool/result` | 工具结果 |
| `request/header` | 调用配置快照（provider、model、采样参数、工具集） |
| `session/end-seed` | 只在 fork 种子末尾，标记继承边界 |

`turn/end` 的 `reason` 有一组取值：`completed`、`aborted`、`blocked`、`error`、`max-tokens`，以及两个特殊成员——**`interrupted`** 和 **`forked`**。运行中的循环永远不会发出后两者，只有崩溃恢复与 fork 才会写。（源码）

## 2. 为什么不能续跑

崩溃瞬间有三件事同时未知：

1. **模型流可能在中途**：`assistant/message` 只保存已交付的前缀，没吐完的部分随进程消失。
2. **工具可能执行了一半**：`tool/call` 已落盘、`tool/result` 没有；副作用可能已经发生。
3. **内存状态没了**：重试所需的中间数据不在磁盘上。

续跑等于假装知道这三件事。DSH 选择不假装：把未知显式写进日志，交给模型处理。

## 3. 补账的步骤

恢复路径（[agent-loop/index.ts:791](../packages/core/agent-loop/src/index.ts#L791) 的 resume）：

```
拿写锁 open(id, 'write')
  → 读整段日志
  → interruptedTurnClosers(events)
  → 把合成事件 append 回去
  → 用「原日志 + 合成事件」重建 Session
```

`interruptedTurnClosers`（[repair.ts:56](../packages/core/session/src/repair.ts#L56)）做四件事：

1. 顺序扫描，维护 `openTurn` / `openStep` 游标，遇到闭合事件就清空；
2. `openTurn === null` 说明日志已平衡，**什么都不做**；
3. 否则先补未回答的 `tool/result`，再补 `step/end`，最后补 `turn/end { reason: 'interrupted' }`；
4. 合成的 `seq` 接着最后一条真实事件递增，`time` **复用最后一条真实事件的时间**，不发明"未来"时间戳，保证可复现。

## 4. 补出来的工具结果说了什么

两种恢复码：

- `TOOL_NOT_STARTED`：连"开始执行"都没记到 → "它没开始，需要就重试"。
- `TOOL_OUTCOME_UNKNOWN`：记到开始、没有结果 → "结果未知。只读或幂等的操作可以重试；可能有副作用的，先核实外部状态或询问用户。不要盲目重试。"

措辞是写给模型看的：把"系统不知道结果"翻译成"你下一步该怎么决策"。

## 5. resume 与 fork

| | resume | fork |
|---|---|---|
| session id | 不变 | 新建 |
| 日志 | 原地追加闭合事件 | 复制前缀到 boundary，追加 `session/end-seed` + 闭合事件 |
| `turn/end` reason | `interrupted` | `forked` |
| 语义 | 崩溃恢复 | 从某点分叉 |
| 边界记录 | — | `inheritedEventCount` |

同一个 `openTurnClosers` 机制（[fork.ts:22](../packages/core/session/src/fork.ts#L22)），两套叙事：fork 的合成结果说的是"父会话可能在 fork 点之后完成了它"，而不是"崩溃了"。机制复用，语义按场景定制。

## 6. 对"重启"的意义

**turn 边界是唯一安全的重启点。** 进程在 turn 中途消失，日志会被补成"关闭"，不会留下半个 turn；新进程 resume 后看到的是"上一轮已结束"。于是自我重启退化成一次普通的进程替换 + 一次普通的 resume，不需要断点续传。

## 还没搞懂

1. **surface 投影**：日志事件怎么变成发给模型的 `messages`？`SurfaceOp` 的 `append` / `replace` 解决什么问题？
2. **system prompt 恢复**：`system/message` 是 surface 的 0 号节点，resume 时怎么重放？
3. **compaction**：压缩后日志怎么写？恢复读压缩前还是压缩后的段？
4. **`request/header`**：为什么每次请求落完整快照，而不是只记变化？
