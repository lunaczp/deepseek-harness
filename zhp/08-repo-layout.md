# 仓库地图：目录怎么分，又怎么拼成一个系统

| | |
|---|---|
| 状态 | 学习中（结构已走查） |
| 日期 | 2026-11-06 |
| 基线 | `zhp@8296e5e58f` |
| 证据 | 目录遍历 + 源码 + 官方分组表 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

仓库里只有三类东西：**包（能力单元）→ bundle（组合清单）→ profile（运行时选择）**。目录按"能力组"归类，但运行时**不按目录加载**，而是按 `cordis.patch.yml` 里一行行插件声明挂载。

## 1. 顶层目录

| 目录 | 是什么 | 规模 |
|---|---|---|
| [`apps/`](../apps/) | 可启动的应用 | 5 个：cli、web、desktop、desktop-host、plugin-market-generator |
| [`packages/`](../packages/) | 全部能力包 | 371 个 `package.json`，40+ 组 |
| [`vendor/`](../vendor/) | 固定版本的 Cordis 生态源码 | 10 个：cordis、loader、hmr、include、group、timer、schemastery、cosmokit… |
| [`native/`](../native/) | Node 原生插件（`system.node`） | `native/system` |
| [`python/`](../python/) | Python SDK 与 runtime | `sdk`、`sdk-runtime` |
| [`docs/`](../docs/) | 文档源（架构、子系统、指南） | 含 `module-graph.md` 依赖图 |
| [`website/`](../website/) | VitePress 文档站，从 `docs/` 投影 | 独立 workspace |
| [`scripts/`](../scripts/) | 门禁、生成器、构建脚本 | 367 个文件 |
| [`snapshots/`](../snapshots/) | 录制的会话回放用例 | 按 surface 分目录 |
| [`benchmarks/`](../benchmarks/) | 性能基准与门禁 | — |
| [`.agents/`](../.agents/) | Agent 工作流：notes、skills | — |
| [`.github/`](../.github/) | CI、评审归属、issue 策略 | — |
| `zhp/` | 我们的学习笔记（本分支独有） | — |

## 2. `packages/` 的分组（按角色归并）

官方分组表在 [`packages/README.md`](../packages/README.md)。

**脊柱**
- [`core/`](../packages/core/)：session、agent-loop、tools、system-prompt、tool-executor
- [`api/`](../packages/api/)：远程 BFF 与 Typert RPC 网关
- [`typert/`](../packages/typert/)：类型图生成与运行时注册
- [`session/`](../packages/session/)：持久化、投影、标题、统计
- [`context/`](../packages/context/)：AGENTS.md、时间上下文、引用
- [`boot/`](../packages/boot/)：app-boot、Loader 粘合、cmdline、HMR、plugin-manager
- [`bundle/`](../packages/bundle/)：可安装的 profile 补丁层

**能力组（典型接缝：Definition / Provider / Consumer）**
- [`llm/`](../packages/llm/)、[`shell/`](../packages/shell/)、[`subprocess/`](../packages/subprocess/)、[`fs/`](../packages/fs/)
- [`sandbox/`](../packages/sandbox/)、[`ssh/`](../packages/ssh/)、[`terminal/`](../packages/terminal/)
- [`subagent/`](../packages/subagent/)、[`team/`](../packages/team/)、[`jobs/`](../packages/jobs/)、[`workflow/`](../packages/workflow/)
- [`web/`](../packages/web/)、[`skill/`](../packages/skill/)、[`lsp/`](../packages/lsp/)、[`mcp/`](../packages/mcp/)
- [`compaction/`](../packages/compaction/)、[`plan/`](../packages/plan/)、[`goal/`](../packages/goal/)、[`todo/`](../packages/todo/)、[`schedule/`](../packages/schedule/)

**界面与集成**
- [`host/`](../packages/host/)：Node 侧 Web 服务、静态资源、目录选择
- [`client/`](../packages/client/)：浏览器侧 70 个包（ui-*、slots、wire）
- [`sdk/`](../packages/sdk/)、[`acp/`](../packages/acp/)：进程外接入

**状态与用户面**
- [`credentials/`](../packages/credentials/)、[`settings/`](../packages/settings/)、[`storage/`](../packages/storage/)、[`workspace/`](../packages/workspace/)、[`attachment/`](../packages/attachment/)、[`spill/`](../packages/spill/)

**支撑**
- [`test-support/`](../packages/test-support/)、[`util/`](../packages/util/)、[`experimental/`](../packages/experimental/)（62 个）

## 3. 三层组合

```
包（packages/*/*）            exported plugin / service
      ↓ 被 cordis.patch.yml 引用
bundle（packages/bundle/*）   base / web-app / desktop / headless / sdk-app
      ↓ profile 的 dsh.profile.bundles
profile（~/.dsh/profiles/web） bundle 列表 + 用户 cordis.patch.yml
```

一个包在运行时要出现，必须**某一行 patch 引用了它的包名**。目录存在不等于被加载。

## 4. 两个平面：源码 vs 产物

| 平面 | 位置 | 谁用 |
|---|---|---|
| 源码 | `packages/*/*/src`，通过 `tsconfig.base.json` 的 `paths` 解析 | tsc、测试、门禁 |
| 产物 | `packages/*/*/lib`，`main: lib/index.js` | 运行时（`dsh` 命令） |

源码启动用 tsx 直接跑 `src`；构建后运行时按 `package.json` 的 `main` 加载 `lib`。两者不能混用（[`docs/development.md`](../docs/development.md) 有布局说明）。

## 5. 一个请求穿过哪些目录

```
浏览器 client/ui-chat
  → api/gateway（WebSocket）
    → core/agent-loop（turn / step）
      → context/agent-instructions（AGENTS.md）
      → core/system-prompt（拼提示词）
      → llm/llm-deepseek（流式请求）
      → tool-*（fs / bash / ...）
        → sandbox（权限）
      → session（日志落盘）
  → host/webserver 推回浏览器
```

## 6. 三种"使用"

1. **运行**：`apps/cli` 选 profile → bundle → 插件树。
2. **开发**：改 `packages/*/*/src`，按 project references 编译；测试走 `pnpm run test`。
3. **扩展**：新建包 → 写 README 与 `apply` → 在 bundle 里加一行 → 在 profile 里启用。

## 还没搞懂

1. `typert` 到底解决什么问题（类型图为什么要运行时注册）。
2. `api/` 的 BFF 与 Typert 网关如何分工。
3. `client/` 70 个包的槽位（Slot）体系如何组织页面。
4. `experimental/` 的 62 个包里，哪些其实已被产品使用。
