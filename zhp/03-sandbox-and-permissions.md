# 沙箱与权限：实测边界

> 所有数据来自本机实测（macOS，2026-11-06），不是文档推断。

## 1. 读写执行三条边界

### 读：几乎整个文件系统

| 类别 | 结果 |
|---|---|
| 家目录（Documents / Desktop / Downloads / Library / Github） | ✅ |
| 敏感位置（`~/.ssh`、`~/.dsh/.credentials.yaml`） | ✅ |
| 系统（`/`、`/etc`、`/usr/bin`、`/var/log`、`/System`） | ✅ |
| `~/Library/Messages`、`~/Library/Mail`、`~/Library/Safari` | ❌ **macOS TCC 拦截**，与 harness 无关 |

### 写：只有两处

| 路径 | 结果 |
|---|---|
| 会话工作区 | ✅ |
| `/tmp`（`/private/tmp`） | ✅ |
| `~/.dsh`、代码 checkout、`/private/var/folders`、`~/Library/Caches` | ❌ `Operation not permitted` |

被拒的写操作可以通过一次性的提权重试（`danger-full-access`）+ 用户批准来完成。

### 执行：没有黑名单

## 2. 没有命令黑名单

在 `packages/shell`、`packages/sandbox`、`packages/subprocess` 中搜索命令名、`dangerous`、`denyCommands`、`blockedCommands`——**均为空**。

`profile` 只有三条规则：

```scheme
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "<workspace>") (subpath "/tmp") …)
```

## 3. 被拒的程序：setuid 位，不是黑名单

### 对照实验

| 程序 | 属性 | 结果 |
|---|---|---|
| `/bin/ps` | setuid root | rc 126（execve EPERM） |
| `/bin/ps` 的字节副本到 `/tmp`（去掉 s 位） | 755 | rc 137（执行成功，枚举进程时被杀） |
| `atq`、`crontab`、`top`、`sudo`、`su`、`quota`、`newgrp`、`login`、`traceroute` | setuid | 全部 rc 126 |
| `cal`、`ls`、`cat`、`id` | 非 setuid | 全部 rc 0 |
| `chmod u+s` 自己的文件 | — | ❌ `Operation not permitted` |

**变量是 setuid 位本身**，与路径、与程序名无关。

### 机制名

内核日志给出操作名：

```
deny(1) forbidden-exec-sugid
```

这是 Seatbelt 的内置检查，**不可在 SBPL 中增删**。Apple 从未公开文档化；证据来自系统日志与社区复现。

补充：`pgrep`、`lsof` 能执行，但看不到其它进程（返回空 / rc 1）。

## 4. 为什么错误信息会误导

`packages/sandbox/sandbox-local/src/index.ts` 里：

```ts
seatbelt: ['operation not permitted'],
```

任何 stderr 含该子串的失败都被归类为沙箱文件拒绝。于是 **exec 的 EPERM 被显示成 `[sandbox: file access denied]`**，掩盖了真实原因。这是检测口径，不是策略。

## 5. `sandbox-exec` 已废弃

man page 原话：

> The `sandbox-exec` command is **DEPRECATED**. Developers who wish to sandbox an app should instead adopt the App Sandbox feature.

但这个替代不等价：

| | sandbox-exec / SBPL | App Sandbox |
|---|---|---|
| 作用对象 | 任意子进程 | 自己的 `.app` |
| 配置 | 运行时 profile 文本 | 编译期 entitlements |
| 前提 | 有二进制即可 | bundle + 签名 + 公证 |
| 能限制别人的程序 | 能 | **不能** |

对"给任意 CLI 命令套自定义沙箱"，Apple 至今没有官方方案。这也是 Claude Code、Codex、Homebrew 等仍在使用它的原因。

## 6. 三平台后端

| | macOS | Linux | Windows |
|---|---|---|---|
| 机制 | Seatbelt / SBPL | bwrap / Landlock | 受限令牌 + ACL + Low 完整性 |
| 形态 | 策略语言 | 挂载命名空间 / 路径规则 | 拼原语 |
| 限写 | ✅ | ✅ | ✅ |
| 限读 | 可写规则（未启用） | ✅ | ❌ 刻意不做 |
| 官方状态 | 已废弃，无替代 | 正常 | 正常，无 CLI 专用件 |
| 强制程度 | full | full | **partial** |

Windows 后端（`packages/sandbox/sandbox-windows-acl/`）用 `WRITE_RESTRICTED` 令牌 + 能力 SID + Low 完整性标签。**不选 AppContainer 的原因**：AppContainer 令牌没有环境读权限，每条可读路径都要预先授权，与"随便读"的模型冲突。

已知短板：NTFS 硬链接可别名到工作区外；只限写/删，不限读与网络；控制台隔离不可用。
