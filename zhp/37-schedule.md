# 定时任务 Schedule：作用、触发与实现

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@0377003146` |
| 证据 | 源码；权威见 [`packages/schedule/`](../packages/schedule/README.zh.md)、[`schedule` 包](../packages/schedule/schedule/README.zh.md)、[`docs/subsystems/schedule.zh.md`](../docs/subsystems/schedule.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Goal 续跑对照 [36](./36-goal.md)；斜杠命令 [35](./35-commands.md)；任务落盘经 storage-domain 对照 [45](./45-storage.md)。

## 一句话

**Schedule = Host 级持久任务（`ctx.schedule`）：按时间规则到期后，把指令当普通 follow-up 投进目标 Session。墙钟 `setTimeout` 睡到最近 `scheduledAt`，不是固定轮询，也不是 goal idle 驱动。**（源码）

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | Host 拥有的任务：重启后仍在；侧栏 + 模型工具共管 |
| **是** | 到期 → 目标 Session 的 user 消息（`source.kind: schedule`）→ 唤醒 agent |
| **不是** | Session 内状态权威（独立 storage domain） |
| **不是** | goal-round-driver（同会话 idle 续跑 → [36](./36-goal.md)） |
| **不是** | 推送通知；Host **必须在跑**才投递；重启后重复任务只补**最近一次**错过发生点 |

web-app / sdk-app 挂 `dsh-schedule`；`tool-schedule` 在 standard 等 preset，`minimal` 通常没有。

---

## 2. 包分工

| 包 | 职责 |
|---|---|
| [`schedule`](../packages/schedule/schedule/) | 存储、定时器、投递、管理 API（`ctx.schedule`） |
| [`tool-schedule`](../packages/schedule/tool-schedule/) | `schedule_create/list/view/edit` |
| [`ui-schedule`](../packages/client/ui-schedule/) | 侧栏管理 / 立即执行 |

---

## 3. 使用

**模型工具**（创建/改需用户授权）：`schedule_create`（title + prompt + **rrule** + target）、`list` / `view`、`edit`（update/pause/resume/delete）。

**目标：** `session`（this_session）| `new_once`（首次建后复用）| `new`（每次新建，默认最小间隔 60s）。

**时间种类：** `after` | `at` | `every` | `daily` | `weekly` | `cron` | `rrule`（模型侧主要 RRULE）。

状态：`active` / `paused` / `ended`。UI `run({ id })` 可立即投一次（不推进计划发生点）。

---

## 4. 怎么触发

**墙钟定时器 + 任务 `scheduledAt`，不是 idle 事件。**

```text
ScheduleRuntime
  → 算最近 active 任务的 scheduledAt（与投递地板取 max）
  → setTimeout 等到该点
  → requestDrive() → drive()
  → 筛 scheduledAt <= now 的 active 任务
  → 激活/创建目标 Session
  → agent.followup([SCHEDULE REMINDER]…, source: schedule)
  → flush → 写回执、推进下次 scheduledAt（或 ended）
  → 再设下一个 timer
```

### 谁叫醒 `requestDrive`

| 来源 | 作用 |
|---|---|
| **timer 到期** | 主路径 |
| **create / edit / pause / resume / delete / 投递提交** | 写完后重算 |
| **Host 启动载入** | 打开存储后立刻 drive（补最近错过的一次） |
| **UI `run`** | `runNow` 手动立刻投 |

工具只改任务；投递是 Runtime timer / `runNow`。

入口：[`runtime.ts` `requestDrive` / `drive`](../packages/schedule/schedule/src/runtime.ts#L97)。

---

## 5. 多久检查一次

**没有固定轮询。** 一个 `setTimeout` 睡到最近发生点：

```text
delay = clamp(next - now, 0, MAX_TIMER_DELAY_MS)
setTimeout(requestDrive, delay)
```

见 [`L213–L223`](../packages/schedule/schedule/src/runtime.ts#L213)。

| 常量 | 值 | 含义 |
|---|---|---|
| **`MAX_TIMER_DELAY_MS`** | **`2_147_483_647`**（约 **24.86 天**） | Node `setTimeout` 可靠上限；更远先醒再重算 |
| `MIN_EVERY_INTERVAL_SECONDS` | `60` | `every` / 投递地板等最小间隔（不是检查频率） |

无 active 任务 → 不设 timer，等下次管理写。

---

## 6. 实现要点

1. **权威在 Host storage**（`schedule` domain v2）；历史 session `schedule/change` 事件已冻结。
2. Cron/RRULE 算术在 `dsh-util-time`；Schedule 管策略与目标。
3. 管理与投递共 **FIFO**；崩溃可能重复投递；失败**无通用自动重试**。
4. 读/删不激活 Session；投递才 resolve agent。
5. 同 Session 上到期的重复 `session` 任务可批次一条消息。

---

## 与 Goal 对照

| | Schedule | Goal + round-driver |
|---|---|---|
| 存哪 | Host storage | Session `goal/change` |
| 触发 | 墙钟 / `scheduledAt` | agent **idle** + armed |
| 投递 | 任意目标 Session follow-up | **同一** Session `<goal_round>` |

---

## 还没搞懂

1. 本机建一条 shortly `at` 任务看 timer → followup → jsonl。
2. `new` 目标 `pendingDelivery` 崩溃恢复路径深读。
3. 批次提醒与 after/at 单条在模型 transcript 的呈现差异。

## 读代码最短路径

1. [组 README](../packages/schedule/README.zh.md) + [schedule 使用](../packages/schedule/schedule/README.zh.md#use-this-package)
2. [`ScheduleRuntime`](../packages/schedule/schedule/src/runtime.ts)：`requestDrive` / `drive` / `send`
3. [子系统](../docs/subsystems/schedule.zh.md)
