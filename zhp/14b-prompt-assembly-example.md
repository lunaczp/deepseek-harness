# 提示词组装示例：用户说 Hello

| | |
|---|---|
| 状态 | 学习中（教学示例；文案来自源码，非本机一次完整会话录制） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@525a2eb387` |
| 证据 | 源码（身份 / bash / read / cwd 文案）；拼法对照 [`agent-loop/tests/loop.spec.ts`](../packages/core/agent-loop/tests/loop.spec.ts) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**刻意缩小的首轮：`assemble` 里仍是碎段与 `{{model}}`；`renderPrompt` 得到整段 system（无 cwd）；cwd 在独立的 runtime-context user 快照里；用户 `Hello` 再一条 user——三者经 `deriveMessages()` 进 LLM。**（源码）

关联：[14 组装机制](./14-prompt-assembly.md)；[12](./12-session-implementation.md)。产品全量 profile 只是 system 中间多出大量 `tool:*` 段，信封相同。

---

## 设定

| 项 | 值 |
|---|---|
| 用户输入 | `Hello`（将变成 `user/message`） |
| personaPrefix | `You are a coding agent on {{model}}.` |
| 已挂工具段 | `bash`、`read` |
| cwd | `/Users/lux/Github/lunaczp/deepseek-harness` |
| 路由 | `deepseek-official` / `deepseek-flash`（具备 `in-history`） |

---

## ① `assemble()` 之后（尚未 `renderPrompt`）

分段在内存里，**段与段未拼、变量未替**：

```text
sections:
  [harness:identity]
    "You are an AI agent powered by DeepSeek Harness."

  [deployment:persona-prefix]
    "You are a coding agent on {{model}}."    ← 仍是字面 {{model}}

  [tool:bash]
    "Check the [exit code: N] marker on every bash result; investigate failures before moving on."

  [tool:read]
    "Use the read tool — not shell commands like cat, sed, head, or tail — to inspect text files. Use offset and limit to read a line range or continue a large file."

contexts:
  [working-directory:current]
    'Current working directory: "/Users/lux/Github/lunaczp/deepseek-harness".'

variables:
  provider → "deepseek-official"
  model    → "deepseek-flash"

tools: [ { name: "bash", ... }, { name: "read", ... } ]
```

文案来源（源码）：

- 身份：[`system-prompt/src/index.ts`](../packages/core/system-prompt/src/index.ts) 约 L456–L460
- bash：[`tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts) 约 L251–L255
- read：[`tool-fs/src/read.ts`](../packages/fs/tool-fs/src/read.ts) 约 L69–L75
- cwd：[`working-directory/src/index.ts`](../packages/session/working-directory/src/index.ts) 约 L172–L174

`agent/pre-step` 默认把 runtime 快照做成**候选** user（尚未 commit）：

```text
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.

Current working directory: "/Users/lux/Github/lunaczp/deepseek-harness".
```

拼接：[`joinContextSections`](../packages/core/system-prompt/src/index.ts) 约 L320–L324。调用点：[`agent.ts`](../packages/core/agent-loop/src/agent.ts) 约 L296–L305。

---

## ② `renderPrompt(assembly)`

插值 + 丢空段 + `\n\n` → **最终 system 字符串**：

```text
You are an AI agent powered by DeepSeek Harness.

You are a coding agent on deepseek-flash.

Check the [exit code: N] marker on every bash result; investigate failures before moving on.

Use the read tool — not shell commands like cat, sed, head, or tail — to inspect text files. Use offset and limit to read a line range or continue a large file.
```

实现：[`renderPrompt`](../packages/core/system-prompt/src/index.ts) 约 L296–L301。
同类拼法测试：[`loop.spec.ts`](../packages/core/agent-loop/tests/loop.spec.ts) 约 L547。

**cwd 不在这段 system 里。**

---

## ③ `prepareCall` 后：`systemPrompt.project` + 写 Session

首轮无 system 节点 → 一条 append（[`runtime-context.ts`](../packages/core/agent-loop/src/runtime-context.ts) 约 L96–L97）：

```text
session ← system/message
  role: system
  content: [ { type: text, text: <② 整段 renderPrompt 结果> } ]
```

同一次首次 attempt（[`agent.ts`](../packages/core/agent-loop/src/agent.ts) 约 L459–L477）：

```text
session ← user/message   # runtime-context 快照
  source.kind: runtime-context
  source.form: snapshot
  text: <① 末尾 Current runtime context...>

session ← user/message   # 真正用户话
  source.kind: user
  text: "Hello"
```

---

## ④ `deriveMessages()` — 模型看到的 messages

请求**无**顶层 `system` 字段；历史大约：

```text
[
  {
    role: "system",
    content: [{ type: "text", text:
      "You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent on deepseek-flash.\n\nCheck the [exit code: N]...\n\nUse the read tool..."
    }]
  },
  {
    role: "user",
    content: [{ type: "text", text:
      "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent working directory: \"/Users/lux/Github/lunaczp/deepseek-harness\"."
    }],
    source: { kind: "runtime-context", form: "snapshot", sections: [{ name: "working-directory:current", text: "..." }] }
  },
  {
    role: "user",
    content: [{ type: "text", text: "Hello" }]
  }
]
```

外加 `tools: [bash, read]`、`provider` / `model` 等（[`buildRequest`](../packages/core/agent-loop/src/agent.ts) 约 L735+）。

---

## ⑤ 后续步：只变 cwd / 变 system 文本

| 情况 | system | runtime-context |
|---|---|---|
| 仅 cwd 变、`renderPrompt` 不变 | `project` → `[]`（约 L106），不写新 system | 快照文本变 → 再 append 一条 user 快照 |
| `in-history` 且 system 文本变、延续 series | **append** 新 `system/message`，旧前缀保留 | 按快照是否变化另算 |
| 非 `in-history` 或新 series 且有效文本变 | 清空后续非空 system，改写头节点 | 同上 |

---

## 对照表

| 步骤 | 提示词「长啥样」 |
|---|---|
| assemble | 碎段 + 未替换的 `{{model}}` + 独立 context 碎片 |
| renderPrompt | 一整段 system Markdown（无 cwd） |
| project → Session | 同上写入 `system/message`；cwd 在另一条 user 快照 |
| deriveMessages / wire | system + runtime user + Hello；tools 另字段 |

## 还没搞懂

1. 真实 web profile 首轮 `system/message` 全文有多长、段名顺序是否与 `SECTION_ORDERS` 一致？（待解压会话日志实测）
2. sandbox / approval 等 `required` context 与 working-directory 在快照中的相对顺序。

## 读代码最短路径

1. [14](./14-prompt-assembly.md) 机制
2. 本篇设定下的四个源码锚点（身份 / bash / read / cwd）
3. `agent.ts` `preStep` → `step` 准入循环
4. （可选）本机 `session.v4.jsonl.zstd` 对照首轮事件
