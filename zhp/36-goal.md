# 同会话 Goal：作用、使用、实现

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@50e10f9617` |
| 证据 | 源码；权威见 [`packages/goal/`](../packages/goal/README.zh.md)、[`goal` 包](../packages/goal/goal/README.zh.md)、[`docs/subsystems/goal.zh.md`](../docs/subsystems/goal.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。斜杠命令 [35](./35-commands.md)；计划模式对照 [33](./33-plan-mode.md)；subagent [29](./29-subagent.md)。

## 一句话

**goal = 同会话一条持久「完成目标」：状态进日志、跨恢复/fork；本身不调度。工具 / `/goal` / round-driver 分别负责模型读写、人控、自动续跑。**（源码）

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | 每会话**至多一个**当前目标：objective + phase + round 上限 + revision |
| **是** | 事件溯源：`goal/change` 为唯一持久权威；投影供 Client |
| **不是** | 调度器（只存状态；自动续跑是可选 `goal-round-driver`） |
| **不是** | 计划模式（[33](./33-plan-mode.md)：软指引 + 评审） |
| **不是** | `todo_write`（实现清单） |
| **不是** | 并行多目标 / 常规单轮闲聊该建的东西 |

**持久 phase：** `active` | `paused` | `blocked` | `complete`
**进程本地：** `activation` = `armed` | `disarmed`（续跑是否启用；**不落盘**；resume/fork 后 active 也会 disarmed，需人显式 resume）

---

## 2. 包分工

| 包 | 职责 | ctx |
|---|---|---|
| [`goal`](../packages/goal/goal/) | 领域：create/edit/pause/resume/complete/block/clear | `ctx.goals` |
| [`tool-goal`](../packages/goal/tool-goal/) | `get_goal` / `create_goal` / `update_goal` | `ctx.tools` |
| [`command-goal`](../packages/goal/command-goal/) | `/goal` | `ctx.commands` |
| [`goal-round-driver`](../packages/goal/goal-round-driver/) | idle 时自动排 Goal Round | 无服务键 |

base：[`cordis.patch.yml` L327–L334、L452](../packages/bundle/base/cordis.patch.yml#L327)。

---

## 3. 使用

### 人：`/goal`（[35](./35-commands.md)）

| 输入 | 效果 |
|---|---|
| `/goal` | 看当前目标 / phase / rounds / activation |
| `/goal <objective>` | 创建并 arm；或替换已 **complete** 的 |
| `/goal edit …` | 改 objective，不改 phase |
| `/goal pause` / `resume` / `clear` | 暂停 / 恢复（含 re-arm）/ 清除 |

create/edit 可带附件 → 成功后再 steer 一条普通用户消息（附件 + 固定文案）。

### 模型：工具

| 工具 | 要点 |
|---|---|
| `get_goal` | 读当前；无则 `null` |
| `create_goal` | 须**人类直接**的根轮次权限 |
| `update_goal` | CAS：`goal_id` + `revision`；edit/pause/resume/complete/blocked |

- create/edit/pause/resume：要人类直接消息；**不能**由 subagent 发起
- complete/blocked：也可在**当前 Goal Round**；`blocked` 默认连续 ≥3 获准 Round（`blockedAfterConsecutiveRounds`）
- 持久 `paused` 的 resume 归人；模型 `resume` 会拒

配置：`defaultMaxGoalRounds` 默认 **256**（create 可覆盖）。

---

## 4. 生命周期

### 两轴

| 轴 | 值 | 是否持久 |
|---|---|---|
| **phase** | `active` / `paused` / `blocked` / `complete` | 是（`goal/change`） |
| **activation** | `armed` / `disarmed` | **否**（恢复/fork/`agent/created` → disarmed） |

无当前目标 = `get()` → `undefined`。

### 持久 phase 流转

```text
                    create（可替换已 complete）
                         │
                         ▼
              ┌───── active ◄──── resume ─────┐
              │         │                      │
              │         │ pause                │
              │         ▼                      │
              │      paused ───────────────────┤
              │         │                      │
              │         │ block（仅从 active）   │
              │         ▼                      │
              │      blocked ──────────────────┘
              │         │
              │         │ complete（active|paused|blocked）
              │         ▼
              │      complete ──create──► 新 id 的 active
              │
              └── clear ──► 无当前目标（日志留 tombstone）
```

| 操作 | 从 → 到 | activation |
|---|---|---|
| **create** | 无 / 仅 `complete` 可被换 → `active` | **armed** |
| **edit** | 任意当前；**不改 phase** | 保持原样 |
| **pause** | `active` → `paused` | disarmed |
| **resume** | `active`(已 disarmed) / `paused` / `blocked` → `active` | **armed**（须仍有 round 额度） |
| **block** | 仅 `active` → `blocked` | disarmed |
| **complete** | `active`\|`paused`\|`blocked` → `complete` | disarmed |
| **clear** | 任意当前 → 无 | disarmed |
| **disarm()** | 不改 phase | → disarmed（不写 revision） |

未完成 goal **不能**被另一个 `create` 顶掉。每次获准变更 `revision++`，CAS 须带精确 `{ id, revision }`。

`active + armed` → driver 可续；其它组合不自动续。实现：[`GoalService`](../packages/goal/goal/src/index.ts#L305)。

---

## 5. goal-round-driver：谁触发、怎么跑

**没有人直接调用 driver API。** 组合挂载后 `apply(ctx)` 注册监听；**事件** → `requestDrive` → `drive()`。

`ctx.on(...)` 不在 `apply` 顶层，而在 [`ctx.effect(function* () { … })` L261](../packages/goal/goal-round-driver/src/index.ts#L261) 内（易漏）。

| 事件 | 作用 |
|---|---|
| **`agent/status` → idle** | 主触发：空闲后尝试排下一轮 |
| **`goal/changed`** | create/resume 等后标检查点再驱动 |
| **`agent/pre-step` 拒旧 round** | 清预留后重试 |
| inbox / session 边 | 改 attempt 状态 |

加载时对已有 agent **全部 disarm**；挂插件 ≠ 开续跑。

可驱动条件：`phase === 'active'` ∧ `activation === 'armed'` ∧ idle ∧ 无竞争 inbox ∧（可选）子树空闲 ∧ 未满额。

```text
drive:
  flush 检查点 → 预留 roundsStarted+1
  → followup(<goal_round>, source:{kind:goal,…})
  → claimed → pre-step 双检 → startsRequestSeries
  → user/message 准入后才消耗 roundsStarted
额度满 → block(round-limit)
```

先预留、后准入；人类插队 → competing / stale，自动 round 让行。

---

## 6. 实现（领域侧）

```text
变更 → append goal/change → 投影折叠 → goal/changed
roundsStarted ← 仅获准进入步骤的 goal 来源 user/message
tool-goal：执行时查权威；自主 complete|blocked 可 wrapup
```

要点：CAS；activation 不持久；严格回放；只挂 `dsh-goal` 不调度。

入口：[`GoalService`](../packages/goal/goal/src/index.ts)、[`fold.ts`](../packages/goal/goal/src/fold.ts)、driver [`index.ts`](../packages/goal/goal-round-driver/src/index.ts)、[`tool-goal`](../packages/goal/tool-goal/src/index.ts)。

---

## 7. 与 Plan 的区别

| | Plan（[33](./33-plan-mode.md)） | Goal（本篇） |
|---|---|---|
| **是什么** | 软协作模式：先探索再交计划给人审 | 持久完成目标：跨多轮记住要干成什么 |
| **状态** | `plan/mode { active }` | phase + revision + rounds；另有 `armed/disarmed` |
| **对人** | `/plan`；`exit_plan_mode` 评审 | `/goal` 生命周期 |
| **对模型** | `plan:policy`；`exit_plan_mode` | `get/create/update_goal`；可选 `<goal_round>` |
| **约束** | 文案软指引（工具仍在） | 状态机 + CAS；driver 按 armed 续 |
| **调度** | 无 | 可选 round-driver |
| **每会话** | 开/关模式 | **至多一个**当前 goal |

可先后用（先 plan 定方案，再 goal 盯落地）；**不互相读写**。
todo = 实现清单，与二者都不同。

---

## 与相邻模块

| 模块 | 关系 |
|---|---|
| [33](./33-plan-mode.md) | 见上节对照 |
| [35](./35-commands.md) | `/goal` 注册面 |
| [29](./29-subagent.md) | 子 agent 不能 create/edit；driver 等后代 idle |
| session 投影 | `goal` 单元 → Client 当前视图 |

---

## 还没搞懂

1. Web UI 对 activation / blocked 卡片的呈现深读。
2. 本机 `/goal` → driver 自动 round → `complete` 的 jsonl 事件序。
3. `blockedAfterConsecutiveRounds` 与模型指引文案是否始终同源实测。

## 读代码最短路径

1. [组 README](../packages/goal/README.zh.md) + [goal 使用](../packages/goal/goal/README.zh.md#use-this-package)
2. [子系统](../docs/subsystems/goal.zh.md)
3. driver：[`apply` + `ctx.effect` L261](../packages/goal/goal-round-driver/src/index.ts#L261)；生命周期：[`GoalService` L305+](../packages/goal/goal/src/index.ts#L305)
