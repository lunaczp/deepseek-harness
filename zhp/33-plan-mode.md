# 计划模式：作用、使用、实现

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@1de2709fa4` |
| 证据 | 源码；权威见 [`plan-mode`](../packages/plan/plan-mode/README.zh.md)、[`docs/subsystems/plan.zh.md`](../docs/subsystems/plan.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。提示词段落 [14](./14-prompt-assembly.md)；工具 [17](./17-tools.md)；审批闸门对照 [30](./30-approval.md)；沙箱对照 [32](./32-sandbox.md)；评审通道 [34](./34-user-questions.md)；长期目标对照 [36](./36-goal.md)。

## 一句话

**计划模式 = 记在会话日志里的软性协作状态：`/plan` 开启后注入部署写好的 `plan:policy`；模型用 `exit_plan_mode` 呈交计划，用户确认后退出。不挡工具，也不改沙箱/审批。**（源码）

主干流程：

```text
人 /plan → 注入 plan:policy
  → 模型探索 / 写计划
  → exit_plan_mode（# 标题 markdown）
  → 人 Approve | Keep planning | 关掉评审
  （也可直接 /plan off，不经模型）
```

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | 逐 agent 协作状态：先探索设计，再经评审再执行 |
| **是** | `plan/mode` 仅记日志、可恢复 / fork / compaction |
| **不是** | 沙箱或审批闸门（工具仍可调；强制限制另配 → [32](./32-sandbox.md)、[30](./30-approval.md)） |
| **不是** | `todo_write`（规划期禁；批准后实现跟踪才用——base `section` 写明） |
| **不是** | 可换后端的 capability seam（产品包，状态/命令/工具集中一处） |

base 默认挂载并配长段指引：[`cordis.patch.yml` L336–L350](../packages/bundle/base/cordis.patch.yml#L336)。

---

## 2. 使用

**人：**

| 操作 | 效果 |
|---|---|
| `/plan` | 进入 |
| `/plan <消息>`（可带附件） | 进入 + 消息/附件作下一步用户输入 |
| `/plan off` | 离开；带附件会拒绝 |
| UI `{ active, pending }` | 是否激活、变更是否仍待生效 |

**模型（激活时）：** 系统提示多一段 `plan:policy`；就绪后调 `exit_plan_mode`，计划须以 `#` 标题开头。

**评审：**

| 选择 | 结果 |
|---|---|
| Approve | `{ approved: true }`；pending 退出，下一步执行 |
| Keep planning | 工具失败带回反馈，继续改计划 |
| 关掉评审 | `{ approved: false }`，本轮结束，模式仍开 |

无交互通道时 `exit_plan_mode` 失败；人仍可用 `/plan off`。

**部署：** 只配必填 `section`；未知键加载失败。

```yaml
- name: '@deepseek-ai/dsh-plan-mode'
  config:
    section: |
      You are in plan mode. ...
```

---

## 3. 实现

```text
/plan 或 ctx.planMode.set
  →（轮次空闲）立即 append plan/mode
  →（轮次进行中）pending → 下一个被接受的 agent/pre-step 再 append

激活 → systemPrompt 渲染 plan:policy（order PLAN_POLICY）
首次激活起 → exit_plan_mode 准入（会话内之后一直声明）

exit_plan_mode
  → userQuestions.ask（intent: plan-review）
  → Approve：静默 pending 退出 → 下个 pre-step 写 plan/mode{active:false}
     （本批工具剩余步骤仍保留计划指引）
```

要点：

1. **状态**：`plan/mode { active }` 整值替换，**不进**模型 transcript。投影 `plan` → 客户端 `{ active, pending }`（[`types.ts`](../packages/plan/plan-mode/src/types.ts)、[`index.ts` L135–L167](../packages/plan/plan-mode/src/index.ts#L135)）。
2. **待生效**：轮次内 `set` 进内存；唯一落盘在 `agent/pre-step` 下游接受后（[`L211–L228`](../packages/plan/plan-mode/src/index.ts#L211)、[`set` L431–L451](../packages/plan/plan-mode/src/index.ts#L431)）。最后一次 pre-step 之后的选择若进程退出会丢。
3. **软约束**：不滤工具；KV cache 稳定故突变工具仍列出，靠文案覆盖。
4. **退出工具渐进披露**：`when: selectedActive || entered`（[`L375`](../packages/plan/plan-mode/src/index.ts#L375)）——从未进过的会话请求里没有该工具。
5. **与审批分工**：计划评审走 `userQuestions` + `plan-review`；沙箱升权走 `ctx.approval`。

服务：`ctx.planMode.get` / `.set` → `'committed' | 'queued' | 'cancelled' | 'noop'`。

---

## 与相邻模块

| 模块 | 关系 |
|---|---|
| [30](./30-approval.md) / [32](./32-sandbox.md) | 正交；要「计划期真不能写」另配 |
| todo | 规划阶段禁；批准后实现跟踪 |
| [user-questions](./34-user-questions.md) | `exit_plan_mode` 评审通道（阻塞 `ask`） |
| [commands](./35-commands.md) | 有 `ctx.commands` 才注册 `/plan` |
| [14](./14-prompt-assembly.md) | `plan:policy` 段落注入 |

---

## 还没搞懂

1. Web `plan-review` 呈现与通用选项流程的 UI 差异深读。
2. Subagent Session 禁止打开评审、历史 fork 仍可评审的边界。
3. 本机走一遍 `/plan` → `exit_plan_mode` → Approve 的事件序列。

## 读代码最短路径

1. [包 README · 使用](../packages/plan/plan-mode/README.zh.md#use-this-package)
2. [`PlanModeController`](../packages/plan/plan-mode/src/index.ts)：`init` / `set` / `exit_plan_mode`
3. [子系统](../docs/subsystems/plan.zh.md)
4. base [`section`](../packages/bundle/base/cordis.patch.yml#L336)
