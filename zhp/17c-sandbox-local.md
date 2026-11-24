# sandbox-local：实现、四 runner 拼接与系统语法

| | |
|---|---|
| 状态 | 学习中（源码走读；系统语法为入门对照） |
| 日期 | 2026-11-24 |
| 基线 | `zhp@3934f3791b` |
| 证据 | 源码；权威见 [`sandbox-local`](../packages/sandbox/sandbox-local/README.zh.md)、[`sandbox`](../packages/sandbox/sandbox/README.zh.md)、[`sandbox-windows-acl`](../packages/sandbox/sandbox-windows-acl/README.zh.md)、[`base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**：`[…#Ln](../packages/…#Ln)` 在 Cursor 聊天 / GitHub 可点；侧边栏预览点不开（见 [05](./05-workspace-conventions.md)）。
> **边界实测**（能写哪、setuid、SBPL 拒写文案）只写在 [03](./03-sandbox-and-permissions.md)；本篇写**怎么拼 argv / 怎么选平台后端**。

## 一句话

**`sandbox-local` 不自己 spawn：按平台选 runner → 用 `SandboxPolicy` 拼 profile → 返回 `runner + profile + '--' + 原 argv`；不可用则 `SANDBOX_UNAVAILABLE`（fail-closed，绝不退回裸 argv）。**（源码）

关联：[17b](./17b-bash-tool-flow.md)（bash → `ctx.sandbox.confine`）；[17d](./17d-subprocess.md)（`confine` 之后的 `spawn`）；[21](./21-fs.md)（`fs-sandbox` 路径围栏，另一族）；[03](./03-sandbox-and-permissions.md)（权限实测）。

---

## 0. 在调用链上的位置

```text
bash-sandbox / pwsh-sandbox
  → ctx.sandbox.confine(['bash'|pwsh…], policy)   ← sandbox-local
  → ConfinedArgv.argv
  → ctx.subprocess.spawn(…）
```

yml 挂载（base）：`id: sandbox` → `@deepseek-ai/dsh-sandbox-local`（见 [README 最小配置](../packages/sandbox/sandbox-local/README.zh.md#use-this-package)）。

Seam 定义在 [`dsh-sandbox`](../packages/sandbox/sandbox/src/index.ts)；本包是默认 **Provider**。

---

## 锚点速查（可点）

| 主题 | 链接 |
|---|---|
| `confine` 拼 `'--' + argv` | [`sandbox-local` L325–L343](../packages/sandbox/sandbox-local/src/index.ts#L325) |
| `runnerArgv` 四分支 | [L347–L354](../packages/sandbox/sandbox-local/src/index.ts#L347) |
| `selectRunner` / `chainVerdict` | [L506–L524](../packages/sandbox/sandbox-local/src/index.ts#L506) |
| bwrap / landlock / seatbelt profile | [`profiles.ts`](../packages/sandbox/sandbox-local/src/profiles.ts) |
| windows-acl argv + ACE | [L369–L390](../packages/sandbox/sandbox-local/src/index.ts#L369)、[L406+](../packages/sandbox/sandbox-local/src/index.ts#L406) |
| windows runner 契约 | [`runner.ts` L11–L14](../packages/sandbox/sandbox-windows-acl/src/runner.ts#L11) |

---

## 1. 核心：`confine` 做什么

[`confine` L325](../packages/sandbox/sandbox-local/src/index.ts#L325)：

1. 规范化 `workspaceRoot`（`canonicalPath`）。
2. 若配置了 `runnerCommand`：跳过探测，按 **bwrap 兼容** 追加 profile，断言 `enforcement: 'full'`（运维自担）。
3. 否则 `selectRunner` → `runnerArgv` → 返回：

```text
{
  argv: [...runnerArgv, '--', ...原argv],
  enforcement: 'full' | 'partial',
  denialSignatures,      //  stderr 拒写方言
  runnerFailureRules,    // 区分「沙箱坏了」vs「策略拒绝」
}
```

**不负责**：真正 `spawn`、工作目录、stdio——那是 shell / subprocess。

---

## 2. 平台如何选 runner

| 平台 | 候选链（优先→备选） |
|---|---|
| Linux | **bwrap** → **Landlock**（`node-addon-system/landlock-run`） |
| macOS (darwin) | **sandbox-exec**（Seatbelt） |
| Windows (win32) | **windows-acl**（受限令牌 runner） |

规则（[`chainVerdict` L512](../packages/sandbox/sandbox-local/src/index.ts#L512)）：

- **唯一候选**：直接选，可不探测（执行期拒绝仍 fail-closed）。
- **多个候选**：按序功能探测（`spawnSync` 包 `true` / `exit 0`），首个可用则**缓存**到 provider 生命周期。
- 全挂 / 无链 → `SandboxUnavailableError`（消费方展示错误，**不**裸跑）。

探测超时等：config `probeTimeoutMs`（默认 5s）。

---

## 3. 四 runner 如何各自拼接（源码）

统一外壳：`[程序前缀] + [profile 参数] + '--' + 原命令`。差别只在前两段（[`runnerArgv` L347](../packages/sandbox/sandbox-local/src/index.ts#L347)）。

### 3.1 bwrap（Linux 首选）

[`bwrapProfileArgs`](../packages/sandbox/sandbox-local/src/profiles.ts#L16)：挂载型。

| mode | 参数要点 |
|---|---|
| `read-only` | `--ro-bind / /`、`--dev /dev`、`--unshare-pid`、`--proc /proc`、`--die-with-parent` |
| `workspace-write` | 同上 + `--tmpfs /tmp` + 每个可写根 `--bind root root`（`workspaceWritableRoots`） |

### 3.2 landlock（Linux 备选）

[`landlockProfileArgs`](../packages/sandbox/sandbox-local/src/profiles.ts#L30)：授权型；前缀是 `landlockLauncher()` binary。

| mode | 授权概念 |
|---|---|
| `read-only` | `/` 只读；`/dev/null` 可写 |
| `workspace-write` | 再加上 `/tmp` + workspace（及 additionalWritableRoots）可写 |

具体 flag 由 addon `landlockGrantArgs` 生成。

### 3.3 seatbelt（macOS）

[`seatbeltProfileArgs`](../packages/sandbox/sandbox-local/src/profiles.ts#L53)：SBPL 文本，`-p '…'`。

骨架：`(allow default)` → `(deny file-write*)` → 放行 `/dev/null` → 若有可写根则 `(allow file-write* (subpath …))`。

可写根来自共享 `writableRoots(policy)`（含文档化的 temp 区），与 in-process fs fence 对齐，避免漂移。

### 3.4 windows-acl（Windows）

[`windowsAclRunnerArgv` L369](../packages/sandbox/sandbox-local/src/index.ts#L369)：CLI flags +（可能）先写 ACE。

| 情形 | 拼法 |
|---|---|
| `read-only` / 无 `sessionId` | `--workspace` + 宿主 `--temp` + `--mode`，**不传 SID** |
| `workspace-write` + session | `materializeAclGrant` 后传私有 `--temp` + `--write-sid` + `--temp-write-sid`（runner 不再改 DACL） |
| 带 `additionalWritableRoots` | **直接抛** `SandboxUnsupportedPolicyError` |

工作区 SID 按路径确定性派生、ACE 常驻复用；临时目录每会话随机 + 可撤销（见文件头注释 [L8–L20](../packages/sandbox/sandbox-local/src/index.ts#L8)）。报告 **`partial`**（硬链接别名、读不限、包 SID 树等）。

---

## 4. 系统使用语法入门（对照）

手工在本机理解「包装器在干什么」时用；dsh 由 `confine` 自动拼。

### bwrap

```bash
bwrap \
  --ro-bind / / --dev /dev \
  --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp] [--bind /ws /ws] \
  -- \
  bash -c 'ls'
```

### landlock（经 launcher）

```text
<landlock-run>  <grant：只读/可写路径>  --  <命令…>
```

概念：允许读 `/`；允许写 `/dev/null`（及 workspace-write 下的 `/tmp`、workspace）。

### seatbelt / `sandbox-exec`

```bash
sandbox-exec -p '(version 1)
  (allow default)
  (deny file-write*)
  (allow file-write* (literal "/dev/null"))
  (allow file-write* (subpath "/path/to/ws"))
' -- bash -c 'ls'
```

（`sandbox-exec` 官方废弃但仍是「任意 CLI 套 SBPL」的实用入口；边界实测见 [03 §5](./03-sandbox-and-permissions.md)。）

### windows-acl runner（dsh 自研，非系统自带一条 CLI）

```text
node runner.js \
  --workspace <dir> --temp <dir> \
  --mode read-only|workspace-write \
  [--write-sid S-1-4-…] [--temp-write-sid S-1-4-…] \
  -- \
  cmd /c echo hi
```

契约见 [`runner.ts` L11–L14](../packages/sandbox/sandbox-windows-acl/src/runner.ts#L11)。

---

## 5. 平台差异一览

| | bwrap | landlock | seatbelt | windows-acl |
|---|---|---|---|---|
| OS | Linux | Linux | macOS | Windows |
| 内核/机制 | 用户 ns + mount | Landlock LSM | Seatbelt | 受限令牌 + NTFS ACE |
| 「策略」形态 | mount 开关 | 路径 grant | SBPL `-p` | flags + 事先 ACE |
| 可写根 | `workspaceWritableRoots` → `--bind` | 同上 → `readWrite` | `writableRoots` → `subpath` | 仅 workspace；额外根不支持 |
| 强制报告 | full | full 或 per-ABI partial | full | **partial** |
| 限读 | 挂载布局可收紧 | 授权白名单 | 本产品 profile 主攻限写 | **刻意不限读**（见 [03 §6](./03-sandbox-and-permissions.md)） |

共同点：都是 **包装 argv + `--` + 原命令**；不可用 fail-closed。

---

## 还没搞懂

1. Landlock `grantArgs` 产出的具体 flag 字符串（addon 源码再跟一刀）。
2. 本机 macOS 一次真实 `confine` 返回的完整 argv（对照 session / 探测缓存）。
3. `runnerFailureSignatures` 与 bash-sandbox 分类文案的逐条映射。

## 读代码最短路径

1. 入口：[confine L325](../packages/sandbox/sandbox-local/src/index.ts#L325) → [runnerArgv L347](../packages/sandbox/sandbox-local/src/index.ts#L347)
2. 选型：[chainVerdict L512](../packages/sandbox/sandbox-local/src/index.ts#L512)
3. 三 Unix profile：[`profiles.ts`](../packages/sandbox/sandbox-local/src/profiles.ts)
4. Windows：[windowsAclRunnerArgv L369](../packages/sandbox/sandbox-local/src/index.ts#L369) → [`runner.ts`](../packages/sandbox/sandbox-windows-acl/src/runner.ts)
5. 权限实测回家：[03](./03-sandbox-and-permissions.md)
6. 之后起进程：[17d](./17d-subprocess.md)
