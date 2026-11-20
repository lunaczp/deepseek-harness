# 会话压缩：压力、溢出与摘要替换

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机压缩会话对照） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@6534bf5766` |
| 证据 | 源码；权威见 [`packages/compaction/README.zh.md`](../packages/compaction/README.zh.md)、[`compaction-basic/README.zh.md`](../packages/compaction/compaction-basic/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**长会话快顶满上下文时，把较早 surface 历史收成一条摘要 user 消息（`replace`），近期尾巴原样保留；旧事件仍在日志；是否压缩由 `tokenMeter.measure` 定价，执行在 `compaction-basic`。**（源码）

关联：[16b 日志示意](./16b-compaction-example.md)；[15](./15-token-meter.md)（`measure` 主消费者）；[12](./12-session-implementation.md)（surface replace）；[13](./13-llm-implementation.md)。

---

## 1. 包地图

| 包 | 角色 |
|---|---|
| [`dsh-compaction`](../packages/compaction/compaction/README.zh.md) | 约定：`ctx.compaction` 三操作 + 事件/锁；自己不压 |
| [`dsh-compaction-basic`](../packages/compaction/compaction-basic/README.zh.md) | 默认后端：压力 / 溢出 / 切模型 / 摘要 |
| [`dsh-compaction-tool-result-pruner`](../packages/compaction/compaction-tool-result-pruner/README.zh.md) | 可选：先砍超大工具结果（无模型调用） |
| [`dsh-compaction-image-offload`](../packages/compaction/compaction-image-offload/README.zh.md) | `IMAGE_OFFLOAD_REQUIRED` → `image/offload` 再重试 |
| [`dsh-command-compact`](../packages/compaction/command-compact/README.zh.md) | `/compact` → `compactNow` |

三操作（[`compaction/src/index.ts`](../packages/compaction/compaction/src/index.ts)）：

- `compactIfNeeded(agent, 'pressure' \| 'context-overflow', signal)`
- `compactNow(agent, …)` — 手动，可低于阈值
- `compactRegion(start, end, …)` — 显式区间

---

## 2. 何时触发（basic，`auto: true`）

[`compaction-basic/src/index.ts`](../packages/compaction/compaction-basic/src/index.ts) `_registerAutomaticCompaction` 约 L147+：

| # | 钩子 | 行为 |
|---|---|---|
| ① | `agent/pre-step` | `compactIfNeeded(..., 'pressure')`；失败只 warn，继续本轮 |
| ② | `agent/request`（prepend，切模型） | 用拟用新模型的 header 量压力；压不到阈值 → `MODEL_SWITCH_COMPACTION_FAILED` |
| ③ | `agent/request-error` 且 `CONTEXT_WINDOW_EXCEEDED` | `compactIfNeeded(..., 'context-overflow')`；surface 前进才授权重试 |
| ④ | `/compact` | `compactNow`（不要求已超阈值） |

默认阈值大致：`floor(min(W×0.8, W−O−headroom))`，近期保留约 `(W−O)×16%`（配置表见 basic README）。

---

## 3. 压缩是否走大模型？

**不完全是。写摘要那一步走大模型；前面可以不调模型就结束。**（源码）

| 阶段 | 是否调 LLM |
|---|---|
| 压力判断（`tokenMeter.measure`） | 否 |
| 工具结果 prune（可选 pruner） | 否；剪完已低于阈值 → **整次可到此结束** |
| 写 `<compacted-summary>`（`summarizeWithLlm` → `ctx.llm.stream`，`purpose: 'compaction'`） | **是**（另一次请求，不走 loop 的 `agent/request`） |
| 图片 offload | 否（改日志标记后重试原请求） |

常见路径：量压力 →（可选 prune）→ **再开一次模型写摘要** → `replace`。只有 prune 就够用时，可以完全不调摘要模型。

---

## 4. 一次成功压缩的日志形状

**Surface 只变一次**；`compaction/*` 全是 log-only：

```text
compaction/start          # 锁（仅日志）
  … purpose:compaction 的摘要 LLM 调用 …
compaction/summary        # 原始摘要（仅日志）
user/message + surfaceOp: replace[start..end]
  # 唯一表面变更：摘要检查点替换所选较早节点
compaction/end            # 放锁（仅日志）
```

之后 `deriveMessages()` = 摘要 user + 保留的近期节点；被遮事件仍在日志。

锁：较新 `session/end-seed` **之后**的未匹配 `compaction/start` = busy；更早 = 上进程残留，不挡。

---

## 5. Prune：效果举例

挂 `dsh-compaction-tool-result-pruner` 时，**只在压缩触发已满足后**跑；不碰未超压的对话。默认：文本 > **8192** 码点才剪 → 留前 **4096** + 标记 + 后 **1024**。

```text
# 模型原来看到的某条超长 tool/result
[前半很多行…] …中间几千行… [后半很多行…]

# prune 之后
[前 4096 字符]
\n\n[... tool result middle pruned ...]\n\n
[后 1024 字符]
```

- 短结果（≤8192）不动；图片等非 text 块原样保留
- 扫当前 surface 上所有超标 `tool/result`；原文仍在日志（`compaction/prune` + replace）
- 剪完若已低于阈值 → **跳过摘要**

配置与实现：[`compaction-tool-result-pruner`](../packages/compaction/compaction-tool-result-pruner/README.zh.md)；`pruneContent` / `pruneSession` 见其 `src/index.ts`。

---

## 6. 选段与摘要：哪些消息进摘要？最近的会不会选？

**最近尾巴不进「被压区间」——按 token 预算原样保留；更老的那段才送给摘要模型。**（源码）

### 6.1 选区示意

```text
[0] system          ← 永不进压缩区（节点 0 的 system/message）
[1]…[4] 较早历史   ← shadowed：送给摘要模型，随后被 replace
-------------------- retain 切点
[5]…[7] 近期尾巴   ← verbatim 保留，不进摘要 call 的被压区间
```

压完表面：`system` + 一条 `<compacted-summary>` 检查点 + 近期尾巴。

摘要请求：`system`（若有）+ **被 shadow 的消息** + 末尾压缩指令；retain 尾巴不在这次 `messages` 里（[`region.ts` `buildSummarizationInput`](../packages/compaction/compaction-basic/src/region.ts)）。

溢出恢复（`context-overflow`）会用更狠的保留（常 `retainTokens: 0`），尽量压最大可平衡 head，但仍须工具对平衡。

### 6.2 「最近几条」怎么定义？——不是条数

**`retainTokens` = 从最新往回、至少原样留这么多 token 的预算**（不是「只留最新一条」、也不是固定 N 条）。

预算怎么定（[`config.ts`](../packages/compaction/compaction-basic/src/config.ts)）：

```text
messageBudget = W − O                    # 上下文窗口 − 预留输出
retainTokens  = floor(messageBudget × 0.16)   # 默认 retainRatio
              或配置里写死的 retainTokens
```

例：`W=128k`，`O=8k` → `messageBudget≈120k` → **retain ≈ 19200 tokens**。

怎么换成「几条」（[`selectCompactableRange`](../packages/compaction/compaction-basic/src/region.ts) L117–155）：

1. 从 surface **末尾往前**累加各节点 route-priced `tokens`
2. 直到 `accumulated >= retainTokens` → 这段整段 verbatim
3. 再为不拆 tool-call/result 对，切点可能再往前挪 → 实际留下常 **≥ retainTokens**
4. 更老的 `[firstIdx … keepFromIdx-1]` 才进摘要

因此：近期都是短消息 → 条数可能很多；最近一条超长 tool 输出 → 可能只保住 1～2 条（再加配对修正）。

### 6.3 摘要步骤本身

1. **`measure`** 标价 → 上面选段
2. 可选 **pruner**；已低于阈值则跳过摘要
3. **`summarize`**：`ctx.llm.stream`，`purpose: 'compaction'`；只要返回**文本**
4. 摘要必须比被遮内容短；框在 `<compacted-summary>`；前有固定 checkpoint 说明

不可拆：未配对完的 tool_call/result；单节点不可分超大单元；**节点 0 系统提示**永不被遮。

---

## 7. 与计量 / 图片

| | |
|---|---|
| 要不要压 | `ctx.tokenMeter.measure`（常带当前/目标 header） |
| 释放估算 | 节点 `tokens` / `heuristicTokens` |
| 图片预算 | 适配器 `IMAGE_OFFLOAD_REQUIRED` → **image-offload**，不是 basic 摘要 |

`measure` **不是**账单；见 [15](./15-token-meter.md)。

---

## 8. KV / 体验要点

- 检查点是 **replace**，从替换点起打断 KV 复用；之前前缀仍可能复用。
- 压不了：系统提示（node 0）、工具 schema、单个不可拆单元。

---

## 跳转锚点

| 步骤 | 文件 | 行号附近 |
|---|---|---|
| 自动 listener | [`compaction-basic/.../index.ts`](../packages/compaction/compaction-basic/src/index.ts) | L147–L230 |
| `compactIfNeeded` / `compactPressure` | 同上 | L292+、L316+ |
| `compactNow` | 同上 | L407+ |
| `retainTokens` 解析 | [`config.ts`](../packages/compaction/compaction-basic/src/config.ts) | `messageBudget` / `retainRatio` 0.16 |
| 选段（从尾累加） | [`region.ts`](../packages/compaction/compaction-basic/src/region.ts) | `selectCompactableRange` L117–155 |
| 区域事务 / 摘要输入 | 同上 | `prepareCompaction` / `buildSummarizationInput` |
| 摘要 | [`summarizer.ts`](../packages/compaction/compaction-basic/src/summarizer.ts) | `summarizeWithLlm` |
| prune | [`tool-result-pruner/.../index.ts`](../packages/compaction/compaction-tool-result-pruner/src/index.ts) | `pruneContent` / `pruneSession` |
| `/compact` | [`command-compact/.../index.ts`](../packages/compaction/command-compact/src/index.ts) | `compactNow` 调用 |
| 约定 API | [`compaction/src/index.ts`](../packages/compaction/compaction/src/index.ts) | 抽象引擎 |

## 还没搞懂

1. **手动 `compactNow` 与运行中 turn** 的接纳预留 / flush 时序。
2. **`compaction/summary-error` waterfall** 与 image-offload 在同一锁内的重试边界。
3. **本机**：一次真实压力压缩的 jsonl 事件序（待实测，对照 [16b](./16b-compaction-example.md)）。

## 读代码最短路径

1. [compaction 组](../packages/compaction/README.zh.md) → [basic README.zh](../packages/compaction/compaction-basic/README.zh.md)
2. `_registerAutomaticCompaction` → `compactPressure` → `region.ts`
3. [15](./15-token-meter.md) + [16b](./16b-compaction-example.md)
