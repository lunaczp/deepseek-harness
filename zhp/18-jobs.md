# jobs：后台任务的设计、实现与使用

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@6ad34ffb60` |
| 证据 | 源码；权威见 [`jobs` 组](../packages/jobs/README.zh.md)、[`dsh-jobs`](../packages/jobs/jobs/README.zh.md)、[`jobs-local`](../packages/jobs/jobs-local/README.zh.md)、[`tool-jobs`](../packages/jobs/tool-jobs/README.zh.md)、[`docs/subsystems/jobs.zh.md`](../docs/subsystems/jobs.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**：`[…#Ln](../packages/…#Ln)` 在 Cursor 聊天 / GitHub 可点（见 [05](./05-workspace-conventions.md)）。
> Cordis 角色用语见 [19](./19-seam-and-service.md)、[20](./20-plugin-and-service.md)；bash 登记 job 见 [17b](./17b-bash-tool-flow.md)。

## 一句话

**jobs 让长时间工作在 agent 继续推进时仍可被读、等、列、杀；按所有者会话隔离，完成可通知，无需轮询。** `dsh-jobs` 定约定，`dsh-jobs-local` 进程内实现，`dsh-tool-jobs` 提供模型工具与控制器。（源码）

---

## 0. 包与 seam 角色

| 包 | 角色 | ctx / 作用 |
|---|---|---|
| [`dsh-jobs`](../packages/jobs/jobs/) | Service Definition | 抽象 `JobRegistry` → `ctx.jobs`；直接加载会抛错 |
| [`dsh-jobs-local`](../packages/jobs/jobs-local/) | Service Provider | `LocalJobRegistry`；yml 挂上后提供 `ctx.jobs` |
| [`dsh-tool-jobs`](../packages/jobs/tool-jobs/) | Consumer（apply 型 plugin） | `job_output` / `job_list` / `job_kill` + 完成通知 + **controller** |

base 已挂：[`jobs-local`](../packages/bundle/base/cordis.patch.yml) + [`tool-jobs`](../packages/bundle/base/cordis.patch.yml)。

**没有 controller（通常即未挂 tool-jobs）时 `start()` 拒绝**——避免起了没人能收/杀的活。

---

## 1. 设计

### 1.1 职责切分

```text
生产方（tool-bash / pwsh / PTY / subagent…）
  → ctx.jobs.start(JobSpec)     登记；准入后调 run()
运行时（jobs / jobs-local）
  → id、归属、状态、输出环、事件、容量
模型（tool-jobs）
  → job_* 工具；结算通知（忙则注入下一步，闲则 wakeup）
```

- 运行时**不**拥有 OS 进程；真正进程仍在生产方（常再调 shell → subprocess）。
- 与 [17d](./17d-subprocess.md) 关系：jobs 是「后台工作」抽象；subprocess 是「起进程」。

### 1.2 核心词汇

| 概念 | 含义 |
|---|---|
| `JobId` | `<kind>-<16位hex>`（如 `bash-a1b2…`）；授权靠 owner，不靠 id 保密 |
| 状态 | `running` → `stopping` → `completed` / `killed` / `failed` |
| 归属 | 启动它的 agent 会话；他 agent 不可见 |
| 输出环 | 有界；`stdout`/`stderr` 给模型，`log` 给观察者 |
| `read` / `readAt` | 推进模型游标 / 不消耗（UI） |
| Session | `job/registered`、`job/settled`（持久元数据；**环不跨进程恢复**） |

### 1.3 设计要点（约定层）

- 约定与实现分包；抽象类误挂会 fail-loud（[`JobRegistry` L93–L96](../packages/jobs/jobs/src/index.ts#L93)）。
- 每进程一个注册表，按 owner 过滤；id 可预测故是授权边界。
- 结算首次优先；`awaited` 表示 wait 已收走完成 → tool-jobs 不再重复通知。
- 注册存续长于生产方/控制器 fiber；owner 或服务 dispose 才取消清理。

---

## 2. 实现（jobs-local）

| 文件 | 职责 |
|---|---|
| [`jobs-local/src/index.ts`](../packages/jobs/jobs-local/src/index.ts) | `LocalJobRegistry`：start/list/read/kill/wait、容量、dispose |
| [`ring.ts`](../packages/jobs/jobs-local/src/ring.ts) | 有界输出环 |
| [`pump.ts`](../packages/jobs/jobs-local/src/pump.ts) | 拉取源定期泵入环 |
| [`events.ts`](../packages/jobs/jobs-local/src/events.ts) | 事件 hub |

配置（默认）：`maxConcurrentJobsPerOwner=10`，`retainBytes=256KiB`，`settledRetainBytes=16KiB`，`pumpPollMs=150`。达上限 `start()` 失败（不排队、不抢占）。

记录在内存；harness 退出即丢运行态。有主 job 的注册/结算会写 Session 事件。

---

## 3. 使用

### 3.1 组合

```yaml
- name: '@deepseek-ai/dsh-jobs-local'
- name: '@deepseek-ai/dsh-tool-jobs'
```

### 3.2 模型工具

| 工具 | 作用 |
|---|---|
| `job_output(job_id, wait?, timeout_ms?)` | 读增量；wait 可被超时或用户 steer 打断（**不杀**任务） |
| `job_list()` | 列出自己的任务 |
| `job_kill(job_id, reason?)` | 请求取消 → 停稳后 `killed` |

完成通知：未读输出可内联（`inlineOutputBytes`）或提示再用 `job_output`。

### 3.3 生产方样板：bash

有 `ctx.jobs` 时，[`tool-bash`](../packages/shell/tool-bash/src/index.ts#L262) **每次调用先 `jobs.start`**，再在 `run()` 里 `shell.execute`：

```text
bash → jobs.start({ kind:'bash', label, owner, output, run })
    → run() 内 ctx.shell.execute → subprocess.spawn
    → 前台 wait；promoteOnTimeout 则转后台
    → 模型用 job_* 继续管
```

适配：[background.ts](../packages/shell/tool-bash/src/background.ts)。

### 3.4 代码调用（插件内）

```ts
const id = ctx.jobs.start({ kind: 'bash', label: '…', owner, output, run: () => hooks })
const view = ctx.jobs.get(id, owner)
const read = ctx.jobs.read(id, owner)
ctx.jobs.kill(id, owner, 'reason')
await ctx.jobs.wait(id, owner, { timeoutMs })
```

---

## 还没搞懂

1. `promoteOnTimeout` 前台→后台时，模型首条结果与后续 `job_output` 的分工（待对照一次真实 jsonl）。
2. `maxConsecutiveWakes` 与自激链的边界案例。

## 读代码最短路径

1. Definition：[`jobs/src/index.ts`](../packages/jobs/jobs/src/index.ts) + [`types.ts`](../packages/jobs/jobs/src/types.ts)
2. Provider：[`jobs-local/src/index.ts`](../packages/jobs/jobs-local/src/index.ts)
3. Consumer：[`tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)
4. 生产方：[tool-bash L262+](../packages/shell/tool-bash/src/index.ts#L262)
5. 字段：[docs/subsystems/jobs.zh.md](../docs/subsystems/jobs.zh.md)
