# 工具模块：注册表、执行器与流水线

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机 bash 会话对照） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@1b58995f95` |
| 证据 | 源码；权威见 [`packages/core/tools/README.zh.md`](../packages/core/tools/README.zh.md)、[`docs/tool-execution-pipeline.zh.md`](../docs/tool-execution-pipeline.zh.md)、[`docs/subsystems/tools.zh.md`](../docs/subsystems/tools.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**`ctx.tools` 是作用域化注册表；native/PTC 执行器拥有批次；共享流水线做门禁与结算；agent-loop 只从助手消息抽出 `tool-call` 再 `execute`。**（源码）

关联：[17b bash/shell 全链路与平台命名](./17b-bash-tool-flow.md)；[23](./23-scope.md)（按 scope 选执行器）；[24](./24-ptc.md)（Native/PTC 执行器与提示词）；[12](./12-session-implementation.md)（`tool/call` log-only / `tool/result` surface）；[14](./14-prompt-assembly.md)（schema 进 assemble）；[02](./02-request-lifecycle.md)。

---

## 1. 包地图

| 层 | 包 | 角色 |
|---|---|---|
| 注册表 | [`dsh-tools`](../packages/core/tools/README.zh.md) | `register` / `restrict` / `resolve` / `schemas` / `execute` / `guard` |
| 执行器 | [`dsh-tool-executor-native`](../packages/core/tool-executor-native/README.zh.md) / [`dsh-tool-executor-ptc`](../packages/core/tool-executor-ptc/README.zh.md) | `describe` + `execute(batch)` |
| 共享流水线 | `tools/src/pipeline.ts` + `batch.ts` | pre → guard → around → body → post → finalize → `tools/result`；并发；写 Session |
| 具体能力 | 如 [`dsh-tool-bash`](../packages/shell/tool-bash/README.zh.md) / [`dsh-tool-pwsh`](../packages/shell/tool-pwsh/README.zh.md)、MCP… | `defineTool` → `ctx.tools.register`（**Consumer**） |
| 循环 | [`dsh-agent-loop`](../packages/core/agent-loop/README.zh.md) | `resolve` toolSet → assemble → LLM → `tools.execute` |

`base`（[`cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)）：`dsh-tools` + native 执行器；**POSIX 挂 `tool-bash` + `bash-sandbox`，Windows 挂 `tool-pwsh` + `pwsh-sandbox`**——模型看到的工具名随平台而变（详见 [17b §0、§8](./17b-bash-tool-flow.md)）。

### 1.1 工具模块如何串联 seam

```text
下游 seam（shell / lsp / fs…）← Provider 注册成 ctx.xxx
tool-* Consumer：defineTool + ctx.tools.register
loop：只调 ctx.tools.execute → Definition.execute → 再调下游 seam
```

`tool-*` **不是** seam 实现；`ctx.tools` 是注册表 seam；`ToolExecutor`（native/PTC）用 `setExecutor` 挂上，无独立 `ctx` 键。shell 细节见 [17b](./17b-bash-tool-flow.md)。

---

## 2. 注册与可见性

```text
defineTool({ name, description, parameters, output, execute, … })
  → ctx.tools.register(def, { when? })     # effect；返回 disposer
  → schemas() 白名单投影 name/description/parameters
  → systemPrompt.tools(...) 在 assemble 时读 definitions + executor.describe
```

要点（源码）：

- **不泄漏到模型**：`execute` / `output` / `timeoutMs` / `present*` / `finalizeContent`
- **作用域**：全局 + `agent.ctx` 影子；`restrict({ allow|deny })` 只掩全局名
- **条件工具**：`register(..., { when })`；每步 `resolve({ agent, modelSelection, signal })` 算一次 → `ResolvedToolSet`，步结束 `dispose`
- **执行器**：`setExecutor`；最近 scope 优先；`ctx.tools.execute` 转给所选执行器（[`index.ts` L375–L377](../packages/core/tools/src/index.ts#L375)）

源码地图：[`index.ts`](../packages/core/tools/src/index.ts)、[`schema.ts`](../packages/core/tools/src/schema.ts)、[`contracts.ts`](../packages/core/tools/src/contracts.ts)。

---

## 3. 一次 step 的调用链

```text
preStep
  tools.resolve → toolSet
  systemPrompt.assemble({ toolSet })

LLM → assistant/message (surface append)
  content.filter(type === 'tool-call')

tools.execute({ calls, agent, log:{turn,step}, toolSet, maxParallelToolCalls, signal })
  → NativeToolExecutor.execute → executeToolBatch → pipeline
       append tool/call          # log-only
       pre-execute → guards → (ask→approval)
       tools/execute 包住 tool.execute()
       projectContent → post-execute → finalizeContent → tools/result 事件
       append tool/result        # surface；sourceEventSeqs 引 tool/call
  → additionalContexts → inbox next-step
  → concluded ? 结束 turn : 再开下一步
```

关键点：

| 步骤 | 文件 | 行号附近 |
|---|---|---|
| resolve + assemble | [`agent-loop/.../agent.ts`](../packages/core/agent-loop/src/agent.ts) | L292–L312 |
| 抽 call → execute | 同上 | L586–L597 |
| 注册表转执行器 | [`tools/.../index.ts`](../packages/core/tools/src/index.ts) | L375–L377 |
| native 批次 | [`tool-executor-native/.../index.ts`](../packages/core/tool-executor-native/src/index.ts) | L15–L20 |
| 调度 / Session 日志 | [`batch.ts`](../packages/core/tools/src/batch.ts) | `executeToolBatch`；`start`/`commit` L243–L265 |
| 流水线 | [`pipeline.ts`](../packages/core/tools/src/pipeline.ts) | `prepare` / `dispatch` / `complete` |

`tool/call` **不进** surface；模型「要调工具」在 `assistant/message` 的 content block。`tool/result` **进** surface。工具失败通常 `isError` 结果，不默认掀翻整轮。

---

## 4. 流水线策略点

| 事件 / API | 作用 |
|---|---|
| `tools/pre-execute` | allow / deny / ask |
| `ctx.tools.guard()` | pre 后单调拒绝 |
| `tools/execute` | 环绕（超时、重试、指标） |
| `tools/post-execute` | 检查 / 替换 / 附加 context |
| `tools/result` | 只观测冻结终态 |

图：[tool-execution-pipeline.zh.md](../docs/tool-execution-pipeline.zh.md)。

并发：`isConcurrencySafe === true` 才可并行；否则 exclusive 屏障（[`pipeline.ts` `executionMode`](../packages/core/tools/src/pipeline.ts)）。

---

## 5. 与 Session / 压缩

- 下一请求：`deriveMessages()` = … + assistant（含 tool-call blocks）+ tool/result*
- 超大 tool/result → 可选 pruner（[16](./16-compaction.md)）；选段不能拆未配对工具对

---

## 还没搞懂

1. PTC 子调用与根 call 的 `tool/ptc-dispatch` 事件边界（概览已迁 [24](./24-ptc.md)；jsonl 配对仍待实测）。
2. 本机一次真实 bash 的 jsonl 事件序（待实测，对照 [17b](./17b-bash-tool-flow.md)）。

## 读代码最短路径

1. [tools README.zh](../packages/core/tools/README.zh.md) + [流水线图](../docs/tool-execution-pipeline.zh.md)
2. `agent.ts` preStep / step 末尾 execute → `batch.ts` → `pipeline.ts`
3. [17b](./17b-bash-tool-flow.md) 跟一条 bash；交付模式看 [24](./24-ptc.md)
