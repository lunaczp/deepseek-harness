# 斜杠命令注册表：作用、使用、实现

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@c4b74b6b2e` |
| 证据 | 源码；权威见 [`commands`](../packages/interaction/commands/README.zh.md)、[`docs/subsystems/commands.zh.md`](../docs/subsystems/commands.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。scope [23](./23-scope.md)；计划 `/plan` [33](./33-plan-mode.md)；用户问答对照 [34](./34-user-questions.md)。

## 一句话

**`dsh-commands` = 斜杠命令注册表（`ctx.commands`）：人在 UI 敲 `/name …`，直接对指定 agent 跑 handler，不把命令行当模型消息；结果给 UI，生命周期记 `command/run` / `command/done`。**（源码）

能力表标 **core**（注册表），不是可换多 Provider 的 seam。

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | 插件注册 `/command`；交互 UI（Web / CLI）发现并分派 |
| **是** | 对人控制面：切模式、压缩、权限、导出等 |
| **不是** | 模型工具（`tools.register`） |
| **不是** | `user-questions`（工具内问人 → [34](./34-user-questions.md)） |
| **不是** | 普通提示词：未知 `/xxx` 被适配器**拒绝**，不当 prompt |

无 UI 的 demo / ACP 自动化通常不挂命令面。

---

## 2. 使用

### 注册

```ts
ctx.commands.register({
  name: 'plan',
  description: 'Enter plan mode',
  definitionId: brandString('…'), // 可选；第一方身份
  input: { hint: '[off|message]', attachments: true },
  recordInput: true, // false = 避免与领域事件重复记 args
  handler: ({ agent, rawInput, attachments, signal }) => {
    return { kind: 'success', text: '…' } // 或 error
  },
})
```

同 scope 重名 → 注册失败。挂在 `agent.ctx` 下可注册仅该 agent 的同名命令，遮蔽全局。

### 语法与分派

第 0 字节 `/` + 小写名（`[a-z][a-z0-9_-]*`）+ 可选后缀；后缀整段是 `rawInput`。

```text
UI → commands.execute(agent, line, attachments, signal)
  → 语法/未知名 → undefined（不记日志）
  → command/run → 附件准入 → handler → command/done
list(agent) / find(agent, name) 做发现
```

### 第一方 builtin

[`builtin.ts`](../packages/interaction/commands/src/builtin.ts)：`goal` / `plan` / `feedback` / `compact` / `permission` / `export`；中英别名（如 `/计划`）；**精确注册名优先于别名**。

| 能力 | 典型包 |
|---|---|
| plan | `plan-mode` |
| compact | `command-compact` |
| permission | `permission-presets` |
| goal | `command-goal` |
| feedback / export | 对应 command 包 |

base：[`cordis.patch.yml` L321](../packages/bundle/base/cordis.patch.yml#L321)。

---

## 3. 实现

```text
register → ScopedLayers（全局 + 按 agent 遮蔽）
execute:
  parseCommand(line)
  → mint commandId
  → append command/run（log-only；可选 args）
  → 附件准入（未声明 / 无 store / 超限 → error，不跑 handler）
  → withAbort(handler)
  → append command/done（success|error + text）
```

要点：

1. **不进模型 transcript**：命令行与 `CommandResult.text` 默认不是 user/assistant 消息；UI 在模型历史外渲染。
2. **无 turn 包裹**：`command/run`·`done` 直接 append（[`execute` L335–L343](../packages/interaction/commands/src/index.ts#L335)）。
3. **生产方可显式接模型**：如 `/plan 消息` → `planMode.set` + `agent.steer`——handler 自安排，注册表不代发斜杠行。
4. **取消**：停等 handler；无视 `signal` 的 handler 仍可能有外部副作用。
5. **`commands/change`**：注册变更通知适配器刷新发现。

Remote：`list` / `execute`；文件凭证 `registerFileReceiptResolver`。

入口：[`CommandRuntime`](../packages/interaction/commands/src/index.ts#L263)。

---

## 与相邻模块

| 模块 | 关系 |
|---|---|
| [33](./33-plan-mode.md) | 有 `ctx.commands` 才注册 `/plan` |
| [34](./34-user-questions.md) | 另一条人机通道（工具内问人） |
| [23](./23-scope.md) | 全局 vs agent 层遮蔽 |
| attachment | 命令附件准入与凭证 |

---

## 还没搞懂

1. Client composer 草稿在命令 error 时如何保留附件卡（UI 深读）。
2. SDK strict 命令端点与 Web 适配器分派差异。
3. 本机 `/plan` / `/压缩` 各走一遍看 `command/run`·`done` 与有无 steer 消息。

## 读代码最短路径

1. [README · 使用](../packages/interaction/commands/README.zh.md#use-this-package)
2. [`CommandRuntime.execute`](../packages/interaction/commands/src/index.ts#L360) / `register`
3. [`builtin.ts`](../packages/interaction/commands/src/builtin.ts)
4. 生产方例：[`plan-mode` `/plan`](../packages/plan/plan-mode/src/index.ts#L233)
