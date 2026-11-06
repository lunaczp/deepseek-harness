---description: "面向本 checkout 的事务式自改：隔离的 generation、持久 journal，以及把一代换成下一代的进程 supervisor。"kind: "package-reference"---

# @deepseek-ai/dsh-evolve

[English](README.md) | 中文

## Summary

给 agent 一条改自己脚手架的路径，同时让它改不坏。改动以独立的 Git worktree 提出，在那里构建与校验，通过移动指针激活；新代启动失败时，由 agent 或 supervisor 回滚。源 checkout 永不被编辑，agent 也永远不会停掉自己的进程。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

在工具注册表可用的位置挂载本插件，并指定它拥有的 checkout。所有随部署变化的选择都是必填配置，没有默认值。

```yaml
- name: '@deepseek-ai/dsh-evolve'
  config:
    repositoryRoot: /absolute/path/to/deepseek-harness
    buildCommand: ['pnpm', 'run', 'build:artifacts']
    verifyCommand: ['pnpm', 'run', 'typecheck']
    commandTimeoutMs: 900000
    maxConsecutiveVerifyFailures: 3
    linkDependencies: true
    maxOutputChars: 4000
```

插件注册五个工具：

| 工具 | 作用 |
|---|---|
| `evolve_propose` | 把解析出的 commit 检出为 `evolve/generations/gen-NNNN` worktree 并记录。源 checkout 不受影响。 |
| `evolve_build` | 在 generation 目录内运行 `buildCommand`。非零退出把该代标记为 failed。 |
| `evolve_verify` | 在 generation 目录内运行 `verifyCommand`，并推进失败预算。 |
| `evolve_activate` | 把已验证的代设为 current，并写入重启请求。 |
| `evolve_rollback` | 把最后一次成功启动的代重新设为 current，并写入重启请求。 |

supervisor 运行在插件树之外，因为 agent 不能替换自己的父进程：

```ts
import { Supervisor } from '@deepseek-ai/dsh-evolve/src/supervisor.ts'

const supervisor = new Supervisor({
  repositoryRoot: '/absolute/path/to/deepseek-harness',
  command: ['pnpm', 'dsh', '--profile', 'web'],
  healthPort: 3080,
  startupTimeoutMs: 120_000,
  pollIntervalMs: 500,
  minUptimeMs: 30_000,
  terminateGraceMs: 10_000,
  maxConsecutiveFailures: 2,
})
await supervisor.run(signal)
```

一个进程服务一个代。系统拥有的一切都在 `evolve/` 下：

```text
evolve/
  state.json            current, lastKnownGood, failure budget, generation records
  journal.jsonl         append-only audit trail, written by the agent and the supervisor
  ready                 readiness handshake, written by this plugin when it mounts
  restart-request.json  the agent's request to be replaced, consumed by the supervisor
  generations/          one Git worktree per generation
```

`state.json` 与 `restart-request.json` 都经由临时文件加 rename 替换，读方不会看到写了一半的文档。

<a id="understand-the-implementation"></a>
## Understand the implementation

一个代依次经过 `proposed`、`built`、`verified`、`active`、`failed`。每一步都拒绝状态不符的记录，因此跳步的调用方无法把工具按错误顺序跑通。`activate` 与 `rollback` 只移动指针并写重启请求，都不会停掉调用进程。

健康是多条件的合取，不是端口探测。supervisor 要求子进程存活、`healthPort` 可连接，且 `ready` 文件的修改时间不早于本次 spawn。每次 spawn 前它都会删掉 `ready`，因此握手证明的是新进程加载了本插件，而不是某个旧进程仍占着端口。

`lastKnownGood` 只由 `recordHealthyStart` 写入，而只有 supervisor 调用它。因此 activate 无法自称健康，回滚目标永远是某个进程真正启动过的代。子进程启动失败或退出时，supervisor 自己恢复 `lastKnownGood` 并记录该决定；不存在这样的代时它停下，而不是继续循环。

失败预算是连续的。一次成功的 verify 会清零；达到 `maxConsecutiveVerifyFailures` 会把 `halted` 置位，此后每个步骤都拒绝执行。解除 halt 需要直接编辑 `state.json`，这条路径刻意放在 agent 的工具之外。

<a id="further-exploration"></a>
## Further Exploration

- [自改设计草案](../../../zhp/04-self-evolving-agent.md) 描述了本包所属的更大路线图。
- [@deepseek-ai/dsh-experimental-worktree](../worktree/README.zh.md) 负责 Session 的普通 worktree 创建；本包管理自己的池，因为提出改动不能移动调用方的工作目录。

<a id="model-experience"></a>
## Model Experience

### 工具调用面

#### 模型看到什么

五个 schema，每个事务步骤一个。每个都暴露 generation 标识符，以及在需要判断时的一个 reason 字符串。没有 schema 暴露路径、环境变量或分支名：模型选择的是**哪一步**与**为什么**，而从不选择**在哪里**。

#### Token 影响

在工具可见的每个请求上有少量固定 schema 开销。

#### KV Cache 影响

只要工具定义与配置不变，前缀就是稳定的。插件的激活或卸载可能使该提示词段的复用失效。

### 工具结果

#### 模型看到什么

标识符、状态，以及至多 `maxOutputChars` 个字符的命令输出；截断取自尾部，因此最后一行错误得以保留。构建或校验失败时报告退出状态与这段尾部，而不是整个编译器日志。

#### Token 影响

每次调用由 `maxOutputChars` 限定。成功的 propose 或 activate 只返回几个短字符串。

#### KV Cache 影响

结果追加在已缓存前缀之后，不改写它。

## Known Limitations and Deferred Work

- **supervisor 是源码模块，不是受支持的入口。** 仓库策略拒绝 package bin 与临时的应用启动器，因此 `run` 从 `src/supervisor.ts` 导入。
- **supervisor 尚未与 agent 隔离。** 它就在本包内，agent 可以通过 generation 编辑它。在它搬到 agent 不可写的路径之前，草案要求的隔离并不成立。
- **依赖是共享的，不是安装的。** 开启 `linkDependencies` 时，generation 复用源 checkout 的 `node_modules`，因此新增或升级依赖的改动无法被校验。
- **还没有评分。** 验收标准是命令退出状态；路线图第二步的客观 benchmark 分数尚未接入。
- **解除 halt 需要人工编辑。** 清除 `halted` 必须直接写 `state.json`。
- **没有清理旧 generation 的机制。** worktree 会在 `evolve/generations/` 下累积。
