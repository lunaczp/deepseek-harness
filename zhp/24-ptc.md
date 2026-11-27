# PTC：运行时、ToolExecutor 与提示词差异

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未跑 PTC 实测） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@89f14d6390` |
| 证据 | 源码；权威见 [`ptc-runtime/` 组](../packages/ptc-runtime/README.zh.md)、[`dsh-ptc-runtime`](../packages/ptc-runtime/ptc-runtime/README.zh.md)、[`ptc-runtime-node`](../packages/ptc-runtime/ptc-runtime-node/README.zh.md)、[`tool-executor-ptc`](../packages/core/tool-executor-ptc/README.zh.md)、[`tool-executor-native`](../packages/core/tool-executor-native/README.zh.md)、[`docs/subsystems/ptc-runtime.zh.md`](../docs/subsystems/ptc-runtime.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。工具注册表 → [17](./17-tools.md)；流水线深读 → [17e](./17e-tool-pipeline.md)；scope 选执行器 → [23](./23-scope.md)；提示词组装总览 → [14](./14-prompt-assembly.md)；默认工具里的 web → [25](./25-web.md)。「runtime」一词多层含义 → [52](./52-runtime.md)（本篇 `ptcRuntime` 属具名 seam）。

## 一句话

**`ctx.ptcRuntime` 只跑「带绑定的程序」；`tool-executor-ptc` 把模型侧改成只直呼 `run_code`，端能力进 SDK，子调用仍走同一条 tools 流水线。Native 执行器则把每个可见工具直接交给模型。**（源码）

---

## 1. PTC 运行时实现（seam）

### 1.1 角色三角

| 角色 | 包 | 职责 |
|---|---|---|
| Definition | [`dsh-ptc-runtime`](../packages/ptc-runtime/ptc-runtime/) | 抽象 `PtcRuntime` → `ctx.ptcRuntime`：`resolve` / `run` 词汇 |
| Provider | [`dsh-ptc-runtime-node`](../packages/ptc-runtime/ptc-runtime-node/)（base 默认）；实验 [`ptc-runtime-python`](../packages/experimental/ptc-runtime-python/) | 真正起进程、求值、沙箱/状态 |
| Consumer | [`dsh-tool-executor-ptc`](../packages/core/tool-executor-ptc/)、[`dsh-workflow-ptc`](../packages/workflow/) 等 | 工具绑定 / workflow（[28](./28-workflow.md)）；**运行时不认识 Session 工具名** |

权威分层：[ptc-runtime 组 README](../packages/ptc-runtime/README.zh.md)。

### 1.2 调用约定

```text
request → ptcRuntime.resolve(request) → Spec（cwd / timeout / sandbox…）
       → ptcRuntime.run(spec) → { value?, logs, error? }
```

- 程序格式：`programFormat` = 异步函数体 / REPL / Script（Node）。
- 绑定：宿主传入具名异步函数（PTC mode 下即各工具 SDK）；失败进 **结果**，调用方误用才 Promise reject。
- `language` / `isolation` / `retainsState`：描述符，**不是**权限证明。
- 运行时**不知道** `bash`/`read`：只看见绑定名与 JSON 参数。

Node 实现要点（二手+源码 README）：新进程或按所有者保留的 REPL/Script；Host↔worker 经 birpc；超时/取消走 revoke + 清理。细节见 [ptc-runtime-node README.zh](../packages/ptc-runtime/ptc-runtime-node/README.zh.md)。

base 挂载：[`cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml) 的 `ptc-runtime` 行；**执行器**默认仍是 native，`tool-executor-ptc` 行 `disabled: true`。

---

## 2. ToolExecutor：Native vs PTC

`ctx.tools` 是注册表；**批次怎么呈现/结算**由 `setExecutor` 挂上的 `ToolExecutor` 拥有（[`executor.ts`](../packages/core/tools/src/executor.ts#L64)）：

| 方法 | 作用 |
|---|---|
| `describe(tools)` | 模型 `tools[]` schema |
| `execute(batch)` | 完整批次（解析、调度、取消、写 call/result） |
| `sections?` | 执行器自带 system 段 |

组装时：`ctx.tools` → `executor.describe(definitions)`（[`tools` L113–L116](../packages/core/tools/src/index.ts#L113)）。

```text
ctx.tools（register 的 Definition：bash/read/…）
    │
    ├─ NativeToolExecutor  → describe = 每个工具一张 schema
    │                      → execute → 共享 pipeline → Definition.execute
    │
    └─ PtcExecutor         → describe = 仅 run_code
                           → execute → pipeline（根只能 run_code）
                           → run_code → ctx.ptcRuntime.run(program, bindings)
                           → 嵌套 tools.xxx → 同一 pipeline → Definition.execute
```

| | Native | PTC |
|---|---|---|
| 挂载 | `tool-executor-native`（base 默认） | `tool-executor-ptc`（需启用 + `ptcRuntime`） |
| `describe` | 全部可见端能力 | **只有** `run_code`（[`PtcExecutor` L47–L48](../packages/core/tool-executor-ptc/src/index.ts#L47)） |
| 直呼 `read` | ✅ | ❌ → `UNKNOWN_TOOL`（非嵌套拒绝） |
| SDK / ptc-only 段 | 无 | `tools:ptc-only`（order 800）+ `tools:sdk`（5000） |
| 共享流水线 | `ToolExecutionPipeline` | 同；`get` 对 `run_code` 走自建 transport |

每 scope 一个执行器；同 agent **不能**同时 native schema + `run_code`（[23](./23-scope.md)）。不同 agent 可以各选一种。

---

## 3. 给模型的提示词差异（例子）

假设可见能力含 `bash` / `read` / `write`（其余同理）。persona 等其它段两边一样；差在 **tools[] + 执行器 sections**。

### 3.1 Native

```text
tools: [
  { name: "bash",  description: "Execute a bash command…", parameters: { … } },
  { name: "read",  description: "…", parameters: { … } },
  { name: "write", description: "…", parameters: { … } },
  …
]
```

无 `tools:ptc-only` / `tools:sdk`。模型：`tool-call` → `read({…})`。

### 3.2 PTC

```text
tools: [
  { name: "run_code",
    description: "Execute a … program against the available tools…",
    parameters: { code, description, timeoutMs?, sandbox_permissions?, justification? } }
]
```

System 额外段（示意，权威全文见 [tool-executor-ptc README](../packages/core/tool-executor-ptc/README.md#ptc-mode-schema-and-system-prompt)）：

```markdown
<!-- tools:ptc-only -->
`run_code` is the only tool you can call directly — a tool call naming any other tool fails.
Reach every tool the SDK declares below from inside the program.

<!-- tools:sdk（按 runtime.language 生成） -->
## Writing code for run_code
`run_code` takes two required arguments: `code`, … and `description`, …
…
Program-only SDK bindings:
# （生成的 tools.bash / tools.read / … 声明）
```

模型：只能 `run_code({ code: "return await tools.read({…})", description: "…" })`。

`run_code` schema 目录摘录：[docs/tool-catalog.md · run_code](../docs/tool-catalog.md#deepseek-aidsh-tool-executor-ptc)。

| 面 | Native | PTC |
|---|---|---|
| `tools[]` | N 个端能力 | 仅 `run_code` |
| 系统提示工具说明 | 主要靠各 schema description | + 只能调 run_code + 整段 SDK |
| token 形态 | 多 schema | 1 schema + 长 SDK 文本 |

---

## 4. 默认 Native 下模型可见工具（base）

以 **`dsh-base` + native 执行器**为准（`headless`/`sdk`/`acp` 继承；`web` 多数工具改由 preset 重挂）。

**平台 shell（二选一）**：`bash` 或 `pwsh`。

**常驻（macOS/Linux 示意）**：`job_list` / `job_output` / `job_kill`；`read` / `write` / `edit` / `read_image`；`glob` / `grep`；`working_directory`；`skill`；`todo_write`；`get_goal` / `create_goal` / `update_goal`；`web_search` / `web_fetch`；`subagent` / `subagent_fork`；`send_message` / `list_agents` / `interrupt_agent` / `wait_agent`；`workflow`；`exit_plan_mode`。

**条件**：`team_task_*`（Team 开）；MCP 三工具（有 server）；`list_subagent_models`（base 默认不开 discovery）。

**默认没有**：`run_code`；`apply_patch`（base `applyPatch: false`）；`ask_user_question` / `present` / `lsp` / `schedule_*`（多在 web preset / sdk-app）。

组合源：[`packages/bundle/base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)；全量 schema 目录（按包，非单 profile）：[`docs/tool-catalog.md`](../docs/tool-catalog.md)。

---

## 还没搞懂

1. `tool/ptc-dispatch-start` ↔ `tool/ptc-dispatch` 与根 `tool/call`/`tool/result` 在 jsonl 里的精确配对（待实测）。
2. Node REPL 保留状态 vs 每次新进程，对模型下一轮提示的可见差异。
3. web `ptc` preset 相对 base 的完整工具差集。

## 读代码最短路径

1. [ptc-runtime 组](../packages/ptc-runtime/README.zh.md) → [dsh-ptc-runtime](../packages/ptc-runtime/ptc-runtime/README.zh.md) → Node Provider
2. [`PtcExecutor`](../packages/core/tool-executor-ptc/src/index.ts) ↔ [`NativeToolExecutor`](../packages/core/tool-executor-native/src/index.ts)
3. [`createRunCodeTool` / ptc.ts](../packages/core/tool-executor-ptc/src/ptc.ts) → `ctx.ptcRuntime.run`
4. 提示词段：同包 README「PTC mode schema and system prompt」；组装总览 [14](./14-prompt-assembly.md)
