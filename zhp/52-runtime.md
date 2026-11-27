# 「Runtime／运行时」：定义与区分

| | |
|---|---|
| 状态 | 学习中（用语梳理） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@efc25051d2` |
| 证据 | 源码 + 既有 zhp／docs 用语对照；跨框架行为为二手概括 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。架构 [01](./01-architecture.md)；仓库地图 [08](./08-repo-layout.md)；交付 [49](./49-deliverables-and-release.md)；与 Codex 产品运行时对照 [zhp-codex](../zhp-codex/dsh-vs-codex.md)；Cordis Fiber／Plugin.Runtime [10](./10-cordis-boot-loader.md)、[51](./51-cordis-effect.md)；PTC [24](./24-ptc.md)；提示词 runtime context [14](./14-prompt-assembly.md)；seam [19](./19-seam-and-service.md)。

## 一句话

**「运行时」是 overloaded 词。口语默认 = 常驻的 dsh／Cordis agent 进程；源码里还可能指 Plugin.Runtime、某个 `*Runtime` seam、prompt 的 runtime context、或安装包里的 dsh／sdk-runtime——读到时先归类，勿当成同一对象。**（源码 + 用语）

---

## 1. 日常含义（各框架共用）

相对编译／打包／设计时：**程序真正在跑**——有进程、有内存、能接输入、能产生副作用。

对 **agent 框架**，人们说「运行时」通常指：

> **长期活着的引擎**：收用户输入 → 调模型 → 跑工具 → 记状态 → 再循环；工具、权限、会话挂在它上面。

**不是**模型权重本身，也 **不是**写死的 prompt 文件。

---

## 2. 本仓：至少四层 + 两种交付话术

### 2.1 产品／进程运行时（默认口语）

一次 `dsh --profile …` 拉起的 **Node 进程 + Cordis 插件树**：agent-loop、工具、session、沙箱、Host GUI 都在这里。

- 架构总览：[01](./01-architecture.md)
- 怎么拼起来：[07](./07-startup.md)、[08](./08-repo-layout.md)（包 → bundle → profile）
- Host 是常驻 agent 运行时（对比 Next 绑请求生命周期）：[44](./44-host-client-dual-face.md)

```text
产品运行时 = 一个常驻进程里的 Cordis 应用
                 │
                 ├─ 很多 Plugin.Runtime（每个插件定义一份）
                 │       └─ 多个 Fiber（每次 ctx.plugin 一次）
                 │              └─ effects / on / provide …
                 ├─ agent-loop（「智能体怎么转」）
                 ├─ 能力 seam（fs / shell / ptcRuntime …）
                 └─ session 日志（状态在 ~/.dsh，不在 checkout）
```

[19](./19-seam-and-service.md) 写「Cordis 运行时」≈ **插件总线 + Service 解析**；产品说的「agent 运行时」≈ **整棵树 + loop + 世界接口**。

### 2.2 Cordis `Plugin.Runtime`

某个插件 **callback 在 registry 里的共享条目**：`name`、`fibers`、`callback`、可选 `Config` schema（[`registry.ts#L136–L145`](../vendor/cordis/src/registry.ts#L136)）。

- 是「这个插件定义」，**不是**整个 agent。
- `fiber.runtime`／mixin 的 `ctx.runtime` 指这一份；清理链见 [51](./51-cordis-effect.md)。

### 2.3 具名 seam／包：`*Runtime`

| 例子 | 指什么 | 笔记 |
|---|---|---|
| `ctx.ptcRuntime` | PTC 程序在 Host 上怎么跑 | [24](./24-ptc.md) |
| `ctx.webhookRuntime` | webhook 规则跑成 Session | capability-seams |
| `web-runtime` 配置行 | Web GUI 公告 URL 等 | 用户指南 public-deployments |

这些是 **树上的一块能力**，不是进程整体。

### 2.4 Prompt「runtime context」

组装进模型的 **动态上下文段**（cwd、GUI URL…）。见 [14](./14-prompt-assembly.md)。与进程引擎无关。

### 2.5 交付话术里的「运行时」

| 说法 | 指什么 | 笔记 |
|---|---|---|
| 安装包里的 **dsh 运行时** | CLI／Desktop／Python wheel 里可执行的 `dsh` | [49](./49-deliverables-and-release.md) |
| **`$DSH_HOME/profiles` 运行时目录** | 用户机上活着的 profile 配置（首次物化） | [07](./07-startup.md) |
| Python **`sdk-runtime` wheel** | 带原生 `dsh` 的配套运行时包 | [49](./49-deliverables-and-release.md)、python-sdk 指南 |

---

## 3. 阅读落点（四问）

见到「runtime／运行时」先问：

1. **进程／产品**？（整棵 dsh）→ §2.1
2. **Plugin.Runtime**？（`fiber.runtime`）→ §2.2
3. **某个 `*Runtime` seam／包名**？→ §2.3
4. **塞进 prompt 的 runtime context**？→ §2.4

默认口语「本项目的运行时」→ **①**。

---

## 4. 和其他 agent 框架

多数框架说的 runtime ≈ 本仓 **§2.1 产品／进程运行时**；很少再拆 Cordis 那种 Plugin.Runtime。

| 框架倾向 | 「运行时」大概是什么 | 与 DSH 粗对应 |
|---|---|---|
| LangGraph／图编排 | 图执行引擎：节点、边、checkpoint、中断 | ≈ agent-loop + session；DSH 用插件事件扩展，非显式 StateGraph |
| OpenAI／Claude／Cursor Agent SDK | 托管或本机 agent 进程：工具、会话、流式事件 | ≈ `dsh --profile sdk` + SDK 协议；DSH 还把 GUI／权限／沙箱编进同一 Cordis 树 |
| AutoGen 类多 agent | 对话／角色调度 + 工具执行环境 | ≈ subagent／team + 同一 Host 进程 |
| 薄 API wrapper | 几乎无本地运行时，状态在服务端 | DSH **刻意本地常驻**（工具、沙箱、日志本机） |

**共性：** 谁拥有 turn/step 循环和副作用。
**差异：** DSH 建成 **可拆装的 Cordis 应用**（profile／bundle／patch），而不是单一 `AgentRuntime` 类——所以源码里小写 `runtime` 语义要靠上下文猜。

（本节为跨产品概括，标 **二手**；本仓边界以 §2 源码为准。）

---

## 还没搞懂

1. `schedule/.../runtime.ts` 的 `ScheduleRuntime` 与 §2.3 命名族是否应统一进能力表。
2. 文档／JSDoc 是否有门禁区分 Plugin.Runtime vs 产品 runtime（防错读）。
3. Python sdk-runtime 与 npm `dsh` 版本对齐策略（[49](./49-deliverables-and-release.md) 待办交叉）。
