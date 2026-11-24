# bash 举例：注册 → 模型可见 → 真实调用

| | |
|---|---|
| 状态 | 学习中（源码走读；数字 / seq 为示意） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@1b58995f95` |
| 证据 | 源码；权威见 [`tool-bash`](../packages/shell/tool-bash/README.zh.md)、[`dsh-tools`](../packages/core/tools/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> 本篇事件序为**示意**；真值待会话 jsonl 核对。

## 一句话

**启动时 `tool-bash` 把 `defineTool({ name: 'bash' })` 注册进 `ctx.tools`；每步 resolve 后 schema 进请求；模型回 `tool-call` → loop `tools.execute` → 流水线 → `bash.execute` → `ctx.shell.execute` → `tool/result` 进 surface。**（源码）

关联：[17](./17-tools.md)；[12](./12-session-implementation.md)；[03](./03-sandbox-and-permissions.md)（沙箱审批）。

---

## ① 组合：谁挂了 bash

`dsh-base`（[`packages/bundle/base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)）大致：

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-tool-executor-native'
# … shell / sandbox / jobs …
- name: '@deepseek-ai/dsh-tool-bash'
```

`tool-bash` 声明依赖（[`tool-bash/src/index.ts` L33–L34](../packages/shell/tool-bash/src/index.ts#L33)）：

```ts
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv', 'workingDirectory']
```

原生执行器挂载（[`tool-executor-native/src/index.ts` L33–L35](../packages/core/tool-executor-native/src/index.ts#L33)）：

```ts
export function apply(ctx: Context): void {
  ctx.tools.setExecutor(new NativeToolExecutor(ctx))
}
```

---

## ② 注册：`apply` → `defineTool` → `register`

插件入口 [`apply` L202+](../packages/shell/tool-bash/src/index.ts#L202) 内构造 `bashTool`，核心定义在 [L368–L534](../packages/shell/tool-bash/src/index.ts#L368)：

```ts
return defineTool({
  name: 'bash',
  description: bashDescription(),
  parameters: {
    description: { type: 'string', required: true, /* … */ },
    command: { type: 'string', required: true, /* … */ },
    timeoutMs: { type: 'number', /* … */ },
    workdir: { type: 'string', /* … */ },
    // 可选：run_in_background / sandbox_permissions / justification
  },
  output: {
    schema: { oneOf: [ /* background | promoted | foreground */ ] },
    render: (_args, value) => [{ type: 'text', text: /* … */ }],
    presentationMeta: (_args, value) => ({ cwd: value.cwd }),
  },
  async execute(args, exec) { /* 见 ⑤ */ },
  presentCall: presentBashCall,
  presentResult: presentBashResult,
})
```

真正挂进注册表（[L542–L555](../packages/shell/tool-bash/src/index.ts#L542)）：

```ts
if (!backgroundEnabled) {
  ctx.tools.register(bashTool(undefined))
  return
}
let foregroundOnly = ctx.get('jobs') === undefined
  ? ctx.tools.register(bashTool(undefined))
  : undefined
ctx.inject(['jobs'], (jobCtx) => {
  foregroundOnly?.()
  const unregister = ctx.tools.register(bashTool(jobCtx.jobs))
  // jobs 卸载时退回前台-only 变体
})
```

含义：

- 有 `ctx.jobs` → 注册带后台 / promote 能力的 bash
- 无 jobs → 仅前台；超时由 executor deadline kill

`register` 实现：[`tools/src/index.ts` L128–L152](../packages/core/tools/src/index.ts#L128)（`layers.effect`，同名冲突失败）。

---

## ③ 本步准入：resolve + schema 进模型

[`agent.ts` L292–L294](../packages/core/agent-loop/src/agent.ts#L292)：

```ts
const toolSet = await this.loopCtx.tools.resolve({ agent: this, modelSelection: selection, signal })
const assembly = await this.loopCtx.systemPrompt.assemble({
  ...assembleContextFor(this, signal), modelSelection: selection, toolSet,
})
```

`ToolsService` 构造时把 schema 接到 systemPrompt（[`tools/src/index.ts` L111–L117](../packages/core/tools/src/index.ts#L111)）：

```ts
ctx.systemPrompt.tools(({ scope, toolSet }) => {
  const executor = this.selectExecutor(scope)
  const description = executor.describe(this.definitions(scope, toolSet))
  return { ...description, knownNames: description.knownNames ?? [...] }
})
```

native `describe`（[native L15–L16](../packages/core/tool-executor-native/src/index.ts#L15)）把可见定义投影成模型 `ToolSchema[]`（含 `bash`）。

模型请求里大致看到：

```json
{ "name": "bash", "description": "…", "parameters": { "type": "object", "properties": { "command": …, "description": … } } }
```

`execute` / `output.render` **不会**出现在请求里。

---

## ④ 模型回调用 → loop 批次

助手消息 content 含 tool-call block 后（[`agent.ts` L586–L597](../packages/core/agent-loop/src/agent.ts#L586)）：

```ts
const toolCalls = message.content.filter(block => block.type === 'tool-call')
const result = await this.loopCtx.tools.execute({
  calls: toolCalls, signal, agent: this, log: { turn, step },
  maxParallelToolCalls, toolSet: decision.toolSet,
})
```

示意模型产出：

```text
assistant content:
  tool-call { id: "call_1", name: "bash", arguments: '{"command":"ls -la","description":"List files"}' }
```

`ctx.tools.execute` → `selectExecutor` → native（[L375–L377](../packages/core/tools/src/index.ts#L375) / [native L19–L20](../packages/core/tool-executor-native/src/index.ts#L19)）→ `executeToolBatch`。

---

## ⑤ 批次内：日志 + 流水线 + bash 身体

### 5.1 执行前写 `tool/call`（log-only）

[`batch.ts` L243–L249](../packages/core/tools/src/batch.ts#L243)：

```ts
return agent.session.append('tool/call', {
  turn, step, callId: block.id, name: block.name, arguments: block.arguments,
}).seq
```

### 5.2 流水线（共享）

顺序见 [17 §4](./17-tools.md) / [流水线图](../docs/tool-execution-pipeline.zh.md)：

`prepare` → `tools/pre-execute` → `checkGuards` →（ask 则 approval）→ `dispatch` 里 `tools/execute` 包住 **`tool.execute(args, exec)`** → `projectContent` → `post-execute` → `finalizeContent` → `tools/result` 通知。

未知工具 / 参数坏 → 结构化 `isError`，通常不掀 turn。

### 5.3 bash `execute` 身体（前台路径）

[`tool-bash` L478–L530](../packages/shell/tool-bash/src/index.ts#L478)：

```ts
async execute(args, exec) {
  validateBashArgs(args, …)
  // 可选：sandbox_permissions + justification → approveEscalation
  const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
  const workdir = resolveWorkdir(args.workdir, cwd)
  const request = { command: args.command, workdir, timeoutMs, dshEnv, sandboxPolicy }
  // 后台 / job promote 分支略 → 见同文件 L498–L525
  const spec = ctx.shell.resolve({ ...request, signal: exec.signal })
  const foreground = await ctx.shell.execute(spec)
  const result = await foreground.result()
  if (result.aborted) throw toolAborted()
  return { kind: 'foreground', ...canonicalBashResult(result, spec.workdir) }
}
```

即：**Consumer `bash` → Provider `ctx.shell`**（能力 seam），不是 bash 自己 spawn。

`output.render` 把规范值变成模型可见 text（如 stdout/stderr 摘要）。

### 5.4 结算写 `tool/result`（surface）

[`batch.ts` L252–L265](../packages/core/tools/src/batch.ts#L252)：

```ts
agent.session.append('tool/result', {
  turn, step,
  message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
  …error / meta
}, {
  surfaceOp: 'append',
  sourceEventSeqs: [callSeq],   // 引用刚才的 tool/call
})
```

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
# 若还有工具债 → 下一步再请求；模型看到上一步 tool/result
```

下一请求 `deriveMessages()` 可见：… assistant（带 tool-call）+ tool/result …；**看不到**孤立的 `tool/call` 事件本身。

---

## ⑦ 对照表

| 阶段 | 代码 | 是否调 LLM | Session |
|---|---|---|---|
| 注册 | `tool-bash` `apply` + `register` | 否 | 无 |
| 本步 schema | `resolve` + `assemble` + native `describe` | 否（只进请求信封） | header / system 另记 |
| 模型决定调 bash | adapter stream | **是** | `assistant/message` |
| 执行 bash | batch + pipeline + `bash.execute` + `shell` | 否 | `tool/call` → `tool/result` |
| 带结果再问 | 下一步 LLM | **是** | 新 `assistant/message` |

---

## 还没搞懂

1. 本机 jsonl 里一次真实 bash 的 seq / `sourceEventSeqs`（待实测）。
2. `promoteOnTimeout` 与 `job_*` 工具在模型可见文案上的衔接。

## 读代码最短路径

1. [`tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts)：`apply` → `defineTool` → `execute` → `register`
2. [`agent.ts`](../packages/core/agent-loop/src/agent.ts) L292、L586
3. [`batch.ts`](../packages/core/tools/src/batch.ts) `start` / `commit`
4. [`shell`](../packages/shell/shell/README.zh.md)（`resolve` / `execute`）
