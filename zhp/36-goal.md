# 同会话 Goal：作用、使用、实现

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@8b437ceb94` |
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

### 自动续跑（挂了 driver）

agent **idle** + `active` + `armed` + 未满 `maxGoalRounds` → 排入 `<goal_round>`（goal 来源 user/message）→ 计一轮。
额度耗尽 → `block`（`round-limit`）。恢复/fork **不会**自动 arm。

配置：`defaultMaxGoalRounds` 默认 **256**（create 可覆盖）。

---

## 4. 实现

```text
变更 → append goal/change（完整快照或 clear 墓碑）→ 投影折叠 → goal/changed
roundsStarted ← 仅「获准进入步骤」的 goal 来源 user/message（连续 round）

driver（idle）:
  预留 roundsStarted+1 → inbox 排 goal_round
  pre-step 校验 revision / 竞争人类输入
  准入后才真正消耗 round

tool-goal:
  执行时查 turnBoundary + 人类权威 / 是否当前 goal round
  自主 complete|blocked → 可 wrapup 结束物理轮次
```

要点：

1. **CAS**：变更带精确 `{ id, revision }`，陈旧拒绝。
2. **activation 不持久**：新进程 / `agent/created` → disarmed。
3. **严格回放**：非法 phase、revision/round 缺口 → 投影失败后服务拒访问。
4. **goal ≠ 调度**：只挂 `dsh-goal` 只存状态；无人值守多轮需再挂 driver + tool-goal。

入口：[`GoalService`](../packages/goal/goal/src/index.ts)、[`fold.ts`](../packages/goal/goal/src/fold.ts)、driver [`index.ts`](../packages/goal/goal-round-driver/src/index.ts)、[`tool-goal`](../packages/goal/tool-goal/src/index.ts)。

---

## 与相邻模块

| 模块 | 关系 |
|---|---|
| [33](./33-plan-mode.md) | 计划评审 vs 长期目标对象；可先后用 |
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
3. driver / tool-goal / command-goal 各自 README「使用」节
