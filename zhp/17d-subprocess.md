# subprocess：设计、用法与平台实现差异

| | |
|---|---|
| 状态 | 学习中（源码走读；Linux scope / Windows Job 未在本机 macOS 实测） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@68deeb649b` |
| 证据 | 源码；权威见 [`subprocess` 组](../packages/subprocess/README.zh.md)、[`dsh-subprocess`](../packages/subprocess/subprocess/README.zh.md)、[`subprocess-local`](../packages/subprocess/subprocess-local/README.zh.md)、[`docs/subsystems/subprocess.zh.md`](../docs/subsystems/subprocess.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**：`[…#Ln](../packages/…#Ln)` 在 Cursor 聊天 / GitHub 可点；侧边栏预览点不开（见 [05](./05-workspace-conventions.md)）。
> 沙箱拼 argv 见 [17c](./17c-sandbox-local.md)；bash→shell 见 [17b](./17b-bash-tool-flow.md)；权限边界实测见 [03](./03-sandbox-and-permissions.md)。

## 一句话

**`ctx.subprocess` 只负责「起进程 / 收输出 / 整棵受管范围停稳」；命令语义、超时、沙箱包装、模型呈现归上游。本地 Provider 按平台选 owner：Linux user-systemd `.scope`、Windows Job、否则较弱 fallback。**（源码）

关联：[17b](./17b-bash-tool-flow.md)；[17c](./17c-sandbox-local.md)；终端持久壳：[terminal-bash](../packages/terminal/terminal-bash/README.zh.md)。

---

## 0. 包地图与职责切分

| 包 | 角色 |
|---|---|
| [`dsh-subprocess`](../packages/subprocess/subprocess/) | Service Definition：`ctx.subprocess` API、类型、`scrubbedParentEnv` |
| [`dsh-subprocess-local`](../packages/subprocess/subprocess-local/) | 本地 Provider：spawn / PTY / Linux scope / Windows Job / fallback |
| [`dsh-win32-process`](../packages/subprocess/win32-process/) | Windows FFI 库（CreateProcess / Job 等），无独立 ctx key |

```text
消费方（bash / lsp / terminal / subagent）
  决定：argv 含义、超时、sandbox 包装后的 argv、呈现
ctx.subprocess
  只做：resolveExecutable、按完整 spec 起进程、stdio/collect、terminate + waitForExit
```

请求必须写全，seam **不加隐藏默认**（与 shell 的 resolve/run 同理）。见 [`SubprocessRuntime`](../packages/subprocess/subprocess/src/index.ts#L117)。

---

## 锚点速查（可点）

| 主题 | 链接 |
|---|---|
| Seam API | [`subprocess/src/index.ts`](../packages/subprocess/subprocess/src/index.ts) |
| `SubprocessSpawnSpec` / Handle | [`types.ts` L77+](../packages/subprocess/subprocess/src/types.ts#L77) |
| `scrubbedParentEnv` | [L66](../packages/subprocess/subprocess/src/index.ts#L66) |
| 本地 `spawn` 选型 | [`subprocess-local` L197+](../packages/subprocess/subprocess-local/src/index.ts#L197) |
| fallback `spawnSubprocess` | [`spawn.ts` L454](../packages/subprocess/subprocess-local/src/spawn.ts#L454) |
| Linux `launchLinuxScope` / `scopeArgs` | [`linux-scope.ts` L672](../packages/subprocess/subprocess-local/src/linux-scope.ts#L672)、[L542](../packages/subprocess/subprocess-local/src/linux-scope.ts#L542) |
| `SystemdScopeOwner` | [L284](../packages/subprocess/subprocess-local/src/linux-scope.ts#L284) |
| Windows Job | [`windows-job.ts` L125](../packages/subprocess/subprocess-local/src/windows-job.ts#L125) |
| Linux `execve` 绑定 | [`linux-execve.ts`](../packages/subprocess/subprocess-local/src/linux-execve.ts) |
| bash 调用 spawn | [`bash-local` L259](../packages/shell/bash-local/src/index.ts#L259) |
| 终端调 `spawnTerminal` | [`terminal-bash` L205](../packages/terminal/terminal-bash/src/index.ts#L205) |

---

## 1. 设计：API 四面

[`SubprocessRuntime`](../packages/subprocess/subprocess/src/index.ts#L133)：

| 方法 | 干什么 |
|---|---|
| `resolveExecutable` | 绝对路径校验 / 裸名按 scrubbed PATH 找（拒相对带分隔符路径） |
| `spawn` | 普通受管进程；同步返回 `SubprocessHandle` |
| `spawnTerminal` | 真 PTY 会话（`node-pty`） |
| `terminalEnvironment` | **inspect（只读）** 执行环境的 shell 选择事实：`platform` + 可选 `defaultShell`（POSIX=`SHELL`/登录壳，Win=`ComSpec`），不起进程 |

`terminalEnvironment` 注释里的 Inspect = 查询/探看，不是调试器 inspect。

### 1.1 `spawn` vs `spawnTerminal`

| | `spawn` | `spawnTerminal` |
|---|---|---|
| I/O | pipe / collect / inherit | 真 tty 字节流 |
| 典型用户 | 一次性 bash、LSP | 持久交互壳（`terminal-bash`） |
| 规格 | `stdio`、可选 `control` | `rows`/`cols`/`terminalType`、可选 `shellActivity` |
| 本地 | runner / Job / scope / fallback | `node-pty`（+ 可选 Linux scope） |

pipe **不是** tty：`vim`/行编辑/前台组语义不对，故交互会话必须走 `spawnTerminal`。

### 1.2 Handle 生命周期

```text
spawn(spec) → handle { stdin?, stdout?, stderr?, control?, collected, done, terminate, waitForExit }

done          → 直接命令 exitCode / signal（spawn 失败则 reject）
terminate()   → 对「受管范围」发起终止（幂等）
waitForExit() → 等到整棵受管范围空，不只等顶层进程
```

stdio：`pipe`（协议分帧）/ `inherit` / collect（内存保尾 + 可选 spill；`readFrom(offset)` 不消费）。

环境：先 [`scrubbedParentEnv()`](../packages/subprocess/subprocess/src/index.ts#L66)（抠凭据形名字 + 所有 `DSH_*`），再合并显式 `env`。

---

## 2. 用法：谁在调

### 2.1 一次性命令（默认 headless / base）

```text
tool-bash → ctx.shell →（可选 confine）→ bash-local
  → ctx.subprocess.spawn(完整 spec)   ← L259
```

### 2.2 持久 PTY（需额外挂载）

```text
tool-bash-persistent / tool-pwsh-persistent / tool-terminal
  → ctx.terminals.spawn({ type: 'shell', … })
  → BashTerminalBackend.spawn
  → ctx.subprocess.spawnTerminal(…)   ← terminal-bash L205
```

默认 **`pnpm dsh --profile headless` 不挂** `dsh-terminal` / `terminal-bash` / persistent 工具（只有 base 的 one-shot bash）。要用持久壳需 `--patch` 或类似 [minimal `persistent-shell`](../packages/bundle/web-app/presets/minimal.patch.yml#L34) 的组合，并关掉冲突的一次性 `tool-bash`。

效果：**不会**在本机再开一个可见 Terminal 窗口；是 Node 进程内后台 PTY，输出经工具结果 / `--json` 事件回来。进程退出后会话全毁。

---

## 3. 本地 `spawn`：三选一 containment

[`LocalSubprocessRuntime.spawn` L197](../packages/subprocess/subprocess-local/src/index.ts#L197)：

```text
selectContainmentMode('ordinary')
  ├─ 'linux-scope'  → launchLinuxScope
  ├─ 'windows-job'  → launchWindowsJob
  └─ 'fallback'     → spawnSubprocess     ← macOS 几乎总是这条
```

原则：**native 已可能启动后，绝不 fallback 重放同一命令**。

---

## 4. 平台实现与底层调用

### 4.1 fallback（macOS；Linux/Win 强隔离不可用）

```text
spawnSubprocess                         [spawn.ts L454]
  → node:child_process.spawn(…)
  → libuv uv_spawn
  → POSIX: posix_spawn / fork+execve
     Windows: CreateProcessW（经 Node）
```

终止靠进程组 / `taskkill` 等；**逃逸后代不保证**杀净或拖住 `waitForExit`。会 `warnFallback` 一次。

### 4.2 Linux scope（user-systemd 可用）

**Scope** = systemd 单元类型 `.scope`：给「外来进程」划定的活动范围（cgroup），不是 `.service`。

```text
Node spawn('systemd-run', [
  --user --scope --quiet --collect [--expand-environment=no] --unit=…
  --  <bootstrap> -- <目标 argv>
])                                          [scopeArgs L542]
  → user manager 建临时 dsh-*.scope
  → scope 内 bootstrap 恢复 cwd/env/fd
  → libc execve(目标)                       [linux-execve / spawn-runner]
```

| 组件 | 职责 |
|---|---|
| **`systemd-run --scope`** | 建篮子、把进程放进 cgroup |
| **`execve`** | 当前进程变成用户命令（PID 通常不变） |
| **`SystemdScopeOwner`** | `systemctl --user kill/show` 杀树、等空、数 task |

起作用落点：选型 [`selectContainmentMode`](../packages/subprocess/subprocess-local/src/index.ts#L237) + [`LinuxScopeSelector`](../packages/subprocess/subprocess-local/src/linux-scope-selector.ts)；创建 [`launchLinuxScope`](../packages/subprocess/subprocess-local/src/linux-scope.ts#L672) / [`prepareLinuxTerminalScope`](../packages/subprocess/subprocess-local/src/linux-scope.ts#L635)；杀/等 [`SystemdScopeOwner` L284](../packages/subprocess/subprocess-local/src/linux-scope.ts#L284)。

前提：可读 user manager、`systemd-run` 支持 `--collect`（≥236）等；否则 fallback。

### 4.3 Windows Job

```text
launchWindowsJob
  → child_process.spawn(runner…)
  → runner：CreateProcessW / CreateProcessAsUserW，挂进 Job
```

Job 关 handle 时可杀成员；与 Linux scope 对位的「受管范围」原语。细节在 [`windows-job.ts`](../packages/subprocess/subprocess-local/src/windows-job.ts)、[`win32-process`](../packages/subprocess/win32-process/)。

### 4.4 对照表

| | fallback | Linux scope | Windows Job |
|---|---|---|---|
| 何时 | macOS；native 不可用 | Linux + user-systemd | win32 + Job 可用 |
| 建范围 | 无（观察 PGID/树） | `systemd-run --scope` | Job object |
| 目标进程落地 | Node spawn → exec 类 | bootstrap → **`execve`** | **`CreateProcess*`** |
| terminate / 等空 | 进程组 / taskkill | `systemctl kill/show` | Job / runner IPC |
| 逃逸后代 | 可能丢 | cgroup 成员仍在 | Job 成员 |

---

## 5. 与 sandbox / shell 的边界

| | sandbox | subprocess |
|---|---|---|
| 管什么 | 文件效果 → 包装 argv | 进程生命周期与 I/O |
| 是否起进程 | 否 | 是 |
| 顺序 | `confine` 在前 | `spawn` 在后 |

```text
bash-sandbox: confine → argv' → subprocess.spawn(argv')
```

上层代码**不会**出现 `.scope` 字样；只感到 `terminate`/`waitForExit` 在 Linux native 上更可靠。

---

## 6. `systemd-run` 与 `exec`（概念）

| | `systemd-run` | `exec` / `execve` |
|---|---|---|
| 是谁 | systemd CLI | 内核系统调用 |
| 干什么 | 建单元并在其中启动命令 | **替换**当前进程映像 |
| dsh 中 | 建 `--scope` 篮子 | bootstrap 变成用户命令 |

两步串起来，不是二选一。fallback 路径则只有 Node/`exec` 类，没有 systemd。

---

## 还没搞懂

1. 本机 Linux 上一次真实 `dsh-*.scope` 的 `systemctl --user status` 对照（待实测）。
2. Windows Job runner IPC 消息与 `done` / range 空的时序细图。
3. `shellActivity` + scope `inspectTaskCount` 如何共同判定 idle。

## 读代码最短路径

1. Seam：[`subprocess/src/index.ts`](../packages/subprocess/subprocess/src/index.ts) + [`types.ts`](../packages/subprocess/subprocess/src/types.ts)
2. 本地入口：[index L197](../packages/subprocess/subprocess-local/src/index.ts#L197) → 三分支
3. fallback：[spawn.ts L454](../packages/subprocess/subprocess-local/src/spawn.ts#L454)
4. Linux：[scopeArgs L542](../packages/subprocess/subprocess-local/src/linux-scope.ts#L542) → [SystemdScopeOwner L284](../packages/subprocess/subprocess-local/src/linux-scope.ts#L284) → [linux-execve](../packages/subprocess/subprocess-local/src/linux-execve.ts)
5. 消费方：[bash-local L259](../packages/shell/bash-local/src/index.ts#L259)；持久壳：[terminal-bash L205](../packages/terminal/terminal-bash/src/index.ts#L205)
