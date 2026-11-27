# DSH vs OpenAI Codex：Harness 对照调查

| | |
|---|---|
| 状态 | 学习中（本地双仓走读） |
| 日期 | 2026-11-27 |
| 基线 | DSH `zhp@61e931c796`；Codex 本地 `/Users/lux/Github/openai/codex` |
| 证据 | 源码；DSH 对照 `docs/architecture.md` 与 [zhp/](../zhp/)；Codex 对照 `codex-rs/core`、`README.md`、`docs/` |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> DSH 笔记索引 [zhp/README](../zhp/README.md)；运行时用语 [52](../zhp/52-runtime.md)；架构 [01](../zhp/01-architecture.md)；交付 [49](../zhp/49-deliverables-and-release.md)；GUI 双面 [44](../zhp/44-host-client-dual-face.md)。交互版 Canvas：`dsh-vs-codex-harness`（Cursor 侧栏打开）。

## 一句话

**两者都是本机常驻 coding agent 运行时；DSH 把运行时建成可拆装的 Cordis 应用（插件 OS），Codex 把运行时建成 Rust 单体产品（core + hooks／插件叠加）。**（源码）

---

## 1. 产品面

| | DeepSeek Harness | OpenAI Codex |
|---|---|---|
| 主入口 | `dsh --profile`（web／headless／sdk／acp…） | `codex` 原生二进制（TUI／CLI） |
| GUI | Web Host+Client；Electron Desktop | Rust TUI；`codex app`；IDE 经 app-server |
| SDK | TS JSON-RPC；Python + sdk-runtime wheel | TS／Python（包装 CLI 或协议） |
| 云 | 无对等「Codex Web」产品轴（本仓） | ChatGPT Codex Web／cloud-tasks 等 |
| 规模粗测 | ~380 workspace 包 | ~117 `codex-rs` crates |

DSH：[49](../zhp/49-deliverables-and-release.md)、[07](../zhp/07-startup.md)。Codex：`/Users/lux/Github/openai/codex` 的 `README.md`、`codex-rs/cli`、`codex-rs/app-server`、`sdk/`。

---

## 2. 实现与组合

| | DSH | Codex |
|---|---|---|
| 语言 | Node ≥24、TS、全 ESM | **Rust** core；`codex-cli` 仅为薄 npm 启器 |
| 组合 | 包 → bundle → profile；空根 + 补丁树 | 编译进单一产品；扩展靠 hooks／package plugins／`ext` traits |
| 「运行时」 | 口语=产品进程；另有 Plugin.Runtime／seam（[52](../zhp/52-runtime.md)） | 口语≈ `codex-rs/core` + 各 UI 面 |

---

## 3. 主循环与状态

| | DSH | Codex |
|---|---|---|
| 循环 | `packages/core/agent-loop`：turn／step | `submission_loop` → `run_turn`（`core/src/session/`） |
| 协议感 | Cordis 事件 + Session 事件词汇 | `Op` / `EventMsg`（`codex-rs/protocol`） |
| 权威状态 | append-only Session 日志；model-visible ⟺ logged（[12](../zhp/12-session-implementation.md)） | Thread JSONL rollout + SQLite 元数据（`thread-store`） |
| 扩展循环 | **优先**挂扩展点，少改 loop（AGENTS） | 循环硬连在 core；旁路靠 hooks／contrib |

---

## 4. 工具、沙箱、模型

| | DSH | Codex |
|---|---|---|
| 工具 | `ctx.tools` + Native／PTC executor + pipeline（[17e](../zhp/17e-tool-pipeline.md)、[24](../zhp/24-ptc.md)） | 内置 shell 族、`apply_patch`、MCP handlers |
| 沙箱 | `ctx.sandbox` **seam**（可换 Provider） | **一等公民** OS 沙箱（Seatbelt／Landlock／bwrap／Win） |
| MCP | `packages/mcp` → 注册进 tools | session MCP + `codex-mcp` |
| 模型 | 多适配器 `ctx.llm`（DeepSeek／pi-ai…）（[13](../zhp/13-llm-implementation.md)） | OpenAI／ChatGPT 中心；Ollama／LM Studio 等次要 |

---

## 5. 扩展哲学

**DSH：** 注册 = `ctx.effect`／`ctx.on`（可逆，[51](../zhp/51-cordis-effect.md)）；能力 = seam（Definition + Provider + Consumer，[19](../zhp/19-seam-and-service.md)）；树外插件 `dsh plugin`。

**Codex：** lifecycle **hooks**（`PreToolUse` 等，`codex-rs/hooks`）；用户／admin **package plugins**（`codex-rs/plugin`）；Rust **extension-api** contributor traits（`codex-rs/ext`）；`AGENTS.md`／skills 作指令面。

---

## 6. 怎么选（推断＋产品取向）

| 更偏向 DSH | 更偏向 Codex |
|---|---|
| 自有 Web Host、多模型、换沙箱／fs Provider | 开箱 coding agent + ChatGPT／OpenAI 账号 |
| 把 harness 当平台拼能力 | 单二进制性能、强沙箱默认体验 |
| 深定制 agent 组合（preset／bundle） | IDE／TUI／云任务一体产品路径 |

**互学：** 从 Codex 看 turn 协议与沙箱产品化；从 DSH 看会话投影不变量与 seam／双面 GUI。

---

## 还没搞懂

1. Codex hooks 与 DSH waterfall／serial 的语义对照表（事件名级）。
2. 两边 resume／fork 对「未闭合 turn」策略的逐条差异（DSH「补账」[06](../zhp/06-session-and-resume.md) vs Codex rollout reconstruction）。
3. Codex `code-mode` 与 DSH PTC 是否同构（待对照源码）。
