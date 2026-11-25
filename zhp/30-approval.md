# 用户审批：`ctx.approval`、Host 闸门与 `tools/pre-execute`

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未新录审批 / Codex hook 轨迹） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@e9f43b71bf` |
| 证据 | 源码；权威见 [`docs/subsystems/approval.zh.md`](../docs/subsystems/approval.zh.md)、[`user-approval`](../packages/interaction/user-approval/README.zh.md)、[approval seam Note](../.agents/notes/implemented/feature/2026-07-06-approval-seam.md)、[`docs/tool-execution-pipeline.zh.md`](../docs/tool-execution-pipeline.zh.md)、[`hooks-codex`](../packages/experimental/hooks-codex/README.zh.md)、[`event-producer-consumer`](../docs/event-producer-consumer.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。流水线 [17e](./17e-tool-pipeline.md)；沙箱实测 [03](./03-sandbox-and-permissions.md)；沙箱 seam [32](./32-sandbox.md)；Typert 转发 [26](./26-typert.md)；权限预设捆绑 [31](./31-permission-presets.md)。

## 一句话

**审批是 Host 硬闸门：`ctx.approval` 对敏感动作做一次性 allow/reject；策略与 `tools/pre-execute` / 沙箱扩权决定何时提问；模型只看到策略文案和工具结果，不能代替人点允许，也不能绕过 `never`。**（源码）

---

## 1. 是什么 / 不是什么

| | |
|---|---|
| **是** | 这一次能不能执行：`allowed-once` / `rejected` / `cancelled` / `unavailable` |
| **不是** | `ask_user` / `userQuestions`（模型问人、开放表单） |
| **不是** | feedback；也不是 plugin-manager 的 build-script 同意 |

刻意**不做** Definition/Provider/Consumer 三包拆分：机制在 [`user-approval`](../packages/interaction/user-approval/)；可变的是各通道的 `approval/request` **应答者**。

相关：`ctx.permissionPresets` 捆 sandbox mode + approval policy；Web UI [`ui-approval`](../packages/client/ui-approval/)。

---

## 2. 常见误解：不是「模型读设置后决定问不问」

| 误解 | 实际 |
|---|---|
| 用户设置给模型，模型选「问人 or 直接执行」 | 设置约束 **Host**；问不问由「有没有人调 `request` + 策略」决定 |
| 模型选「直接执行」 | 未触发 ask/扩权时本就不问；触发后必须过 Host |
| 点允许 = 永久授权 | 只有 `allowed-once`；无持久 grant store |

策略 `ask` | `never`：`never` 在服务内直接 `rejected`，waterfall 监听器绕不过（[`decide` #L293](../packages/interaction/user-approval/src/index.ts#L293)）。
抄送给模型：runtime-context `approval:policy` + 策略变更 user 消息——**告知规则，不是授权模型做闸门**。

---

## 3. Host 咽喉：`ApprovalService.request`

[`#L242`](../packages/interaction/user-approval/src/index.ts#L242)：

1. 必须在 **open turn** 内
2. `approval/asked`（模型不可见）→ `decide` → `approval/decided`
3. `never` → 直接 rejected；否则 `waterfall('approval/request')`；无人/抛错 → `unavailable`（fail-closed）
4. 唯一放行：`allowed-once`

请求**不带工具参数**；UI 用 `callId` 挂已流式的 tool-call。

**Web：** Typert 转发 `approval/request`（[`remote-events.ts#L29`](../packages/api/remotes/src/remote-events.ts#L29)）→ Client `ui-approval` → 回填同一 Host waterfall。

---

## 4. 两条 Host 入口（谁发起 `request`）

### A. `tools/pre-execute` → `ask`

[`pipeline.ts#L199`](../packages/core/tools/src/pipeline.ts#L199)：waterfall 最终 `{ kind: 'ask' }` → `serviceAsk` → `approval.request`。
`user-approval` **不**监听 `pre-execute`；只有策略插件返回 `ask` 才会进审批。

### B. 沙箱扩权（bash / fs）

模型参数可写更宽 `sandbox_permissions` + `justification`；**execute 前** `approveEscalation`（[`escalation.ts#L172`](../packages/sandbox/sandbox/src/escalation.ts#L172)）→ 同一 `approval.request`。
同 mode 不问；非严格更宽 / 无通道 → throw。
**网络不在** sandbox/approval 词表；`web_fetch` 默认可不经 per-call 审批。

普通 workspace 内工具：**可不进**审批。

---

## 5. `tools/pre-execute`：谁在处理、`ask` 语义

发起：pipeline；默认链尾 `{ kind: 'allow' }`。
监听器：`ctx.on('tools/pre-execute', (exec, next) => …)`。

Waterfall（[primer](../docs/cordis-primer.zh.md#cordis-waterfall-semantics)）：**一条链、一个最终决策**；不调 `next()` 直接 return 则短路。不是「多个监听器 OR 投票」。

最终：

| 结果 | 后续 |
|---|---|
| `ask` | 一次 `approval.request` |
| `allow` | 继续执行 |
| `deny` / `cancel` | 拒绝，不进 body |

文档登记的消费方（[event-producer-consumer](../docs/event-producer-consumer.zh.md)）：`auto-review`、`hooks-claude-code`、`hooks-codex`、`tool-jobs`、`workspace-changes`、`liveshare` 等——**不是默认全开**。

---

## 6. Claude / Codex hooks：干啥、同时生效吗

| 包 | 用途 |
|---|---|
| `hooks-claude-code` | 复用 Claude Code `hooks.json`，映射到 harness 扩展点 |
| `hooks-codex` | 复用 Codex `hooks.json` |
| `auto-review` | 可选 Auto：模型先审再 allow/deny/ask |

三者在 `packages/experimental/`；**base / web-app 默认不挂**。
同时挂上会进**同一条** waterfall，按注册顺序抢短路——一般只选一套。

Codex **PreToolUse** 桥只映射 **deny 或 `next()`**，**不把 hook 的 ask 变成** pipeline `ask`（[`hooks-codex` #L226](../packages/experimental/hooks-codex/src/index.ts#L226)）。

---

## 7. Codex hook 完整场景与链路（示例）

**场景：** 显式挂 `hooks-codex`，用旧配置拦危险 `rm -rf /`。

配置示意 `./.codex/hooks.json`：`PreToolUse` + matcher `[Bb]ash` + command 脚本；危险则 **exit 2**，原因写 stderr。

挂载：

```yaml
- name: '@deepseek-ai/dsh-hooks-codex'
  config:
    configPath: ./.codex/hooks.json
    model: deepseek-v4-flash
```

链路：

```text
模型 bash tool-call
  → pipeline waterfall tools/pre-execute
  → hooks-codex runPoint(PreToolUse)
  → 起脚本，stdin Codex JSON（tool_input.command 等）
  → exit 2 → deny + reason
  → 短路，不 next；不进 approval；不执行 bash
  → tool/result isError（含 reason）→ 模型可见
  Session 有 hook/invoked + hook/result（dialect: codex）
```

无害命令 exit 0 → `next()` → 默认 allow → 正常 execute。

---

## 8. 组合与无人值守

- base：`user-approval` + `permission-presets`（[31](./31-permission-presets.md)）；`danger-full-access` 时常默认 approval `never`
- web：`ui-approval`
- headless：常 `never` 或无 live 应答 → `unavailable` → 工具 deny
- 进程内子 agent：策略常 pin `never`（上抛父会话为延期）

---

## 还没搞懂

1. ~~permission preset 与 sandbox mode 完整字段对照。~~ → [31](./31-permission-presets.md)
2. UI「Always allow」与 core 仅 `allowed-once` 的产品差距。
3. Pending approval 不进 checkpoint / 恢复不重问。
4. 本机一次挂 hooks-codex 的实跑对照。

## 读代码最短路径

1. [approval 子系统](../docs/subsystems/approval.zh.md) + [`user-approval` request/decide](../packages/interaction/user-approval/src/index.ts)
2. [`pipeline` pre-execute + serviceAsk](../packages/core/tools/src/pipeline.ts#L199)
3. 扩权：[`approveEscalation`](../packages/sandbox/sandbox/src/escalation.ts#L172)
4. UI：[`ui-approval`](../packages/client/ui-approval/src/client/index.ts)
5. 可选桥：[`hooks-codex`](../packages/experimental/hooks-codex/src/index.ts)
