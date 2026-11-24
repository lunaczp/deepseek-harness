# bash 举例：注册 → 模型可见 → 真实调用

| | |
|---|---|
| 状态 | 学习中（源码走读；数字 / seq 为示意） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@16ff94b0eb` |
| 证据 | 源码；权威见 [`tool-bash`](../packages/shell/tool-bash/README.zh.md)、[`dsh-tools`](../packages/core/tools/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> 本篇事件序为**示意**；真值待会话 jsonl 核对。
> **跳转**：下方「锚点速查」与文中 `[…#Ln](../packages/…#Ln)` 在 **Cursor 聊天 / GitHub** 可点开定位；侧边栏文档预览点不开（见 [05](./05-workspace-conventions.md)）。

## 一句话

**启动时 `tool-bash` 把 `defineTool({ name: 'bash' })` 注册进 `ctx.tools`；每步 resolve 后 schema 进请求；模型回 `tool-call` → loop `tools.execute` → 流水线 → `bash.execute` → `ctx.shell.execute` → `tool/result` 进 surface。**（源码）

关联：[17](./17-tools.md)；[12](./12-session-implementation.md)；[03](./03-sandbox-and-permissions.md)（沙箱审批）。

---

## 锚点速查（可点）

| 阶段 | 链接 |
|---|---|
| inject | [`tool-bash` L33–L34](../packages/shell/tool-bash/src/index.ts#L33) |
| native `apply` / `setExecutor` | [`tool-executor-native` L33–L35](../packages/core/tool-executor-native/src/index.ts#L33) |
| `apply` 入口 | [`tool-bash` L202](../packages/shell/tool-bash/src/index.ts#L202) |
| `defineTool({ name: 'bash' })` | [`tool-bash` L368](../packages/shell/tool-bash/src/index.ts#L368) |
| `bash.execute` 前台 | [`tool-bash` L478–L530](../packages/shell/tool-bash/src/index.ts#L478) |
| 后台 / promote 分支 | [`tool-bash` L498–L525](../packages/shell/tool-bash/src/index.ts#L498) |
| `register` | [`tool-bash` L542–L555](../packages/shell/tool-bash/src/index.ts#L542) |
| `ToolsService.register` | [`tools` L128–L152](../packages/core/tools/src/index.ts#L128) |
| `systemPrompt.tools` 接线 | [`tools` L111–L117](../packages/core/tools/src/index.ts#L111) |
| `tools.execute` 转执行器 | [`tools` L375–L377](../packages/core/tools/src/index.ts#L375) |
| native `describe` / `execute` | [`native` L15–L20](../packages/core/tool-executor-native/src/index.ts#L15) |
| preStep `resolve`+`assemble` | [`agent` L292–L294](../packages/core/agent-loop/src/agent.ts#L292) |
| 抽 call → `tools.execute` | [`agent` L586–L597](../packages/core/agent-loop/src/agent.ts#L586) |
| 写 `tool/call` | [`batch` L243–L249](../packages/core/tools/src/batch.ts#L243) |
| 写 `tool/result` | [`batch` L252–L265](../packages/core/tools/src/batch.ts#L252) |
| base 组合 | [`base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml) |

---

## ① 组合：谁挂了 bash

[`base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml) 大致：`dsh-tools` + `dsh-tool-executor-native` + `dsh-tool-bash`。

[`tool-bash` L33–L34](../packages/shell/tool-bash/src/index.ts#L33)：`inject = ['tools', 'shell', 'systemPrompt', 'shellEnv', 'workingDirectory']`。

[`tool-executor-native` L33–L35](../packages/core/tool-executor-native/src/index.ts#L33)：`ctx.tools.setExecutor(new NativeToolExecutor(ctx))`。

---

## ② 注册：`apply` → `defineTool` → `register`

- 入口：[apply L202](../packages/shell/tool-bash/src/index.ts#L202)
- 定义：[defineTool L368–L534](../packages/shell/tool-bash/src/index.ts#L368)（`name: 'bash'`、parameters、`output`、`execute`、`present*`）
- 挂表：[register L542–L555](../packages/shell/tool-bash/src/index.ts#L542)（有 `jobs` 换后台变体；无则前台-only）
- 注册表实现：[ToolsService.register L128–L152](../packages/core/tools/src/index.ts#L128)

---

## ③ 本步准入：resolve + schema 进模型

- [agent L292–L294](../packages/core/agent-loop/src/agent.ts#L292)：`tools.resolve` → `systemPrompt.assemble({ toolSet })`
- schema 接线：[tools L111–L117](../packages/core/tools/src/index.ts#L111)
- 投影：[native describe L15–L16](../packages/core/tool-executor-native/src/index.ts#L15)

`execute` / `output.render` **不会**进模型请求。

---

## ④ 模型回调用 → loop 批次

- [agent L586–L597](../packages/core/agent-loop/src/agent.ts#L586)：filter `tool-call` → `tools.execute({ calls, log, toolSet, … })`
- 转执行器：[tools L375–L377](../packages/core/tools/src/index.ts#L375) → [native L19–L20](../packages/core/tool-executor-native/src/index.ts#L19) → `executeToolBatch`

---

## ⑤ 批次内：日志 + bash 身体

1. **写 `tool/call`（log-only）**：[batch L243–L249](../packages/core/tools/src/batch.ts#L243)
2. **流水线**：见 [17 §4](./17-tools.md) / [流水线图](../docs/tool-execution-pipeline.zh.md)
3. **bash `execute` 前台**：[L478–L530](../packages/shell/tool-bash/src/index.ts#L478) → `ctx.shell.resolve` / `ctx.shell.execute`；后台 / promote：[L498–L525](../packages/shell/tool-bash/src/index.ts#L498)
4. **写 `tool/result`（surface）**：[batch L252–L265](../packages/core/tools/src/batch.ts#L252)（`sourceEventSeqs` 引 `tool/call`）

**Consumer `bash` → Provider `ctx.shell`**，不是 bash 自己 spawn。

---

## ⑥ 事件序示意（一次前台 `ls`）

```text
… step/start …
system/message / user/message / request/header …
assistant/message          # surface；content 含 tool-call bash
tool/call                  # log-only；name=bash, arguments=…
  … pre-execute / guards / shell.execute …
tool/result                # surface；text = 命令输出渲染
… step/end …
```

下一请求 `deriveMessages()` 可见 assistant（带 tool-call）+ tool/result；**看不到**孤立 `tool/call` 事件。

---

## ⑦ 对照表

| 阶段 | 代码锚点 | 是否调 LLM | Session |
|---|---|---|---|
| 注册 | [L368](../packages/shell/tool-bash/src/index.ts#L368) + [L542](../packages/shell/tool-bash/src/index.ts#L542) | 否 | 无 |
| 本步 schema | [agent L292](../packages/core/agent-loop/src/agent.ts#L292) | 否 | header / system 另记 |
| 模型决定调 bash | adapter stream | **是** | `assistant/message` |
| 执行 bash | [agent L586](../packages/core/agent-loop/src/agent.ts#L586) → [batch](../packages/core/tools/src/batch.ts#L243) → [L478](../packages/shell/tool-bash/src/index.ts#L478) | 否 | `tool/call` → `tool/result` |
| 带结果再问 | 下一步 LLM | **是** | 新 `assistant/message` |

---

## 还没搞懂

1. 本机 jsonl 里一次真实 bash 的 seq / `sourceEventSeqs`（待实测）。
2. `promoteOnTimeout` 与 `job_*` 工具在模型可见文案上的衔接。

## 读代码最短路径

1. [tool-bash L202](../packages/shell/tool-bash/src/index.ts#L202) → [L368](../packages/shell/tool-bash/src/index.ts#L368) → [L478](../packages/shell/tool-bash/src/index.ts#L478) → [L542](../packages/shell/tool-bash/src/index.ts#L542)
2. [agent L292](../packages/core/agent-loop/src/agent.ts#L292)、[L586](../packages/core/agent-loop/src/agent.ts#L586)
3. [batch L243](../packages/core/tools/src/batch.ts#L243)、[L252](../packages/core/tools/src/batch.ts#L252)
4. [shell README](../packages/shell/shell/README.zh.md)
