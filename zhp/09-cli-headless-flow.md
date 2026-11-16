# CLI / headless：启动与一次提问

| | |
|---|---|
| 状态 | 学习中（主链路已走通） |
| 日期 | 2026-11-16 |
| 基线 | `zhp@f2ef660e81` |
| 证据 | 源码为主；无本轮实测 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**官方 CLI 任务模式就是 headless：一次 argv/stdin task → 一个 Session turn（可能多 step）→ stdout 答案 → 退出。** 没有交互式 REPL；多轮靠 `--session-id` 再起进程，或走 web。（源码）

与 [07-startup.md](./07-startup.md) 对照：前半（`bin` → 空根 + 补丁 → Loader）相同；web 挂好后监听端口，headless 挂好后跑 `headless-runner` 并 `appExit`。与 [02-request-lifecycle.md](./02-request-lifecycle.md) 对照：②–⑧ 的 agent-loop 相同，①/⑨ 在 headless 里是 argv→stdout，不是 WebSocket→前端。

## 1. 启动：到插件树就绪

```
pnpm dsh --profile headless "task"
  或 shorthand：dsh headless "task"
  → apps/cli/src/bin.ts runCli
  → parseDshArgs → mode: profile
  → profile-boot.runProfile
       composeProfile：base → headless → 用户 patch → home → --patch
       boot()：空根 cordis.yml + provideCmdline(args)
  → Loader 挂载整棵树
```

| 步 | 位置 | 做什么 |
|---|---|---|
| 入口 | [`bin.ts`](../apps/cli/src/bin.ts) | `parseDshArgs`；profile 模式动态 import `runProfile`；`loadLayeredEnv('dsh')` |
| 参数 | [`args.ts`](../apps/cli/src/args.ts) | launcher 只吃 `--profile` / `--patch` / dump；其余原样交给 app；`dsh headless …` 扩成 `--profile headless` |
| 模板 | [`bundles.ts`](../packages/util/official-bundles/src/bundles.ts) | headless = `dsh-base` + `dsh-headless` |
| 叠补丁 | [`profile-boot.ts`](../apps/cli/src/profile-boot.ts) | 与 web 同一套层序；空根每次写成 `[]` |
| 目录 | `~/.dsh/profiles/headless/` | 首次按模板初始化（与 [07](./07-startup.md) 的 web 同构） |

Headless 相对 web 的关键差异（[`cordis.patch.yml`](../packages/bundle/headless/cordis.patch.yml)）：

- 插入 `headless-startup` + `headless-runner`，**无** webserver / client
- `hmr` / `credentials` / `authorization` / `deepseek-account` **disabled**（用启动时凭证，不做交互登录）
- 进程生命周期由 runner 调 `appExit`，不是常驻监听

## 2. Task 怎么进系统

[`startup.ts`](../packages/bundle/headless/src/startup.ts) 的 `headless-startup`：

1. `inject: ['cmdlineArgs']`，用 Commander 解析 positional `[task...]`、`--json`、`--session-id`、`--permission-mode`、`--approval-policy`、`--add-dir`
2. `ctx.provide('headlessStartup', { task, sessionId, json, … })`
3. TTY 且无 task → usage error；非 TTY 可 defer 到 stdin（`task: undefined`，runner 再读）

Patch 把服务接到 runner：

```yaml
- id: headless-runner
  inject: [headlessStartup]
  config:
    task: !!js ctx.headlessStartup.task
    sessionId: !!js ctx.headlessStartup.sessionId
    json: !!js ctx.headlessStartup.json
```

**没有 shipped 的交互式 CLI REPL。** README / command description 写明：one task per invocation, no interactive follow-up。

## 3. 提问后：runner → agent-loop → 终端

[`index.ts`](../packages/bundle/headless/src/index.ts) `run()`：

```
loader.await()
  → agents.create({ sessionId, meta:{cwd}, … })
     或 --session-id → agents.resume / resolveAgent
  → agent.whenIdle()
  → 可选 permission / approval
  → agent.followup(createUserMessage({ text: task, source:{kind:'user'} }))
  → while whenIdle + subagents.waitForTreeWork
  → sessions.flush
  → summarize → stdout；reasoning → stderr；或 --json NDJSON
  → appExit(0|1)
```

### 共享环（与 web 同一套）

[`agent.ts`](../packages/core/agent-loop/src/agent.ts)：

| 符号 | 作用 |
|---|---|
| `followup` → `send` → `wakeDriver` | 入队并拉起 driver |
| `turn()` | `turn/start` → 若干 step → `turn/end` |
| `preStep()` | claim inbox；`tools.resolve`；`systemPrompt.assemble`；`runtimeContext.project` |
| `step()` | `request/header` → `llm.stream` → `assistant/message` → 可选 `tools.execute` |

工具结果写 `tool/result` 进 session surface；下一 step 用 `deriveMessages()` 编进请求——**不是另开一条临时通道**。连续性来自日志重放，见 [02](./02-request-lifecycle.md) / [06](./06-session-and-resume.md)。

### CLI 只负责呈现

| 模式 | 输出 |
|---|---|
| 默认 | reasoning 流 → stderr；最终 assistant 文本 → stdout |
| `--json` | session 事件投影成 NDJSON → stdout；`final` 收尾 |

headless **不**参与模型/工具调度；只订阅 `agent/assistant-stream` / `session/event` 再投影。

## 4. 端到端时序

```
dsh --profile headless "画一张图"
  → bin / runProfile / Loader（base + headless）
  → headless-startup.provide(task)
  → headless-runner: create Agent
  → followup(user message)
  → turn/start
      → step: 组上下文 → llm.stream → assistant/message
      → 若有 tool_use → tool/call → execute → tool/result → 下一 step
  → turn/end
  → stdout 答案；exit
```

一条“回复”常是 **N 个 step**（每次重新 `preStep` + 一次模型请求）。

## 5. 和 web 的分叉点

| | headless | web |
|---|---|---|
| Bundle | `dsh-headless` | `dsh-web-app` |
| 提问入口 | argv / stdin → `followup` | WebSocket → gateway → 同一 `followup`/`send` |
| 呈现 | stdout / stderr / NDJSON | 前端订阅事件渲染 |
| 生命周期 | one-shot 后退出 | 常驻端口 |
| 多轮 | `--session-id` 二次进程 | UI 内连续 turn |

分界：**共享环只写 session / `agent/*` 事件；各 app 订阅这些事件做人机面。**

## 还没搞懂

1. **`resolveAgent` / resume 采用条件**：`--session-id` 时哪些 header/cwd 不匹配会拒绝（`assertAdoptable`）。
2. **`--json` 事件名与 session 类型的完整映射表**（`json-stream.ts`）。
3. **subagent 树何时让 `whenIdle` 假醒**：`waitForTreeWork` 与父 agent status 的时序。
4. **approval / permission 在 headless 无人值守下的默认路径**：`never` 与 workspace-write 如何组合。
