# Subagent seam：委派、`ctx.subagents` 与树内控制

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未新录委派轨迹） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@3846b59cb2` |
| 证据 | 源码；权威见 [`packages/subagent/`](../packages/subagent/README.zh.md)、[`docs/subsystems/subagent.zh.md`](../docs/subsystems/subagent.zh.md)、[`docs/capability-seams.zh.md`](../docs/capability-seams.zh.md)、[可继续对话 Note](../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.zh.md)、[父目录 Note](../.agents/notes/implemented/architecture/2026-09-01-parent-owned-subagent-catalog.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Seam [19](./19-seam-and-service.md)；workflow 扇出 [28](./28-workflow.md)；jobs [18](./18-jobs.md)；scope [23](./23-scope.md)。

## 一句话

**Subagent = `ctx.subagents` 委派能力缝：命名 Provider 启本地或进程外子 agent，统一 activation 生命周期与树内通信；模型工具立即返回名字，父靠 settled 通知看结果；workflow 的 `agent()` 是本缝的消费方。**（源码）

---

## 1. 与相邻概念

| | 角色 |
|---|---|
| **agent-loop** | 单个 Agent 的 turn/step；每个进程内子 Agent **自己也有** loop |
| **subagent** | **委派缝**：Provider 注册表 + activation + 树 |
| **workflow** | 模型写 JS；`agent()` → `startActivation`（常 `delivery: 'caller'`）→ [28](./28-workflow.md) |
| **team** | 叠在同一棵树上的共享任务板；身份/消息仍归 subagent control |
| **jobs** | 后台 bash 等作业；不是子 Agent 会话 → [18](./18-jobs.md) |

---

## 2. 能力缝三角

| 角色 | 包 | `ctx` |
|---|---|---|
| Definition | [`dsh-subagent`](../packages/subagent/subagent/) | `ctx.subagents` |
| Provider | spawn / fork / acp / codex / claude-code / dsh-sdk | `registerProvider` |
| Consumer | [`tool-subagent`](../packages/subagent/tool-subagent/)、[`tool-subagent-control`](../packages/subagent/tool-subagent-control/)、workflow、Ralph | 工具或 `startActivation` |

另有 Host 设置面 `ctx.subagentModelSelection`（委派工具读），不是主缝。

| Provider | 模式 |
|---|---|
| **spawn**（默认） | 进程内全新子 agent，不带父历史 |
| **fork** | 进程内，种子父已完成 turn 前缀 |
| **acp / codex / claude-code / dsh-sdk** | 进程外；一般 one-shot、不可 follow-up |

产品 base 默认挂 spawn + fork；外部后端多为可选叠加。

---

## 3. 核心 API：`startActivation`

入口 [`subagent/src/index.ts#L267`](../packages/subagent/subagent/src/index.ts#L267)：有 `prepareContinuable` → `manager.startLocal`；否则 → `startExternal`。

要点（[`docs/subsystems/subagent.zh.md`](../docs/subsystems/subagent.zh.md)）：

- `provider` / `prompt` / `parent` / `label`；可选 `name`、`cwd`、`maxDepth`、`agentPreset`、`agentOptions`、`outputSchema`…
- **`delivery`**：`'parent'` = 结算通知进父 inbox + catalog；`'caller'` = 只兑现 `activation.result`（workflow 常用）
- depth：父 +1，受 `maxDepth`；cwd：相对路径相对父有效目录，省略则捕获父 cwd
- 子 Session：`parentSession` / `origin: 'subagent'` / `delegationDepth`；**scope 不向下继承**（[23](./23-scope.md)）

其它控制面：`sendMessage` / `interrupt` / `listDescendants` / `waitForTreeWork` / `drainDescendants` / `rootOf` / `resolveName`…

---

## 4. 模型可见工具

**委派**（`tool-subagent`，可多实例挂不同 provider/toolName）：

- `subagent` → 默认 `spawn`
- `subagent_fork` → `fork`

execute：[`#L326`](../packages/subagent/tool-subagent/src/index.ts#L326) `startActivation({…, delivery: 'parent'})`，**立即返回 `{ name }`，不等子跑完**。

**控制**（`tool-subagent-control`）：

| 工具 | 作用 |
|---|---|
| `send_message` | 同树续写 / steer |
| `interrupt_agent` | 祖先权威打断 |
| `list_agents` | 列 continuable 后代 |
| `wait_agent` | 等**调用者 inbox**（含 settled notice），不直接 await activation |

父看见结果：父 Session **`subagent-settled`** 通知 + `subagent/catalog` 投影；委派工具 return 不含最终正文。

进程内观察事件：`subagent/start` / `subagent/end`（及 provider 增删）。

---

## 5. 调用链（模型 spawn）

```text
模型 subagent({ prompt, description, ... })
  → tool-subagent.execute
  → ctx.subagents.startActivation({ provider: 'spawn', delivery: 'parent', ... })
  → manager.startLocal → prepareContinuable → 物化子 Agent → catalog
  → emit subagent/start；工具已返回 name
  → 子跑 agent-loop…
  → notifySettlement → 父 inbox（subagent-settled）
  → subagent/end；activation.result resolve
```

Workflow 旁路：同 `startActivation`，常 `delivery: 'caller'`，脚本 `await` 结果，不往父 inbox 塞 notice（[28](./28-workflow.md)）。

---

## 6. 组合位置

base 示意：`subagent` → spawn + fork → `tool-subagent-control` → `tool-subagent` / `tool-subagent-fork` → workflow 再消费。
web preset 常在 isolate 组再挂；`sdk-minimal` 可排除。

---

## 还没搞懂

1. fork 种子前缀与 compaction 边界。
2. cold resume / 跨进程 continuation 限制。
3. team 与 subagent control 的任务板分工深读。

## 读代码最短路径

1. [subagent 子系统](../docs/subsystems/subagent.zh.md) + [组 README](../packages/subagent/README.zh.md)
2. [`subagent/src/index.ts` `startActivation`](../packages/subagent/subagent/src/index.ts#L267) + `manager.ts`
3. [`tool-subagent`](../packages/subagent/tool-subagent/src/index.ts) + [`tool-subagent-control`](../packages/subagent/tool-subagent-control/)
4. spawn / fork：[`subagent-spawn-in-process`](../packages/subagent/subagent-spawn-in-process/)、[`subagent-fork-in-process`](../packages/subagent/subagent-fork-in-process/)
