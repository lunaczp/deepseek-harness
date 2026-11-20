# 提示词组装：section / context / 准入

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机会话日志对照） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@525a2eb387` |
| 证据 | 源码；权威见 [`packages/core/system-prompt/README.zh.md`](../packages/core/system-prompt/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**请求前的提示词不塞进 `GenerateOptions.system`：先 `assemble` → `renderPrompt` → 按路由能力 `project` 成 `system/message`（与独立的 runtime-context `user/message`）→ `deriveMessages()` 带进 LLM；工具 schema 走 `assembly.tools`。**（源码）

关联：[14b 逐步示例](./14b-prompt-assembly-example.md)（Hello 迷你链路）；[02](./02-request-lifecycle.md)④⑤；[12](./12-session-implementation.md)；[13](./13-llm-implementation.md) / [13b](./13b-dsh-llm.md)（`prepareCall` 与 `systemPromptUpdate`）。

---

## 1. 时间线（夹在模型调用前后）

```text
preStep（step/start 之前）
  tools.resolve
  systemPrompt.assemble(...)     ← 段 + 变量 + 工具 schema + 动态上下文（求值，多数尚未插值）
  agent/pre-step waterfall         ← 默认可把 runtime context 拼进本步 messages

step/start
  prepareRequest → llm.prepareCall  ← 才知道 systemPromptUpdate 等路由能力
  renderPrompt(assembly)            ← {{var}} 插值 → 最终 system 文本
  refreshContext(assembly)          ← 再刷动态上下文（段/工具/变量 waterfall 不重跑）
  systemPrompt.project → append system/message
  runtimeContext → append user/message（快照）
  buildRequest → deriveMessages() → preparedCall.stream
```

关键调用：

```283:314:../packages/core/agent-loop/src/agent.ts
  private async preStep(...) {
    const toolSet = await this.loopCtx.tools.resolve({ agent: this, modelSelection: selection, signal })
    const assembly = await this.loopCtx.systemPrompt.assemble({
      ...assembleContextFor(this, signal), modelSelection: selection, toolSet,
    })
    const decision = await this.dispatch.waterfall(
      'agent/pre-step', ...,
      () => {
        const sections = renderContextSections(assembly)
        const context = this.runtimeContext.project(joinContextSections(sections), sections)
        return Promise.resolve({ kind: 'enter', messages: context === undefined ? claimed : [...claimed, context] })
      },
    )
```

```441:479:../packages/core/agent-loop/src/agent.ts
    const renderedPrompt = renderPrompt(assembly)
    // ...
      const { config, preparedCall } = await this.prepareRequest(...)
      const currentContext = this.loopCtx.systemPrompt.refreshContext(assembly, ...)
      const commits = this.systemPrompt.project(renderedPrompt, {
        inHistory: preparedCall?.systemPromptUpdate === 'in-history',
        startsSeries: ...,
      })
      // append system/message；再 append user/message（runtime context + 用户话）
      const request = this.buildRequest(..., assembly.tools, ...)
```

要点：**`assemble` 在 `prepareCall` 之前**；**写 `system/message` 在 `prepareCall` 之后**（要按 `in-history` 决定改写头节点还是追加）。

---

## 2. 两条轨道（别混）

| 轨道 | 注册 API | 组装结果 | 进模型的形态 |
|---|---|---|---|
| **Sections** | `ctx.systemPrompt.section(...)` | `assembly.sections` → `renderPrompt` | **system** 角色（surface 节点；常为 node 0 或 in-history 追加） |
| **Contexts** | `ctx.systemPrompt.context(...)` | `assembly.contexts` → `joinContextSections` | **user**、`source.kind: 'runtime-context'`；文案声明覆盖更早快照 |
| **Tools** | `ctx.systemPrompt.tools(...)`（多数由 ToolRuntime 自动挂） | `assembly.tools` | `GenerateOptions.tools`（独立 wire 字段） |
| **Variables** | `ctx.systemPrompt.variable('name', …)` | `assembly.variables` | 不单独出现；`renderPrompt` / context 渲染时替换 `{{name}}` |

包说明：[`packages/core/system-prompt/README.zh.md`](../packages/core/system-prompt/README.zh.md)。

本仓库动词 **project**：从权威真源派生另一面视图或「该写哪些 Session 变更」，不改写 append-only 原件（见聊天沉淀；admission 用 [`SystemPromptProjection.project`](../packages/core/agent-loop/src/runtime-context.ts)）。

---

## 3. `assemble()` 在干什么

[`packages/core/system-prompt/src/index.ts`](../packages/core/system-prompt/src/index.ts) 约 L620–L695：

1. 合并 **全局 + agent 作用域**（同名 section/variable：scoped 遮蔽 global）
2. 求值 section / context 文本（多数此时**不做** `{{var}}`）
3. 收集 tool schema，按 `toolOrder` 排序
4. 跑 `system-prompt/assemble` waterfall（可改展示；**不能**改掉 provider 持有的工具声明）
5. 若有唯一 `complete: true` section → 结束后**只保留该段**作整份 system prompt
6. 返回 `PromptAssembly`：`{ sections, contexts, variables, tools }`

插值在之后：

```296:301:../packages/core/system-prompt/src/index.ts
export function renderPrompt(assembly: PromptAssembly): string {
  return assembly.sections
    .map(section => section.interpolate === false ? section.text : interpolate(...))
    .filter(text => text.length > 0)
    .join('\n\n')
}
```

未知 / 无值的 `{{var}}` **直接抛错**，不带着坏提示词打模型。

`refreshContext`（约 L588+）：准入前再读 context provider；**段、工具、变量 waterfall 不重跑**——易变事实放 context，不放 section。

---

## 4. 第一方顺序

[`SECTION_ORDERS`](../packages/core/system-prompt/src/index.ts#L136) 大致：

```text
-1000  harness:identity
    0  deployment:persona-prefix
  500+ 策略 / 工具说明（bash、read、web…）
 5000  tools SDK 等
10000+ harness source / web surface / persona-suffix
```

插件用 `getSectionOrder('TOOL_BASH')` 等。动态上下文另有 [`CONTEXT_ORDERS`](../packages/core/system-prompt/src/index.ts#L177)（工作目录、沙箱等）——**刻意不进可缓存的 system 前缀**。

Loop 注册变量：[`agent-loop/src/index.ts`](../packages/core/agent-loop/src/index.ts) 约 L336–L337 → `{{provider}}` / `{{model}}`。

配置字段：`includeHarnessIdentity`、`includeRuntimeContext`、`personaPrefix` / `personaSuffix`、`toolOrder`（见包 README）。

---

## 5. 写进 Session

**System** — [`SystemPromptProjection.project`](../packages/core/agent-loop/src/runtime-context.ts#L93)：

- 无 system 节点 → append
- 非 `in-history`，或新 series 且文本变了，或空提示词 → 清空后续非空 system，再改写头节点
- `in-history` 且延续 series → 文本变了则 **append** 新 system，保留前缀（利于 KV cache）

**Runtime context** — [`RuntimeContextProjection.project`](../packages/core/agent-loop/src/runtime-context.ts#L157)：

- 拼带前言的快照（`Current runtime context. This snapshot supersedes...`，[`joinContextSections` L320+](../packages/core/system-prompt/src/index.ts#L320)）
- 与上次保留文本不同才生成新 user 消息

Loop 请求**无**单独 `system` 字段：[`buildRequest`](../packages/core/agent-loop/src/agent.ts) 约 L735+ 用 `session.deriveMessages()`。

---

## 6. 与 LLM 的交界

| 层 | 包 |
|---|---|
| 注册与组装 | `@deepseek-ai/dsh-system-prompt` → `ctx.systemPrompt` |
| 准入策略 | agent-loop 的 projection（不在 `dsh-llm`） |
| 消费 | `dsh-llm` 只吃已进日志的 messages + `tools` |

---

## 跳转锚点

| 步骤 | 文件 | 行号附近 |
|---|---|---|
| `preStep` / `assemble` | [`agent-loop/.../agent.ts`](../packages/core/agent-loop/src/agent.ts) | L283–L314 |
| `renderPrompt` + 准入 + `buildRequest` | 同上 | L441–L479、L655–L743 |
| `assemble` / `renderPrompt` / `joinContextSections` | [`system-prompt/.../index.ts`](../packages/core/system-prompt/src/index.ts) | L296、L320、L588、L620 |
| `SystemPromptProjection` / `RuntimeContextProjection` | [`runtime-context.ts`](../packages/core/agent-loop/src/runtime-context.ts) | L93、L157 |
| 工具段示例 | [`tool-bash/.../index.ts`](../packages/shell/tool-bash/src/index.ts) | L251–L255 |
| cwd 上下文 | [`working-directory/.../index.ts`](../packages/session/working-directory/src/index.ts) | L90–L110、L172–L174 |

## 还没搞懂

1. **`agent/pre-step` 监听器**改写 messages / `startsRequestSeries` 的产品级用法有哪些？
2. **`complete: true` section** 与 waterfall 的交互：工具声明仍来自 provider，完整替换只影响 sections——边界用例？
3. **scoped persona 遮蔽**（preset）与全局 `personaPrefix` 在 HMR 下的替换顺序。
4. **本机对照**：解压真实 `session.v4.jsonl.zstd`，核对本篇与 [14b](./14b-prompt-assembly-example.md) 的事件顺序（待实测）。

## 读代码最短路径

1. [system-prompt README.zh](../packages/core/system-prompt/README.zh.md)
2. `assemble` / `renderPrompt` → `agent.ts` `preStep` / `step`
3. `runtime-context.ts` 两个 `project`
4. 跟一条真实贡献（如 `tool:bash`）从注册到 `system/message`
5. 读 [14b](./14b-prompt-assembly-example.md) 看逐步字符串
