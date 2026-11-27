# DSH vs Claude Code：Harness 对照调查

| | |
|---|---|
| 状态 | 学习中（本地双仓走读） |
| 日期 | 2026-11-27 |
| 基线 | DSH `zhp@461227e3e5`；Claude Code 本地 `/Users/lux/Github/lunaczp/claude-code` |
| 证据 | 源码；DSH 对照 `docs/architecture.md` 与 [zhp/](../zhp/)；Claude Code 对照该仓 `docs/architecture.md`、`src/query.ts`、`src/QueryEngine.ts`、`src/tools.ts` |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> Claude Code 树为 **leaked source**（该仓 README）；本篇只做机制对照。
> DSH 索引 [zhp/README](../zhp/README.md)；运行时用语 [52](../zhp/52-runtime.md)；与 Codex 对照 [zhp-codex](../zhp-codex/dsh-vs-codex.md)。Canvas：`dsh-vs-claude-code-harness`。

## 一句话

**两者都是 TypeScript 本机 coding agent；DSH 是 Cordis 拼树的可组合 harness，Claude Code 是 Bun + React/Ink 的产品单体（工具／权限／bridge 编进同一棵 `src/`）。**（源码）

---

## 1. 产品面

| | DeepSeek Harness | Claude Code |
|---|---|---|
| 主入口 | `dsh --profile`（web／headless／sdk／acp…） | `claude` CLI（Commander → Ink REPL） |
| GUI | Host/Client 双面 Web + Electron Desktop | **终端 React/Ink**；IDE 经 **bridge**；仓内另有 `web/` 伴侣 |
| SDK | TS JSON-RPC；Python + sdk-runtime | Agent SDK（`src/entrypoints/sdk/`） |
| 还可当 | ACP／headless 任务面 | MCP **server** 模式（`entrypoints/mcp.ts`） |
| 规模粗测 | ~380 workspace 包 | ~3000 `src` TS/TSX 文件（单树） |

DSH：[49](../zhp/49-deliverables-and-release.md)。Claude Code：`src/main.tsx`、`src/entrypoints/`、`src/bridge/`、`docs/architecture.md`。

---

## 2. 实现与组合

| | DSH | Claude Code |
|---|---|---|
| 语言／运行时 | Node ≥24、pnpm、全 ESM | **Bun**、单包 `package.json`、Biome |
| 组合 | 包 → bundle → profile；空根 + Cordis 补丁 | **单体 `src/`**：tools／commands／services 同进程模块 |
| 裁剪 | profile／patch 选挂插件 | `feature(...)` 编译期 DCE（BRIDGE／VOICE…） |
| 「运行时」 | 产品进程 + Plugin.Runtime／seam（[52](../zhp/52-runtime.md)） | 口语≈整棵 CLI + Query Engine |

---

## 3. 主循环与状态

| | DSH | Claude Code |
|---|---|---|
| 循环 | `agent-loop`：turn／step（[02](../zhp/02-request-lifecycle.md)） | `query`／`queryLoop`（`src/query.ts`）+ `QueryEngine.ts` |
| 形状 | 扩展点优先；少改 loop | `while`：stream → `tool_use` → `runTools` → 续写 |
| UI 态 | Host 权威；Client 投影（[44](../zhp/44-host-client-dual-face.md)） | 可变 `AppState` + React／Ink contexts |
| 权威日志 | Session 事件；model-visible ⟺ logged（[12](../zhp/12-session-implementation.md)） | `~/.claude/projects/…` append transcript（`sessionStorage.ts`） |
| 压缩 | `compaction` 包 + surface replace（[16](../zhp/16-compaction.md)） | `services/compact/`、context-collapse |

---

## 4. 工具、沙箱、权限、模型

| | DSH | Claude Code |
|---|---|---|
| 工具 | `ctx.tools` + Native／PTC + pipeline（[17e](../zhp/17e-tool-pipeline.md)） | `src/tools.ts` 注册表；~40 内置（Bash／File／Agent／MCP…） |
| 沙箱 | `ctx.sandbox` **seam**（可换 Provider） | sandboxTypes + `sandbox-adapter`；Bash 可选套 |
| 权限 | approval／permission-presets（[30](../zhp/30-approval.md)、[31](../zhp/31-permission-presets.md)） | `toolPermission`：default／plan／bypass／auto；规则如 `Bash(git *)` |
| MCP | `packages/mcp` → tools | 客户端 `services/mcp/`；亦可自曝为 MCP server |
| 模型 | 多适配器 `ctx.llm`（[13](../zhp/13-llm-implementation.md)） | **Anthropic 中心**；Bedrock／Vertex／Foundry 仍跑 Claude 系 |

---

## 5. 扩展哲学

**DSH：** `ctx.effect`／`ctx.on`（[51](../zhp/51-cordis-effect.md)）；seam = Definition + Provider + Consumer（[19](../zhp/19-seam-and-service.md)）；`dsh plugin`／preset。

**Claude Code：** lifecycle **hooks**（PreToolUse 等，`utils/hooks/` + SDK types）；**plugins**／marketplace；**skills**；斜杠 **commands**；MCP；feature flags。DSH 仓内另有 `hooks-codex`／Claude hooks 实验桥（见 [30](../zhp/30-approval.md) §6），属适配层而非 Claude Code 本体。

---

## 6. 与 Codex 三角速览

| | DSH | Claude Code | Codex（[zhp-codex](../zhp-codex/dsh-vs-codex.md)） |
|---|---|---|---|
| 语言 | TS／Cordis 多包 | TS／Bun 单体 + Ink | Rust core + 薄 npm |
| 取向 | 可组合 harness | 产品 CLI＋IDE bridge | 产品 agent＋强沙箱 |
| 模型默认 | 多厂商适配 | Anthropic／Claude | OpenAI／ChatGPT |

---

## 7. 怎么选（推断＋产品取向）

| 更偏向 DSH | 更偏向 Claude Code |
|---|---|
| 自有 Web Host、多模型、换能力 Provider | 终端 Ink 体验 + Anthropic／Claude 账号路径 |
| 把 harness 当平台拼树 | 开箱工具／权限／bridge 一体 |
| 严格 session 投影与代际格式 | 单仓迭代快、feature-flag 裁剪面 |

**互学：** 从 Claude Code 看 Ink 循环与 permission 规则 DSL、IDE bridge；从 DSH 看 seam／双面 GUI／多模型路由。

---

## 还没搞懂

1. Claude Code transcript 字段与 DSH Session 事件词汇的逐项映射。
2. bridge 协议与 DSH Typert／Gateway 的职责对照。
3. Claude Code hooks 与 DSH `hooks-*` 实验包、waterfall／bail 的事件级对照表。
4. `code-mode`（Codex）／PTC（DSH）／Claude Code Agent／Team 工具的同构边界。
