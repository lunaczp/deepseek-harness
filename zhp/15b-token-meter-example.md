# Token 计量示例：接 14b 的 Hello 表面

| | |
|---|---|
| 状态 | 学习中（启发式手算；非本机 `measure()` 实测） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@bd6ad5a621` |
| 证据 | 源码公式（[`estimate.ts`](../packages/llm/token-meter/src/estimate.ts)）；表面文案来自 [14b](./14b-prompt-assembly-example.md)；字符计数为本机脚本对同一字符串的推算 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> 本篇数字标为 **推算**（用源码启发式对 14b 字符串计数），不是会话日志或 `ctx.tokenMeter.measure` 的实测输出。

## 一句话

**首轮三条 surface（system + runtime-context user + Hello）在「无提供方 usage 锚点」时，`totalTokens ≈ tools 启发式 + 三节点启发式之和`；system 用「整段字符/4 + 4」，普通 user 用「字符/4 + 块开销 4 + 角色 4」。**（源码公式 + 推算）

关联：[15](./15-token-meter.md)；[14b](./14b-prompt-assembly-example.md)。

---

## 设定（与 14b 相同表面）

假设请求前 surface 已写入：

1. `system/message` — `renderPrompt` 全文（14b ②）
2. `user/message`（runtime-context）— cwd 快照（14b ① 末尾）
3. `user/message` — `Hello`

尚无成功 `assistant/message` → **无 usage 锚点** → `baseline.kind === 'estimated'`，`surfaceDeltaTokens === 0`（[`measure` L180–L185](../packages/llm/token-meter/src/index.ts#L180)）。

公式常量（源码）：`CHARS_PER_TOKEN = 4`，`BLOCK_OVERHEAD = 4`，`ROLE_OVERHEAD = 4`。

---

## 逐步计价（推算）

### A. system 节点 — `estimateSystemMessage`

整段当字符串，**无**逐块 `BLOCK_OVERHEAD`（[`estimate.ts` L73–L80](../packages/llm/token-meter/src/estimate.ts#L73)）：

```text
text length = 347
tokens = ceil(347 / 4) + 4 = 87 + 4 = 91
```

### B. runtime-context user — `estimateMessage`

单 text 块（[`L88–L90`](../packages/llm/token-meter/src/estimate.ts#L88) → `estimateContent` + ROLE）：

```text
text length = 158
tokens = ceil(158 / 4) + 4 + 4 = 40 + 4 + 4 = 48
```

### C. Hello user

```text
text length = 5
tokens = ceil(5 / 4) + 4 + 4 = 2 + 4 + 4 = 10
```

### D. 表面合计

```text
surfaceTokens（启发式、无图）≈ 91 + 48 + 10 = 149
```

无图片定价时，节点的 `tokens` 与 `heuristicTokens` 同为上值（路由未声明视觉价）。

### E. tools（header，不在 surface 节点里）

`estimateToolsTokens` = `ceil(JSON.stringify(tools).length / 4) + 4`（[`L99–L101`](../packages/llm/token-meter/src/estimate.ts#L99)）。

真实 bash/read schema 很大；下面用**迷你假 schema**只演示量级（推算）：

```text
tools JSON length ≈ 146  →  ceil(146/4) + 4 = 41
```

产品全量 tools 往往数百～数千启发式 token，会主导 `totalTokens`。

### F. 无锚点时的 `measure` 形状（示意）

```text
baseline: { kind: 'estimated', tokens: 41 + 149 }   # 迷你 tools 时
surfaceDeltaTokens: 0
totalTokens: 190
surfaceTokens: 149
nodes: [
  { seq: …, tokens: 91, heuristicTokens: 91 },  # system
  { seq: …, tokens: 48, heuristicTokens: 48 },  # runtime-context
  { seq: …, tokens: 10, heuristicTokens: 10 },  # Hello
]
```

（`seq` / 真 tools 价需实测。）

---

## 成功调用之后（概念）

模型返回并写入 `assistant/message` + usage 后：

- 若下一请求 **envelope 未变**：可 `baseline.kind === 'usage'`，表面相对锚点的增减进 `surfaceDeltaTokens`
- 仅追加 runtime 快照 / 用户话：delta > 0
- compaction 遮掉旧节点：delta 可为负
- **换 tools / model / 采样**：信封不匹配 → 退回整包 estimated

`contextBreakdown`（启发式构成，推算）：

```text
systemTokens  ≈ 91      # 唯一非空 system
messageTokens ≈ 48 + 10 # runtime + Hello（含被取代的旧 system 若有）
toolsTokens   ≈ estimateToolsTokens(最新 header)
```

三者之和对齐 `nodes[].heuristicTokens` 规则见 [15](./15-token-meter.md)；**不等于** `projectedTokens`。

---

## 对照表

| 步骤 | 数字从哪来 |
|---|---|
| 14b 字符串 | 组装结果 |
| A–C | `estimate.ts` 对字符串计数（本篇推算） |
| E | 同公式；假 schema 仅示意 |
| F | `measure` 无锚点分支（源码） |
| 真值 | 待对 `ctx.tokenMeter.measure(session)` 实测 |

## 还没搞懂

1. 真实 web 首轮 tools JSON 长度与 `toolsTokens` 量级。
2. 第一条 assistant usage 落地后，`pressureTokens` 与 `measure().baseline` 是否立刻对齐。

## 读代码最短路径

1. [14b](./14b-prompt-assembly-example.md) 拿字符串
2. [`estimate.ts`](../packages/llm/token-meter/src/estimate.ts) 手算
3. [`measure`](../packages/llm/token-meter/src/index.ts) 无锚点 / 有锚点分支
4. （可选）本机对真实 session 调 `measure` 核对
