# bash / shell：注册、调用链、命名与平台差异

| | |
|---|---|
| 状态 | 学习中（源码走读；数字 / seq 为示意） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@84a231a84e` |
| 证据 | 源码；权威见 [`tool-bash`](../packages/shell/tool-bash/README.zh.md)、[`shell`](../packages/shell/shell/README.zh.md)、[`bash-sandbox`](../packages/shell/bash-sandbox/README.zh.md)、[`base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> 本篇事件序为**示意**；真值待会话 jsonl 核对。
> **跳转**：`[…#Ln](../packages/…#Ln)` 在 Cursor 聊天 / GitHub 可点；侧边栏预览点不开（见 [05](./05-workspace-conventions.md)）。

## 一句话

**模型工具按方言叫 `bash`/`pwsh`；能力 seam 叫通用的 `ctx.shell`；产品默认用 sandbox 版 Provider 注册成唯一 `ctx.shell`。不同 OS 组合挂不同工具，模型看到的工具名本身就不同。**（源码）

关联：[17](./17-tools.md)；[17c](./17c-sandbox-local.md)（`confine` / 四 runner）；[17d](./17d-subprocess.md)（`ctx.subprocess`）；[03](./03-sandbox-and-permissions.md)；[12](./12-session-implementation.md)。

---

## 0. 三层命名（为何工具叫 bash、seam 叫 shell）

| 层 | 名字 | 具体到什么 |
|---|---|---|
| **模型工具（Consumer）** | `bash` / `pwsh` | 模型该写哪种**方言**的命令字符串 |
| **能力 seam** | `ctx.shell` | 「跑一条命令」的抽象（`resolve` / `execute`） |
| **Provider** | `bash-local` / `bash-sandbox` / `pwsh-*` | 怎么起进程、要不要沙箱 |

- `shell` 通用：Provider 可换，tool body 只调 `ctx.shell`。
- 工具名钉死方言：仓库**不做** bash↔pwsh 翻译（[`tool-pwsh` README](../packages/shell/tool-pwsh/README.zh.md)）。若改成通用名 `shell`，模型更易写错方言。
- **不是命名事故**：Consumer 偏具体、seam 偏抽象——与 `tool-lsp` 消费 `ctx.lsp` 同理。

**因此：不同环境下，模型看到的工具本身就不同**（见 §8）。

---

## 锚点速查（可点）

| 阶段 | 链接 |
|---|---|
| Context 声明 `shell` | [`shell` L30–L34](../packages/shell/shell/src/index.ts#L30) |
| `ShellExecutor` 注册 `super(ctx,'shell')` | [`shell` L64–L67](../packages/shell/shell/src/index.ts#L64) |
| Cordis `Service` provide | [`vendor/cordis/.../service.ts` L42](../vendor/cordis/src/service.ts#L42) |
| `LocalBashExecutor` | [`bash-local` L97](../packages/shell/bash-local/src/index.ts#L97) |
| `SandboxBashExecutor` | [`bash-sandbox` L45](../packages/shell/bash-sandbox/src/index.ts#L45) |
| base：bash/pwsh 平台开关 | [`base/cordis.patch.yml` L249–L287](../packages/bundle/base/cordis.patch.yml#L249) |
| tool-bash inject | [`tool-bash` L33–L34](../packages/shell/tool-bash/src/index.ts#L33) |
| `defineTool({ name: 'bash' })` | [`tool-bash` L368](../packages/shell/tool-bash/src/index.ts#L368) |
| `bash.execute` 前台 → shell | [`tool-bash` L526–L530](../packages/shell/tool-bash/src/index.ts#L526) |
| `register` | [`tool-bash` L542–L555](../packages/shell/tool-bash/src/index.ts#L542) |
| loop → `tools.execute` | [`agent` L586–L597](../packages/core/agent-loop/src/agent.ts#L586) |
| native batch | [`native` L19–L20](../packages/core/tool-executor-native/src/index.ts#L19) |
| `tool/call` / `tool/result` | [`batch` L243](../packages/core/tools/src/batch.ts#L243)、[L252](../packages/core/tools/src/batch.ts#L252) |
| local `bash -c` | [`bash-local` L187–L188](../packages/shell/bash-local/src/index.ts#L187) |
| `subprocess.spawn` | [`bash-local` L259](../packages/shell/bash-local/src/index.ts#L259)、[`subprocess-local` L197](../packages/subprocess/subprocess-local/src/index.ts#L197) |

---

## 1. `ctx.shell` 怎么注册（不是 `tools.register`）

1. Provider 插件 `export default XxxExecutor`（extends `ShellExecutor`）。
2. Loader 挂载 → `new XxxExecutor(ctx)` → [`super(ctx, 'shell')`](../packages/shell/shell/src/index.ts#L64) → Cordis `provide('shell', this)`。
3. **每个 Context 只能有一个** `ctx.shell`；再挂第二个同名 Service 会抛错。

产品默认（非 Windows）挂的是 **`dsh-bash-sandbox`**（继承 local），不是裸 local；Windows 挂 **`pwsh-sandbox`**（见 [base L249–L257](../packages/bundle/base/cordis.patch.yml#L249)、[L281–L287](../packages/bundle/base/cordis.patch.yml#L281)）。

**没有运行时「选中 bash-local」**：组合时谁注册成唯一 `ctx.shell` 就是谁；`tool-bash` 不参与选择。

```text
SandboxBashExecutor  extends  LocalBashExecutor  extends  ShellExecutor
```

---

## 2. tool-bash body 与 `ctx.shell` 的关系

| | tool-bash `execute` | `ctx.shell` |
|---|---|---|
| 角色 | Consumer：模型 ↔ 命令 | seam：真正执行 |
| 负责 | 校验 args、cwd、升权、jobs 前后台、规范 JSON / render | `resolve` 默认与上限；`execute` 起进程 |
| 不负责 | `bash -c` / confine | 工具 schema、tool/call 日志 |

前台（[L526–L530](../packages/shell/tool-bash/src/index.ts#L526)）：

```text
request = { command, workdir, timeoutMs, dshEnv, sandboxPolicy? }
spec = ctx.shell.resolve({ ...request, signal })
foreground = await ctx.shell.execute(spec)
→ { kind: 'foreground', ...canonicalBashResult(...) }
```

换 local / sandbox / 将来远程 shell：**改 Provider；body 不变。**

---

## 3. 组合：谁挂了 bash 工具

[`base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)：`dsh-tools` + native 执行器 +（POSIX）`dsh-tool-bash` + `bash-sandbox`。

[`tool-bash` inject](../packages/shell/tool-bash/src/index.ts#L33)：`tools`, `shell`, `systemPrompt`, `shellEnv`, `workingDirectory`。

---

## 4. 注册工具：`apply` → `defineTool` → `register`

- [apply L202](../packages/shell/tool-bash/src/index.ts#L202)
- [defineTool L368](../packages/shell/tool-bash/src/index.ts#L368)（`name: 'bash'`）
- [register L542–L555](../packages/shell/tool-bash/src/index.ts#L542)（有 `jobs` 换后台变体）
- [ToolsService.register L128](../packages/core/tools/src/index.ts#L128)

---

## 5. 从 loop 到真实 spawn（前台、native）

```text
① agent.ts L586
   tools.execute({ calls, log, toolSet, … })
② tools → NativeToolExecutor → executeToolBatch
   append tool/call（log-only）
   pipeline → ToolDefinition.execute
③ tool-bash L526
   ctx.shell.resolve / execute
④ 默认 ctx.shell = SandboxBashExecutor
   →（confine）→ LocalBashExecutor.executeArgv(['bash','-c', command])  L187
⑤ ctx.subprocess.spawn  L259
   → subprocess-local → node:child_process.spawn
   append tool/result（surface）
```

关键点：[agent L586](../packages/core/agent-loop/src/agent.ts#L586)、[batch](../packages/core/tools/src/batch.ts#L243)、[pipeline dispatch](../packages/core/tools/src/pipeline.ts#L272)、[bash-local L187](../packages/shell/bash-local/src/index.ts#L187)、[subprocess-local L197](../packages/subprocess/subprocess-local/src/index.ts#L197)。

---

## 6. 事件序示意（一次前台 `ls`）

```text
assistant/message          # surface；content 含 tool-call bash
tool/call                  # log-only
  … pre-execute / guards / shell.execute / subprocess.spawn …
tool/result                # surface
```

`deriveMessages()` 看见 assistant + tool/result；看不见孤立 `tool/call`。

---

## 7. ToolExecutor vs ShellExecutor（易混）

| | ToolExecutor（native/PTC） | ShellExecutor（`ctx.shell`） |
|---|---|---|
| 挂法 | `ctx.tools.setExecutor` | `super(ctx,'shell')` |
| 干什么 | 整批模型 tool-call | 一条 shell 命令 |
| 与 bash | 调度到 `bash` Definition | bash body 的下游 |

---

## 8. Windows 下三层 / 模型看到的工具不同

**对：不同环境 → 模型可见工具名/方言不同**（base 用 `disabled: !!js process.platform …` 切换）。

| 层 | POSIX（默认 base） | Windows（默认 base） |
|---|---|---|
| 模型工具 | **`bash`**（`tool-bash`） | **`pwsh`**（`tool-pwsh`；tool-bash disabled） |
| seam | **`ctx.shell`**（同一个键） | 同左 |
| Provider | **`bash-sandbox`**（extends local） | **`pwsh-sandbox`**（extends `PwshLocalExecutor`） |

[`base` L281–L287](../packages/bundle/base/cordis.patch.yml#L281)：`tool-bash` / `tool-pwsh` 按平台互斥启用。

---

## 还没搞懂

1. 本机 jsonl 一次真实 bash / pwsh 的 seq 与 `sourceEventSeqs`（待实测）。
2. `promoteOnTimeout` 与 `job_*` 在模型文案上的衔接。

## 读代码最短路径

1. 命名 / 平台：[base patch L249–L287](../packages/bundle/base/cordis.patch.yml#L249) + 本篇 §0、§8
2. shell 注册：[shell L64](../packages/shell/shell/src/index.ts#L64) → [bash-sandbox L45](../packages/shell/bash-sandbox/src/index.ts#L45)
3. 工具：[tool-bash L368](../packages/shell/tool-bash/src/index.ts#L368) → [L526](../packages/shell/tool-bash/src/index.ts#L526) → [L542](../packages/shell/tool-bash/src/index.ts#L542)
4. 到底层：[bash-local L187](../packages/shell/bash-local/src/index.ts#L187) → [subprocess-local L197](../packages/subprocess/subprocess-local/src/index.ts#L197)
5. 沙箱拼 argv：[17c](./17c-sandbox-local.md) → [confine L325](../packages/sandbox/sandbox-local/src/index.ts#L325)
6. 起进程：[17d](./17d-subprocess.md) → [bash-local L259](../packages/shell/bash-local/src/index.ts#L259) / [subprocess-local L197](../packages/subprocess/subprocess-local/src/index.ts#L197)
