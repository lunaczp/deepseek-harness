# zhp/ 目录说明

本目录收录一轮人机问答后沉淀下来的结论与设计，全部基于对本仓库源码的实测与阅读。

| 文件 | 内容 | 一句话 |
|---|---|---|
| [AGENTS.md](./AGENTS.md) | 协作约定 | 学习目标、合作方式、进度锚点（新会话先读） |
| [00-conclusions.md](./00-conclusions.md) | 结论摘要 | 六条要点，带证据强度标注 |
| [01-architecture.md](./01-architecture.md) | 七层架构 | 从入口到状态层，纵轴是依赖方向 |
| [02-request-lifecycle.md](./02-request-lifecycle.md) | 请求链路 | 一次提问到回复的九步，及"没有一次性的我" |
| [03-sandbox-and-permissions.md](./03-sandbox-and-permissions.md) | 沙箱实测 | 读写边界、setuid、SBPL、三平台对比 |
| [04-self-evolving-agent.md](./04-self-evolving-agent.md) | 自改设计草案 | supervisor、事务式修改、评测外置 |
| [05-workspace-conventions.md](./05-workspace-conventions.md) | 工作区约定 | 链接语法、沙箱事实、引用纪律 |
| [06-session-and-resume.md](./06-session-and-resume.md) | 会话与恢复 | 补账而非续跑，turn 边界是安全重启点 |
| [07-startup.md](./07-startup.md) | 启动流程 | 空根 + 补丁层，Loader 拼出插件树 |
| [08-repo-layout.md](./08-repo-layout.md) | 仓库地图 | 包 → bundle → profile 三层组合 |
| [09-cli-headless-flow.md](./09-cli-headless-flow.md) | CLI / headless | 一次 task 启动到 stdout，共享 agent-loop |
| [10-cordis-boot-loader.md](./10-cordis-boot-loader.md) | Cordis 最小启动 | bin.js → Loader → Include → registry.plugin |
| [11-dsh-vs-cordis-boot-files.md](./11-dsh-vs-cordis-boot-files.md) | DSH vs Cordis 文件表 | 启动相关路径与 `wc -l` 体量对照 |
| [12-session-implementation.md](./12-session-implementation.md) | Session 实现 | 事件日志 / Surface / 问答 trace |
| [13-llm-implementation.md](./13-llm-implementation.md) | LLM 实现 | `ctx.llm` / 适配器 / prepareCall / 重试 |
| `assets/` | 图与生成脚本 | 两张 PNG + SVG 源 + Python 生成器 |

## 阅读顺序建议

想快速了解结论 → 读 `00`。
想知道 agent 怎么运转 → `01` + `02`。
想知道 CLI 一次提问怎么跑 → `09`（对照 `07` 的 web 启动）。
想弄清 Cordis / Loader 最小启动链 → `10`（再读 `07` 的 DSH 补丁栈）。
想对照 DSH/Cordis 启动文件体量 → `11`。
想弄清 Session 日志与一次问答落事件 → `12`（恢复语义对照 `06`）。
想弄清模型调用与适配器 → `13`（对照 `02` 的⑤⑥与 `12` 的 request/assistant 事件）。
想知道它能碰什么、不能碰什么 → `03`。
想讨论自我迭代的可行性 → `04`。

## 证据约定

文中标注：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档或他人复现；**推断** = 尚未验证。

**推断与实测分开标注**，是这批文档的基本要求——写作过程中出现过三次把推断当观测的错误，都在文档里改掉了。
