# Token 计量：`ctx.tokenMeter`

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机 measure 实测） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@bd6ad5a621` |
| 证据 | 源码；权威见 [`packages/llm/token-meter/README.zh.md`](../packages/llm/token-meter/README.zh.md)、[`docs/subsystems/token-meter.zh.md`](../docs/subsystems/token-meter.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**回放 Session 日志估「当前请求/上下文有多挤」：不调模型、不做 loop 决策、不是账单；压缩读 `measure()`，UI 读压力投影。**（源码）

关联：[15b 数字示例](./15b-token-meter-example.md)（接 [14b](./14b-prompt-assembly-example.md) Hello）；[14](./14-prompt-assembly.md)；[13](./13-llm-implementation.md)（图片/文件投影与计量共用）。

---

## 1. 在整条链里站哪

```text
Session 日志（真源）
  → token-meter 回放 / sessionProjections fold
  → measure() / contextPressure / contextBreakdown / tokenUsage
       ↑
  compaction-basic（压不压、压哪）
  UI 占用条（pressure ÷ contextWindow）
  遥测
```

组合：无配置。`inject: ['sessionProjections']`；`llm` **可选**（有则解析路由图片定价与文件句柄文本）。

```yaml
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-compaction-basic'   # 消费方示例
```

---

## 2. 对外 API

| API | 作用 |
|---|---|
| **`measure(session, requestHeader?)`** | 当前压力快照：`totalTokens`、`surfaceTokens`、逐 surface 节点 |
| **`estimateMessage(message)`** | 单条消息固定启发式（无会话状态） |
| **`contextPressure(session)`** | 同步读最近 `pressureTokens` + `contextWindow`（展示） |

`measure` 逻辑（[`index.ts` L151–L196](../packages/llm/token-meter/src/index.ts#L151)）：

```text
若有匹配的成功调用锚点（规范 envelope 相同）：
  baseline = provider usage（≥ 完整路由估锚点）或 estimated 锚点
  surfaceDelta = 当前表面价 − 锚点表面价（可负）
  totalTokens = max(0, baseline + surfaceDelta)
否则：
  totalTokens ≈ estimateToolsTokens(header) + 当前表面路由价
  surfaceDelta = 0
```

可选 `requestHeader` 覆盖计价用的 envelope；**节点集合仍是当前 session surface**。每次克隆节点 → O(surface)。

---

## 3. 两套尺子

### 固定启发式（默认文本）

[`estimate.ts`](../packages/llm/token-meter/src/estimate.ts)：

| 常量 | 值 |
|---|---|
| `CHARS_PER_TOKEN` | 4 |
| `BLOCK_OVERHEAD` | 4 |
| `ROLE_OVERHEAD` | 4 |

- text / reasoning：`ceil(chars/4) + 4`
- tool-call：name + arguments 密度 + 块开销
- system：整段当字符串 `ceil(chars/4) + ROLE`（**无**逐块开销）
- tools schema：算在 header（`estimateToolsTokens`），**不**进 surface 节点

故意低估 CJK / JSON schema；全库统一以保证 compaction / UI / 回放一致。

### 路由感知（适配器声明时）

- 图片：`ctx.llm.imageRequestPricing(provider, model)` → 视觉 token + 模型可见文本；offload → 占位文本
- 文件：`ctx.llm.fileRequestText(ref)` → 与 LLM 分发相同的句柄行

每个节点：`tokens`（本路由请求压力价）+ `heuristicTokens`（固定启发式 / 影子价）。

---

## 4. 四个投影

[`Service.init` L103–L108](../packages/llm/token-meter/src/index.ts#L103)：

| Key | 含义 |
|---|---|
| **`tokenUsage`** | 日志累计 uncached input / output / cache；同 attempt 流式用量被最终 assistant 样本替换；`llm/retry-started` 结束替换范围 |
| **`contextPressure`** | `pressureTokens`（最近提供方 **prompt** 规模）、`projectedTokens`、`contextWindow`——**非**原子同一次观测 |
| **`contextBreakdown`** | 启发式 `systemTokens` + `toolsTokens` + `messageTokens`；构成近似，≠ 计费 / `projectedTokens` |
| **`tokenMeasurement`**（Host-only） | 固定大小恢复：header 引用、step、最近成功 usage；不存消息数组 |

`contextBreakdown`：surface 上**最后一个非空存活** `system/message` → `systemTokens`；其余可见节点 → `messageTokens`；tools 跟最新 `request/header`。

---

## 5. 与提示词 / LLM 的交界

| 事实 | 计量 |
|---|---|
| system 在 surface | 进 `measure` 节点价 |
| runtime-context user | 普通 user 节点 |
| header.tools | `estimateToolsTokens` |
| File / Image 引用 | 与分发相同的投影文本 / 视觉价 |
| compaction replace | 影子价协议；部分 system 改写对 `projectedTokens` 可能先 0 delta |

本包**不写**提示词、**不调**模型。

---

## 6. 读数字时的坑

1. 占用参考 ≠ 账单；压缩用 `measure()`，UI 用 pressure / window。
2. `contextBreakdown` 总和不要当成 `totalTokens`。
3. 换模型时 pressure 与新 window 可能短暂错配。
4. 无精确提供方分词器。

---

## 源码地图 / 跳转锚点

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](../packages/llm/token-meter/src/index.ts) | `TokenMeter`：`measure` / `estimateMessage` / `contextPressure` |
| [`src/estimate.ts`](../packages/llm/token-meter/src/estimate.ts) | 四字符启发式 |
| [`src/surface-fold.ts`](../packages/llm/token-meter/src/surface-fold.ts) | surface fold |
| [`src/measurement-projection.ts`](../packages/llm/token-meter/src/measurement-projection.ts) | Host 恢复 |
| [`src/usage-projection.ts`](../packages/llm/token-meter/src/usage-projection.ts) | tokenUsage + contextPressure |
| [`src/breakdown-projection.ts`](../packages/llm/token-meter/src/breakdown-projection.ts) | contextBreakdown |
| [`src/route-pricing.ts`](../packages/llm/token-meter/src/route-pricing.ts) | 路由图片定价 |
| [`src/turn-usage.ts`](../packages/llm/token-meter/src/turn-usage.ts) | 整 turn 用量 fold |

## 还没搞懂

1. **影子价 claim** 与 compaction replace 的精确配对条件（`surface-projection`）。
2. **锚点 `assistantTokens`**：从内嵌流重组计价与监听器改写内容如何隔离。
3. **本机**：对真实 session 调 `measure()`，对照 [15b](./15b-token-meter-example.md) 启发式推算（待实测）。

## 读代码最短路径

1. [README.zh](../packages/llm/token-meter/README.zh.md) → [token-meter.zh.md](../docs/subsystems/token-meter.zh.md)
2. `estimate.ts` → `index.ts` `measure`
3. compaction-basic 如何读 `measure().totalTokens`
4. [15b](./15b-token-meter-example.md) 用 Hello 表面心算
