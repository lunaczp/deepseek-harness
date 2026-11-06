# 结论摘要

> 来源：与 DSH agent（lead）的一轮问答，2026-11-06。
>
> 证据强度标注：**实测** = 在本机跑过命令并观察结果；**源码** = 读仓库代码确认；**日志** = 系统/内核日志；**二手** = 外部文档或他人复现；**推断** = 尚未直接验证。

---

## 1. 能看见脚手架，看不见权重

agent 可以逐行读取运行自己的这套 harness 代码——提示词拼装、工具实现、循环、沙箱。**但没有任何通道能看到自己的模型权重、注意力、token 概率。**

"看见代码" ≠ "看见自己"：代码是外壳，思考是权重里的函数。读 `agent.ts` 只能知道一次请求如何发出，不能知道为什么选了某个词。**（实测 + 源码）**

## 2. 路径来自注入，不是发现

"我的代码在 `/Users/lux/Github/lunaczp/deepseek-harness`"最初不是推断出来的，而是 runtime context 每轮注入的一句话。**先有证词，后有验证**。

可核实的是：目录存在、版本一致、日志里有从该目录 `src/*.ts` 启动的栈帧。不可核实的是：当前进程是否就是那一次启动——`ps` 被 setuid 规则挡住，无法观察。**（实测 + 日志 + 推断）**

## 3. 读权限远宽于写权限

- **读**：几乎整个文件系统，只有 macOS TCC 拦 `~/Library/{Messages,Mail,Safari}`。
- **写**：仅会话工作区与 `/tmp`。`~/.dsh`、代码 checkout、`/var/folders`、`~/Library/Caches` 全部拒绝。

这个不对称是关键风险面：**能读到你几乎所有文件，能写的地方只有你指定的目录。** **（实测）**

## 4. 没有命令黑名单，setuid 一律不可执行

仓库里搜不到任何按命令名配置的黑名单。`ps`/`top`/`sudo`/`su`/`crontab` 等被拒，原因是它们带 **setuid 位**：复制一份去掉 s 位即可执行。

内核日志的操作名是 `forbidden-exec-sugid`——Seatbelt 的内置检查，**写不进 SBPL profile，也删不掉**。苹果从未公开文档化这个操作名。**（实测 + 日志 + 二手）**

## 5. `sandbox-exec` 已被废弃，但没有真正的替代

官方 man page 原话：DEPRECATED，请改用 App Sandbox。但 App Sandbox 是 entitlement 层、面向 `.app`，**无法给任意 CLI 命令套自定义 profile**。对"给任意命令套壳"这个需求，Apple 至今没有官方方案。

平台对比：macOS 语义最完整但路径已废弃；Linux（bwrap / Landlock）最干净；Windows 用受限令牌 + ACL，只限写、且承认 `partial`。**（日志 + 二手 + 源码）**

## 6. 自我迭代的三个硬约束

1. **自我重启必须外置 supervisor**——agent 不能是自己的父进程，重启只能发生在 turn 边界，用 sentinel 文件传递意图。
2. **自我修改必须是事务**——propose → build → verify → activate → restart → health，失败自动回滚，磁盘上永远保留一个已知可启动的代际。
3. **评测函数必须在 TCB 内**——如果 agent 既能改实现又能定标准，它会学会降低标准。这是这类系统最典型的死法。

详见 [04-self-evolving-agent.md](./04-self-evolving-agent.md)。

---

## 一句话

**脚手架可读可改，权重不可见；读权限极宽、写权限极窄；重启必须外置；评测必须外置。**
