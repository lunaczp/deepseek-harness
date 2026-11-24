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
| [13b-dsh-llm.md](./13b-dsh-llm.md) | dsh-llm 深读 | 词汇 / 注册表 / prepareCall / 投影 / 失败边界 |
| [14-prompt-assembly.md](./14-prompt-assembly.md) | 提示词组装 | assemble / renderPrompt / system vs runtime-context |
| [14b-prompt-assembly-example.md](./14b-prompt-assembly-example.md) | 组装示例 | 用户 Hello 逐步字符串 |
| [15-token-meter.md](./15-token-meter.md) | Token 计量 | `measure` / 启发式 / 投影 / 与压缩 |
| [15b-token-meter-example.md](./15b-token-meter-example.md) | 计量示例 | 接 14b Hello 的启发式推算 |
| [16-compaction.md](./16-compaction.md) | 会话压缩 | 压力 / 溢出 / replace 摘要 / 锁 |
| [16b-compaction-example.md](./16b-compaction-example.md) | 压缩示例 | 压力触发时的日志与模型视图 |
| [17-tools.md](./17-tools.md) | 工具模块 | 注册表 / 执行器 / 流水线 / loop 批次 |
| [17b-bash-tool-flow.md](./17b-bash-tool-flow.md) | bash/shell | 命名三层、平台 bash/pwsh、loop→spawn |
| [17c-sandbox-local.md](./17c-sandbox-local.md) | sandbox-local | 选 runner、拼 argv、四平台系统语法 |
| [17d-subprocess.md](./17d-subprocess.md) | subprocess | seam、spawn/PTY、Linux scope / Win Job / fallback |
| [18-jobs.md](./18-jobs.md) | jobs | 后台任务约定 / local 实现 / tool-jobs 使用 |
| [19-seam-and-service.md](./19-seam-and-service.md) | seam ↔ service | 能力缝 vs `ctx` 服务；谁是谁不是 |
| [20-plugin-and-service.md](./20-plugin-and-service.md) | plugin ↔ service | apply vs class、哲学、场景 |
| [21-fs.md](./21-fs.md) | fs | `ctx.fs`、local/sandbox、tool-fs / 搜索 |
| `assets/` | 图与生成脚本 | 两张 PNG + SVG 源 + Python 生成器 |

## 阅读顺序建议

想快速了解结论 → 读 `00`。
想知道 agent 怎么运转 → `01` + `02`。
想知道 CLI 一次提问怎么跑 → `09`（对照 `07` 的 web 启动）。
想弄清 Cordis / Loader 最小启动链 → `10`（再读 `07` 的 DSH 补丁栈）。
想对照 DSH/Cordis 启动文件体量 → `11`。
想弄清 Session 日志与一次问答落事件 → `12`（恢复语义对照 `06`）。
想弄清模型调用与适配器 → `13`（对照 `02` 的⑤⑥与 `12` 的 request/assistant 事件）。
想深读核心包 `@deepseek-ai/dsh-llm` → `13b`（先扫 `13` 包地图）。
想弄清请求前提示词怎么拼 → `14`；要逐步字符串例子 → `14b`。
想弄清 token / 上下文压力怎么估 → `15`；要接 Hello 表面的数字推算 → `15b`。
想弄清长会话如何压缩 → `16`；要逐步日志示意 → `16b`。
想弄清工具注册与执行 → `17`；bash/shell 命名、平台差异与到底层 spawn → `17b`。
想弄清 `sandbox-local` 怎么选 runner、拼 argv、四平台语法 → `17c`（权限实测仍看 `03`）。
想弄清 `ctx.subprocess` 设计、用法与 Linux scope / Win Job / fallback → `17d`。
想弄清后台任务 jobs → `18`。
想弄清 seam 与 Service 的关系 → `19`；plugin 与 Service、两种形态 → `20`（可先扫 `10`）。
想弄清文件系统 `ctx.fs` / tool-fs → `21`（写边界实测仍看 `03`）。
想知道它能碰什么、不能碰什么 → `03`。
想讨论自我迭代的可行性 → `04`。

## 证据约定

文中标注：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档或他人复现；**推断** = 尚未验证。

**推断与实测分开标注**，是这批文档的基本要求——写作过程中出现过三次把推断当观测的错误，都在文档里改掉了。
