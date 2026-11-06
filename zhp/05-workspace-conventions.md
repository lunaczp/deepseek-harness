# 工作区与引用约定

> 本篇由旧工作区的 `AGENTS.md` 合并而来。内容是实测与源码结论，供后续会话直接遵守，不必重新推导。
> 生效范围：本仓库。若与本仓库根目录的 `AGENTS.md`（项目开发约定）冲突，以那篇为准，本篇只补 agent 工作方式的细节。

---

## 1. Markdown 链接：用裸路径，不要 `file://`

GUI 的本地文件链接**只认裸路径**。判据在 `packages/client/ui-primitives/src/markdown/file-link.ts`：

- `isExplicitFilePath` 只匹配以 `/`、`./`、`../`、`C:\` 开头；
- 其余能 `URL.canParse` 的（包括 `file:///...`）一律返回 `undefined`，退化成打不开的外链。

| 写法 | 结果 |
|---|---|
| `[名称](/abs/path/file.ts#L23)` | ✅ 打开文件并定位行 |
| `[名称](relative/path/file.ts#L23)` | ✅ 按工作区解析 |
| `[名称](/abs/path/file.ts:23)` | ✅ 冒号行号也可 |
| `[名称](file:///abs/path/file.ts#L23)` | ❌ 被丢弃 |

交付物（图片、文档）用 `present` 工具给文件卡，不要把裸路径当唯一入口。

## 2. 沙箱边界（2026-11-06 实测）

### 读

几乎整个文件系统可读。唯一被拒的是 macOS TCC 保护的目录：

```
~/Library/Messages
~/Library/Mail
~/Library/Safari
```

这与 harness 无关，是系统层拦截。

### 写

| 路径 | 结果 |
|---|---|
| 会话工作区（含所有子目录） | ✅ |
| `/tmp` | ✅ |
| `~/.dsh`、`~/.Documents`、`~/Desktop`、`~/Downloads`、`/Users/Shared` | ❌ |
| `/private/var/folders`、`~/Library/Caches` | ❌ |

### 机制

macOS 用 `sandbox-exec`（Seatbelt / SBPL），profile 实质只有三条：

```scheme
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "<workspace>") (subpath "/tmp") …)
```

**注意：没有网络规则。** 也就是说，文件写入被限制，网络访问未被限制。

## 3. 没有命令黑名单

在 `packages/shell`、`packages/sandbox`、`packages/subprocess` 中搜不到任何按命令名配置的拒绝表。`ps`/`top`/`sudo` 被拒的原因是它们带 **setuid 位**：

- 任意 setuid 二进制 → exec EPERM（rc 126）；
- 同一份字节复制到 `/tmp`、去掉 s 位 → 正常执行；
- `chmod u+s` 自己的文件 → 也被拒。

内核日志里的操作名是 `forbidden-exec-sugid`，是 Seatbelt 的内置检查，**写不进 profile，也删不掉**。Apple 从未公开文档化。

`pgrep`/`lsof` 能执行，但看不到其它进程（返回空 / rc 1）。

## 4. 一个会误导人的日志口径

`packages/sandbox/sandbox-local/src/index.ts` 里：

```ts
seatbelt: ['operation not permitted'],
```

任何 stderr 含该子串的失败都被归类为沙箱文件拒绝。于是 **exec 的 EPERM 会显示成 `[sandbox: file access denied]`**。看到这条消息时，先分清是「文件被拒」还是「程序被拒」。

## 5. 引用代码的纪律

- 带文件名、带行号：`agent.ts:344`；
- **不确定行号就不要写行号**，不要把猜测写成精确引用；
- 结论标注证据来源：实测 / 源码 / 日志 / 二手 / 推断。

最后一条来自实际教训：写作过程中出现过三次把推断当成观测的错误（路径归属、`ps` 归因、SBPL 规则），都在 `zhp/00`–`zhp/03` 中更正了。
