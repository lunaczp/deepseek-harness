# 用户问答 seam：作用、使用、实现与历史写入

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@049f6d4643` |
| 证据 | 源码；权威见 [`user-questions`](../packages/interaction/user-questions/README.zh.md)、[`tool-ask-user`](../packages/interaction/tool-ask-user/README.zh.md)、[`docs/subsystems/user-questions.zh.md`](../docs/subsystems/user-questions.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。工具结果时机 [17](./17-tools.md)；审批对照 [30](./30-approval.md)；计划评审 [33](./33-plan-mode.md)。

## 一句话

**`dsh-user-questions` = 人机结构化问答 seam（`ctx.userQuestions`）：`ask()` 挂起等 UI；模型工具是旁路的 `ask_user_question`。默认阻塞；仅 `mode: timed` 可超时 pending 后继续，迟到答案另记一条用户消息。**（源码）

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | 提供方无关的「问人 → 结构化答案」词汇与服务 |
| **是** | Agent-scoped waterfall；Web / SDK / 本地 listener 认领 |
| **是** | 呈现意图 `plan-review` / `approval`（只改 UI，不改协议） |
| **不是** | 模型工具本体（[`tool-ask-user`](../packages/interaction/tool-ask-user)） |
| **不是** | `ctx.approval` 授权引擎（呈现可走本 seam，判定归调用方） |
| **不是** | 计划模式状态机（[33](./33-plan-mode.md) 用本 seam 做评审） |

---

## 2. 使用

| 调用方 | 路径 |
|---|---|
| 模型 | `ask_user_question` → `ask` / `askTimed` |
| 计划模式 | `exit_plan_mode` → 阻塞 `ask` + `plan-review` |
| 权限 / CUA 等 | `ask` + `approval` intent |
| SDK | `onUserQuestion` 或挂 `user-questions/request` |

API：`ask`、`askTimed`、`answer`（@Remote，continued）、`attachWait`（倒计时接手）。

约束：带 `agent` 须存活运行时根；subagent → `DELEGATED_CALLER`；无 answerer → `NO_PROVIDER`。

### 阻塞 vs timed

| | legacy（产品默认） | `mode: timed` |
|---|---|---|
| 行为 | `ask()` 同步卡住 `execute` | 前台窗口；超时 → `{ pending }`，Turn 可继续 |
| 默认超时 | 无（一直等到答/取消） | **120 秒**（`config.timeout`；模型可按次改；`-1` = 无限等） |
| 允许「问了先走、可不答」 | **否** | **是**（超时后；问题仍可晚答） |

随附 preset / base **未**配 `mode: timed`，日常是 legacy 阻塞。

---

## 3. 消息历史怎么写

**`ask` 本身不写会话消息**——只是进程内等 waterfall。问题已在 `tool/call`（及 assistant tool-call 参数）里。

### 窗口内答完 / legacy 阻塞

```text
assistant/message（含 tool-call）
  → tool/call          # execute 开始即落（log-only）
  → await ask / askTimed
  → tool/result        # 答案在这一条；无单独 answer 消息
```

不是「ask 一条 + answer 一条」，也不是「两端齐了合成一条」。

### Timed 超时后迟到答

```text
tool/result { pending }              # 超时当时
…
user/message (user-question-reply)   # answer() steer；另记一条，不回填改 tool/result
```

`answer()` 只用于 **continued**（已 pending）路径。

### `tool/result` 何时插入

**不是 step 边界。** 该次工具 settle 时立刻 `append`（[`batch.ts` `commit`](../packages/core/tools/src/batch.ts#L252)）；`step/end` 在整批工具之后。等人时：可已有 `tool/call`、尚无 `tool/result`、也未到 `step/end`。

---

## 4. 实现要点

```text
ask / askTimed
  → 校验 questions / intent / live root
  → waterfall 'user-questions/request'（有 agent 则 scope）
       → UI answerer 返回答案
       → 无人 → NO_PROVIDER

askTimed → TimedQuestionWait；Client attachWait
超时 → pending；continued → answer RPC → steer user-question-reply
```

投影 `userQuestions` 从 tool/call·result·迟到 user/message 折叠；不另存 deadline/草稿。
入口：[`UserQuestionService`](../packages/interaction/user-questions/src/index.ts#L79)；Web：[`ui-user-questions`](../packages/client/ui-user-questions/src/client/index.ts)。

---

## 与相邻模块

| 模块 | 关系 |
|---|---|
| [33](./33-plan-mode.md) | `exit_plan_mode` 阻塞评审 |
| [30](./30-approval.md) | 授权在 approval；呈现可走 `approval` intent |
| [17](./17-tools.md) | `tool/call` / `tool/result` 时机 |

---

## 还没搞懂

1. Web 卡片「慢慢回答」与 Host deadline / attachWait 的交互实测。
2. PTC 子调用 pending 进投影的边界。
3. 本机 legacy vs timed 各走一遍看 jsonl 事件序。

## 读代码最短路径

1. [user-questions README](../packages/interaction/user-questions/README.zh.md) + [子系统](../docs/subsystems/user-questions.zh.md)
2. [`ask` / `askTimed` / `answer`](../packages/interaction/user-questions/src/index.ts#L169)
3. [`tool-ask-user`](../packages/interaction/tool-ask-user/src/index.ts) + [`timed.ts`](../packages/interaction/tool-ask-user/src/timed.ts)
4. [`batch.commit`](../packages/core/tools/src/batch.ts#L252)
