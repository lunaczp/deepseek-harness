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

## 3. 一次成功压缩的日志形状

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

## 4. 选段与摘要

1. **`measure`** 给 surface 节点标价；从第一个**非**节点 0 `system/message` 起选最旧且工具配对平衡的范围，尾部留 `retainTokens`。
2. 可选 **pruner**；若已低于阈值则**跳过摘要**。
3. **`summarize`**：直接 `ctx.llm.stream`（不走 loop 的 `agent/request`）
   - 回放节点 0 system + 被遮区间 + header 工具
   - 末尾压缩指令；`purpose: 'compaction'`
   - 只要返回**文本**进检查点
4. 摘要必须缩短源内容；框在 `<compacted-summary>`；前有固定 checkpoint 说明。

不可拆：未配对完的 tool_call/result（`toolPairingBalanced*`）；单节点不可分的超大单元；**节点 0 系统提示**永不被遮。

---

## 5. 与计量 / 图片

| | |
|---|---|
| 要不要压 | `ctx.tokenMeter.measure`（常带当前/目标 header） |
| 释放估算 | 节点 `tokens` / `heuristicTokens` |
| 图片预算 | 适配器 `IMAGE_OFFLOAD_REQUIRED` → **image-offload**，不是 basic 摘要 |

`measure` **不是**账单；见 [15](./15-token-meter.md)。

---

## 6. KV / 体验要点

- 检查点是 **replace**，从替换点起打断 KV 复用；之前前缀仍可能复用。
- 压不了：系统提示（node 0）、工具 schema、单个不可拆单元。

---

## 跳转锚点

| 步骤 | 文件 | 行号附近 |
|---|---|---|
| 自动 listener | [`compaction-basic/.../index.ts`](../packages/compaction/compaction-basic/src/index.ts) | L147–L230 |
| `compactIfNeeded` / `compactPressure` | 同上 | L292+、L316+ |
| `compactNow` | 同上 | L407+ |
| 区域事务 | [`region.ts`](../packages/compaction/compaction-basic/src/region.ts) | `prepareCompaction` / compact 事务 |
| 摘要 | [`summarizer.ts`](../packages/compaction/compaction-basic/src/summarizer.ts) | `summarizeWithLlm` |
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
