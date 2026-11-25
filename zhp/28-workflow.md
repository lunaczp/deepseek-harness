# Workflow seam：模型写 JS 编排、`ctx.workflowEngine` 与 PTC

| | |
|---|---|
| 状态 | 学习中（源码 + 录制 session 快照；本机未新录 workflow） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@1482654297` |
| 证据 | 源码；快照 [`advanced-toolchain`](../snapshots/session/advanced-toolchain/session.v2.jsonl)、[`workflow-run`](../snapshots/session/workflow-run/session.v3.jsonl)；权威见 [`packages/workflow/`](../packages/workflow/README.zh.md)、[`docs/subsystems/workflow.zh.md`](../docs/subsystems/workflow.zh.md)、[`docs/capability-seams.zh.md`](../docs/capability-seams.zh.md)、[沙箱复用 Note](../.agents/notes/implemented/architecture/2026-09-13-workflow-ptc-sandbox-reuse.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Seam [19](./19-seam-and-service.md)；PTC [24](./24-ptc.md)；工具流水线 [17e](./17e-tool-pipeline.md)；jobs [18](./18-jobs.md)。

## 一句话

**Workflow = 模型写 plain-JS 编排脚本 → 默认 `workflow-ptc` 用 `ctx.ptcRuntime` 跑脚本 → `agent()` 扇出 `ctx.subagents` 做实际工作；不是 agent-loop，也不是 skill。**（源码）

---

## 1. 能力缝三角

| 角色 | 包 | `ctx` |
|---|---|---|
| Definition | [`dsh-workflow`](../packages/workflow/workflow/) | `ctx.workflowEngine` |
| Provider | [`workflow-ptc`](../packages/workflow/workflow-ptc/) | 实现引擎（依赖 `ptcRuntime`、`subagents` 等） |
| Consumer | [`tool-workflow`](../packages/workflow/tool-workflow/)；实验性 [`tool-ralph`](../packages/experimental/tool-ralph/) | 注册 `workflow` 工具 |

像 bash：**每 context 一个引擎**，无命名 Provider 注册表；换引擎靠插件替换。

| 易混 | 实际 |
|---|---|
| skill / Office「workflows」 | 说明书；≠ 本 seam |
| subagent | 1–2 次委派用 plain subagent；大量扇出/多阶段用 workflow |
| goal / Ralph | Goal 管会话长跑；Ralph 固定 fresh-agent 循环，消费本 seam，默认不进产品组合 |

---

## 2. 本质与边界

1. 模型写的是**编排用 JS**（钩子环境），不是随意 Node 程序。
2. 默认实现用 **`ctx.ptcRuntime`** 在沙箱进程跑脚本（与 `run_code` 共用 Node PTC 基板）。
3. Seam 抽象是 `workflowEngine`；**可换非 PTC 引擎**，产品默认是 PTC。
4. **`agent()` 不靠 PTC 写业务**：guest 只编排，LLM/工具在 subagent 里。
5. Guest **无**完整 fs/network/timer/Node API。

生命周期（**无** pause / step / resume / journaling）：

```text
start(request) → validate meta + parse script
  → WorkflowRun；emit workflow/start
  → PTC guest 跑钩子
  → result 兑现（Promise 不 reject）→ workflow/end
  → cancel?；必须 dispose()
```

句柄：[`runtime-types.ts`](../packages/workflow/workflow/src/runtime-types.ts#L19)。
两层事件：引擎 `workflow/*`；顶层 tool 写父 Session `tool-workflow/*`（嵌套 transport 不写）。

---

## 3. script 标准：提示词里有什么

**System prompt 只定何时用**（[`tool-workflow` #L326](../packages/workflow/tool-workflow/src/index.ts#L326)）：仅当用户明确要 workflow / 大规模多 agent 编排；1–2 次委派用 subagent；**exact format 在 tool description**。

**格式与钩子**在工具 `DESCRIPTION` + 参数 description（[#L158](../packages/workflow/tool-workflow/src/index.ts#L158)、[#L335](../packages/workflow/tool-workflow/src/index.ts#L335)）：

| 约定 | 内容 |
|---|---|
| 语言 | plain JavaScript，非 TypeScript |
| 形态 | 脚本体；允许顶层 `await`；`return` JSON 可序列化值 |
| meta | 工具参数 JSON；禁止脚本内 `export const meta` |
| 钩子 | `agent` / `pipeline` / `parallel` / `phase` / `log` / `args` |
| 失败 | 钩子误用 → 整脚本 fatal；子 agent 失败 → `agent()` 常为 `null` |

模型从 **tools schema 的 description** 得知有这些「伪全局」，不能 `import`。

---

## 4. 拿到 script：解析还是直接跑

**无人工审阅闸门。** Host 先 **parse-only**（`new vm.Script`，不执行），通过后 PTC guest 立刻跑。

[`assertBodyParses`](../packages/workflow/workflow-ptc/src/index.ts#L55)：包成 `(async () => {\n${body}\n})()`。失败 `SCRIPT_PARSE` / `META_INVALID` 同步抛错 → 模型可改的 tool error。

UI `presentCall`：generic 卡，`rawInput` = script（展示用，非审批）。无 workflow 专用 human-approval；也无 bash 那种沙箱提权审批窗口。

可选 `run_in_background` → `ctx.jobs`（tool 层后台）。

---

## 5. 为何「不像完整 JS」却合法

模型给的是**函数体**。引擎包装 + 注入全局（[`runtime.ts` #L75–#L98](../packages/workflow/workflow-ptc/src/runtime.ts#L75)）：

```js
(async () => {
  phase('Delegate')
  const reply = await agent('...', { label: 'workflow-child' })
  return { reply }
})()
```

| 全局 | 作用 |
|---|---|
| `agent` | 启 subagent 至完成 |
| `phase` | 进度阶段名（观察者；后续 agent 默认分组），不调度工作 |
| `log` / `parallel` / `pipeline` / `args` | 叙述、并发、入参 |

---

## 6. 真实模型调用例子（录制快照）

来源：[`snapshots/session/advanced-toolchain/session.v2.jsonl`](../snapshots/session/advanced-toolchain/session.v2.jsonl)（`deepseek-v4-flash`）。

模型 tool-call：

```json
{
  "name": "workflow",
  "id": "advanced-workflow",
  "arguments": {
    "script": "phase('Delegate')\nconst reply = await agent('Reply with exactly WORKFLOW_CHILD_OK and nothing else.', { label: 'workflow-child' })\nreturn { reply }",
    "meta": {
      "name": "advanced-headless-snapshot",
      "description": "exercise one workflow child through the headless agent"
    }
  }
}
```

Session 顺序：`tool/call` → `tool-workflow/run-start` → `agent-start` → `agent-end` → `run-end` → `tool/result`：

```text
workflow "advanced-headless-snapshot" completed (1 agent).
Return value:
{
  "reply": "WORKFLOW_CHILD_OK"
}
```

处理链：

```text
loop → tool-workflow.execute (#L409)
  → workflowEngine.start (#L436)
  → workflow-ptc：validate + assertBodyParses + PtcWorkflowRun
  → ptcRuntime.run → guest hooks → subagents.startActivation
  → result → dispose → renderResult → tool/result
```

另见 [`workflow-confinement`](../snapshots/session/workflow-confinement/session.v4.jsonl)（脚本内试图写文件被策略挡住）。

---

## 7. 组合位置

- base：`ptc-runtime-node` → `workflow-ptc` → `tool-workflow`
- web-app：顶层常 disable，preset `delegation` isolate 再挂回
- Ralph：opt-in，默认不进交付组合

---

## 还没搞懂

1. `workflow-ptc` host/guest 绑定与 sandbox 复用细节深读。
2. 与 subagent depth / cwd 谱系的一次实跑对照。
3. README「background deferred」与 tool 已实现 jobs 的文档漂移。

## 读代码最短路径

1. [workflow 子系统](../docs/subsystems/workflow.zh.md) + [组 README](../packages/workflow/README.zh.md)
2. Consumer：[`tool-workflow/src/index.ts`](../packages/workflow/tool-workflow/src/index.ts)（DESCRIPTION、prompt section、execute）
3. Provider：[`workflow-ptc` `start` / `assertBodyParses`](../packages/workflow/workflow-ptc/src/index.ts) + [`runtime.ts` 钩子](../packages/workflow/workflow-ptc/src/runtime.ts)
4. 快照：[`advanced-toolchain`](../snapshots/session/advanced-toolchain/session.v2.jsonl)
