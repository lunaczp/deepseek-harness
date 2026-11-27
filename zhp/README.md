# zhp/ 目录说明

本目录收录一轮人机问答后沉淀下来的结论与设计，全部基于对本仓库源码的实测与阅读。

| 文件 | 内容 | 一句话 |
|---|---|---|
| [AGENTS.md](./AGENTS.md) | 协作约定 | 学习目标、合作方式、进度锚点（新会话先读） |
| [1000-harness-mental-model.md](./1000-harness-mental-model.md) | **我的总结：骨／肉／人** | 整体设计心智（醒目号；Cordis 骨、插件肉、profile 人） |
| [00-conclusions.md](./00-conclusions.md) | 结论摘要 | 六条要点，带证据强度标注 |
| [01-architecture.md](./01-architecture.md) | 七层架构 | 从入口到状态层，纵轴是依赖方向 |
| [02-request-lifecycle.md](./02-request-lifecycle.md) | 请求链路 | 一次提问到回复的九步，及"没有一次性的我" |
| [03-sandbox-and-permissions.md](./03-sandbox-and-permissions.md) | 沙箱实测 | 读写边界、setuid、SBPL、三平台对比 |
| [04-self-evolving-agent.md](./04-self-evolving-agent.md) | 自改设计草案 | supervisor、事务式修改、评测外置 |
| [05-workspace-conventions.md](./05-workspace-conventions.md) | 工作区约定 | 链接语法、沙箱事实、引用纪律 |
| [06-session-and-resume.md](./06-session-and-resume.md) | 会话与恢复 | 补账而非续跑，turn 边界是安全重启点 |
| [07-startup.md](./07-startup.md) | 启动流程 | profile 物化、空根 + 补丁层、Loader 拼树 |
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
| [17e-tool-pipeline.md](./17e-tool-pipeline.md) | tool pipeline | 设计原因、调用处、批次与 `isConcurrencySafe` |
| [18-jobs.md](./18-jobs.md) | jobs | 后台任务约定 / local 实现 / tool-jobs 使用 |
| [19-seam-and-service.md](./19-seam-and-service.md) | seam ↔ service | 能力缝 vs `ctx` 服务；谁是谁不是 |
| [20-plugin-and-service.md](./20-plugin-and-service.md) | plugin ↔ service | apply vs class、哲学、场景 |
| [21-fs.md](./21-fs.md) | fs | `ctx.fs`、local/sandbox、tool-fs / 搜索 |
| [22-lsp.md](./22-lsp.md) | LSP | `ctx.lsp`、stdio server、只读导航工具 |
| [23-scope.md](./23-scope.md) | scope | ScopeKey、父链、按 agent 的贡献隔离 |
| [24-ptc.md](./24-ptc.md) | PTC | 运行时 seam、Native/PTC 执行器、提示词例子 |
| [25-web.md](./25-web.md) | web | `ctx.web`、search/fetch 提供方、`web_search`/`web_fetch` |
| [26-typert.md](./26-typert.md) | Typert | 类型图 / Remote / Zod / Host↔Client 打包与进程 |
| [27-skill.md](./27-skill.md) | skill | `ctx.skills`、多 Provider、filesystem 发现与首次 list |
| [28-workflow.md](./28-workflow.md) | workflow | 模型写 JS 编排、`workflowEngine`、PTC、真实调用例 |
| [29-subagent.md](./29-subagent.md) | subagent | 委派缝、`startActivation`、spawn/fork、控制工具 |
| [30-approval.md](./30-approval.md) | 审批 | `ctx.approval`、Host 闸门、pre-execute、Codex hook 例 |
| [31-permission-presets.md](./31-permission-presets.md) | 权限预设 | 多条捆绑表、写通旋钮、`danger-full-access` |
| [32-sandbox.md](./32-sandbox.md) | 进程沙箱 seam | policy/confine、升权、策略与机制分离 |
| [33-plan-mode.md](./33-plan-mode.md) | 计划模式 | `/plan`、提示词注入、`exit_plan_mode` 评审 |
| [34-user-questions.md](./34-user-questions.md) | 用户问答 seam | `ask`/`askTimed`、历史写入、120s timed |
| [35-commands.md](./35-commands.md) | 斜杠命令 | `ctx.commands`、`/plan` 等、command/run·done |
| [36-goal.md](./36-goal.md) | 同会话 Goal | 生命周期、driver 触发、与 plan 对照 |
| [37-schedule.md](./37-schedule.md) | 定时任务 | Host schedule、墙钟触发、MAX_TIMER |
| [38-webserver.md](./38-webserver.md) | Host webserver | exact→prefix→fallback、SPA 席位 |
| [39-hmr.md](./39-hmr.md) | Client HMR | 开发态 poll + SSE、整插件重载 |
| [40-api-gateway.md](./40-api-gateway.md) | API Gateway | Remote 分派、mux、HTTP Upgrade |
| [41-web-client.md](./41-web-client.md) | Web Client 组织 | 实体→Controller→client→ui；Workspace 竖切 |
| [41b-web-client-slots.md](./41b-web-client-slots.md) | Slot + React | 账本/inject、Outlet、`#root` 外壳 |
| [42-client-modules.md](./42-client-modules.md) | Client modules | 插件图、`/plugins`、惰性 CJS、chunk |
| [43-client-resources.md](./43-client-resources.md) | Client resources | `dsh-resource://`、useResource、file 例 |
| [44-host-client-dual-face.md](./44-host-client-dual-face.md) | Host/Client 双面 | 同库双树、Typert 边界、与 Java/Next 等对比 |
| [45-storage.md](./45-storage.md) | Storage / domain | 非会话 KV、hub／后端／domain、与 BFF 对照 |
| [46-workspace.md](./46-workspace.md) | Workspace 实体 | 注册表、两次写恢复、会话归属、非破坏删除 |
| [47-settings.md](./47-settings.md) | Settings 表单 | volatile Config、revision、脱敏、非 storage |
| [48-credentials.md](./48-credentials.md) | Credentials | Ref／Key、local 分层、按操作 resolve、授权 flow |
| [49-deliverables-and-release.md](./49-deliverables-and-release.md) | 交付与发布 | 产品交付、独立程序／模块、npm／Desktop 打包 |
| [50-cordis-events.md](./50-cordis-events.md) | Cordis 事件分发 | bail／serial 等同序停、同步 vs await；五种 mode |
| [51-cordis-effect.md](./51-cordis-effect.md) | Cordis `ctx.effect` | Fiber `_disposables`、逆序清理、与 on／plugin 同源 |
| [52-runtime.md](./52-runtime.md) | Runtime／运行时用语 | 产品进程 vs Plugin.Runtime vs seam vs prompt；跨框架对照 |
| `assets/` | 图与生成脚本 | 两张 PNG + SVG 源 + Python 生成器 |
| [../zhp-codex/](../zhp-codex/README.md) | 与 Codex 对照（独立目录） | 见 [dsh-vs-codex](../zhp-codex/dsh-vs-codex.md) |
| [../zhp-claude/](../zhp-claude/README.md) | 与 Claude Code 对照（独立目录） | 见 [dsh-vs-claude-code](../zhp-claude/dsh-vs-claude-code.md) |
| [../zhp-build/](../zhp-build/README.md) | 本机构建／打包（独立目录） | 见 [desktop-dmg-unsigned](../zhp-build/desktop-dmg-unsigned.md) |

## 阅读顺序建议

想用「骨／肉／人」抓住整体设计 → **`1000`**（再叠 `01`／`08`）。
想快速了解结论 → 读 `00`。
想知道 agent 怎么运转 → `01` + `02`。
想弄清「运行时」一词在本仓／他框架指什么 → `52`（先扫；细节链回各篇）。
想知道 CLI 一次提问怎么跑 → `09`（对照 `07` 的 web 启动）。
想弄清 Cordis / Loader 最小启动链 → `10`（再读 `07` 的 DSH 补丁栈）。
想弄清 Cordis 事件分发 / bail·serial / waterfall → `50`（Loader 对照 `10`；审批／LLM waterfall 对照 `30`／`13`）。
想弄清 `ctx.effect` 如何注册与最终清理 → `51`（Fiber 对照 `10`；事件对照 `50`）。
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
想弄清工具流水线设计、调用处与并行批次 → `17e`。
想弄清后台任务 jobs → `18`。
想弄清 seam 与 Service 的关系 → `19`；plugin 与 Service、两种形态 → `20`（可先扫 `10`）。
想弄清文件系统 `ctx.fs` / tool-fs → `21`（写边界实测仍看 `03`）。
想弄清可选 LSP 语义导航 → `22`。
想弄清 scope / 按 agent 注册 → `23`。
想弄清 PTC 运行时与 Native/PTC 提示词差异 → `24`（流水线深读看 `17e`）。
想弄清 web 搜索/抓取 seam → `25`（勿与 web-app GUI 混淆）。
想弄清 Typert / Remote / Client 打包与 Host 进程 → `26`（仓库地图开放问对照 `08`）。
想弄清 skill seam / 多 Provider / 首次发现 → `27`。
想弄清 workflow / 模型写 JS / PTC 与真实调用例 → `28`（PTC 基板对照 `24`）。
想弄清 subagent 委派 / spawn·fork / 控制工具 → `29`（workflow 扇出对照 `28`）。
想弄清用户审批 / Host 闸门 / pre-execute / hook 桥 → `30`（流水线对照 `17e`，沙箱实测对照 `03`）。
想弄清权限预设捆绑 / danger-full-access → `31`（审批对照 `30`）。
想弄清进程沙箱 seam / policy·confine / 策略与机制 → `32`（argv 拼装对照 `17c`，实测对照 `03`）。
想弄清计划模式 / `/plan` / `exit_plan_mode` → `33`（提示词对照 `14`，审批对照 `30`）。
想弄清用户问答 / `ask`·timed / 历史写入 → `34`（计划评审对照 `33`，工具结果对照 `17`）。
想弄清斜杠命令 / `ctx.commands` / command 生命周期 → `35`（`/plan` 对照 `33`，问答对照 `34`）。
想弄清同会话 Goal / 工具·`/goal`·续跑 → `36`（命令对照 `35`，计划对照 `33`）。
想弄清定时任务 / 墙钟触发 / setTimeout → `37`（Goal 对照 `36`）。
想弄清 Host HTTP 载体 / 路由匹配 / SPA fallback → `38`（启动对照 `07`，Typert 对照 `26`）。
想弄清 Client HMR / 开发热重载 / 与 Host dsh-hmr 区别 → `39`（webserver 对照 `38`）。
想弄清 API Gateway / Remote 分派 / `/api/remote.mux` / HTTP Upgrade → `40`（Typert 对照 `26`，webserver 对照 `38`）。
想弄清 Web Client 前后端分包 / Workspace 竖切 → `41`（Gateway 对照 `40`）；Slot / React / `#root` → `41b`。
想弄清 client-modules / 浏览器插件图 / combo 与 chunk → `42`（HMR 对照 `39`，竖切对照 `41`）。
想弄清 `dsh-resource://` / useResource / 文件预览 → `43`（Slot 对照 `41b`，modules 对照 `42`）。
想弄清 Host/Client 双面同库为何拆、与 Java/Next 等对比 → `44`（竖切对照 `41`，Typert 对照 `26`，Gateway 对照 `40`）。
想弄清非会话存储 / storage-domain / 与 session 日志边界 → `45`（Workspace 对照 `41`，session 对照 `12`，schedule 对照 `37`）。
想弄清 Workspace 注册表 / bootstrap / 两次写恢复 / 会话归属 → `46`（Web 竖切对照 `41`，落盘对照 `45`，session 对照 `12`）。
想弄清插件设置表单 / volatile / 脱敏 / 与 storage 边界 → `47`（Loader 对照 `10`，落盘对照 `45`，Remote 对照 `40`）。
想弄清凭据引用 / 本机存储 / 按操作 resolve / 授权 flow → `48`（settings 对照 `47`，LLM 对照 `13`／`13b`）。
想弄清整仓交付物 / 独立程序与模块 / 发布打包 → `49`（仓库地图对照 `08`，启动对照 `07`；本机 unsigned DMG 见 [zhp-build](../zhp-build/README.md)）。
想弄清 Cordis `emit`／`bail`／`serial`／`waterfall` → `50`（见上；Session 落盘事件仍看 `12`）。
想弄清 `ctx.effect`／Fiber dispose／逆序 cleanup → `51`（见上）。
想弄清「runtime／运行时」几种含义怎么区分 → `52`（架构对照 `01`，地图对照 `08`，交付对照 `49`）。
想对照 OpenAI Codex 与本仓 harness 取向 → [zhp-codex/](../zhp-codex/README.md)（运行时用语对照 `52`）。
想对照 Claude Code 与本仓 harness 取向 → [zhp-claude/](../zhp-claude/README.md)（与 Codex 三角见该篇 §6）。
想本机打未签名 Desktop DMG → [zhp-build/](../zhp-build/README.md)。
想知道它能碰什么、不能碰什么 → `03`。
想讨论自我迭代的可行性 → `04`。

## 证据约定

文中标注：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档或他人复现；**推断** = 尚未验证。

**推断与实测分开标注**，是这批文档的基本要求——写作过程中出现过三次把推断当观测的错误，都在文档里改掉了。
