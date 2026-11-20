# 压缩示例：压力触发时的日志与模型视图

| | |
|---|---|
| 状态 | 学习中（教学示意；非本机一次真实压缩录制） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@6534bf5766` |
| 证据 | 源码约定（事件序 / replace / 检查点文案）；数字与 seq 为示意 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> 本篇 seq / token 数为**示意**，结构来自源码；真值待解压会话日志核对。

## 一句话

**`pre-step` 发现压力超阈值 →（可选）prune → 锁内摘要 → 一条带 `<compacted-summary>` 的 user 消息 `replace` 掉较早节点 → 下一请求只看见摘要 + 近期尾巴。**（源码）

关联：[16](./16-compaction.md)；[15](./15-token-meter.md)；[12](./12-session-implementation.md)。

---

## 设定（示意）

压缩前 surface（位置序，**不是** seq 序）：

| 位置 | 类型 | 内容（示意） |
|---|---|---|
| 0 | system | 当前 harness 提示词（**永不被遮**） |
| 1…K | user / assistant / tool | 较早多轮对话（将被 replace） |
| K+1…N | … | 近期尾巴（`retainTokens` 内，保留） |

`measure().totalTokens` ≥ 路由阈值；`auto: true`；已挂 pruner（可选）。

---

## ① `agent/pre-step`：压力检查

[`index.ts` L157–L174](../packages/compaction/compaction-basic/src/index.ts#L157)：

```text
compactIfNeeded(agent, 'pressure', signal)
  → measure(session, 最新 header)
  → totalTokens >= threshold ?
```

未超阈值 → 什么都不写，`next()` 继续本步。

---

## ② 可选 prune（仍无摘要；不调模型）

若挂了 `toolResultPruner` 且已超阈值：

```text
pruneSession(session)     # 改写超大 tool/result 内容
measure(...) 再量一次
若已 < threshold → 跳过摘要，本轮压缩结束
```

效果举例（默认阈值 8192 / head 4096 / tail 1024）：

```text
# 某条 bash 输出约 2 万字 → 模型之后只看到
[前 4096 字符]
\n\n[... tool result middle pruned ...]\n\n
[后 1024 字符]
```

短结果不动；原文仍在日志（`compaction/prune` + 新 `tool/result` replace）。**整次压缩可以只 prune、不调摘要模型。**

---

## ③ 选范围（retain = token 预算，不是「最近 N 条」）

从**第一个非 system（非节点 0）**起选将被遮区间；尾巴按 `retainTokens` 从末尾往前累加：

```text
retainTokens ≈ floor((W−O)×0.16)   # 或配置绝对 retainTokens
从 surface 末尾往前累加 node.tokens，直到 ≥ retainTokens
再调整切点使工具对平衡 → 实际留下常 ≥ retainTokens

shadowedSeqs = [s_a, …, s_z]   # 较早段：进摘要请求，随后 replace
retain 尾巴不动                 # 不进摘要 call 的被压区间
```

示意：

```text
[0] system                        不进压缩区
[1]…[K] 较早多轮                  shadowed → 摘要模型
---------- retain 切点 ----------
[K+1]…[N] 近期（凑够 retainTokens） 原样保留
```

- 近期都短 → 可能留很多条；最近一条超长 → 可能只留 1～2 条
- **「几」= 约等于「最新往回至少保留的原文大小（token）」**，不是固定条数

配对：不能切开未完成的 tool_call / tool_result（[`tool-pairing`](../packages/compaction/compaction/src/tool-pairing.ts)）。详情见 [16 §6](./16-compaction.md)。

---

## ④ 事务：锁 → 摘要 → 替换 → 放锁

```text
append compaction/start          # log-only，获取锁

summarizeWithLlm(...):           # 另一次 ctx.llm.stream
  messages ≈
    [ system(节点0) ,
      ...被遮区间消息... ,
      user(压缩指令) ]
  purpose: 'compaction'
  tools: 来自最新 request/header（供投影）
  → 只要助手 text；推理/工具调用丢弃

append compaction/summary        # log-only，存原始摘要文本

append user/message
  surfaceOp: { op: 'replace', startSeq, endSeq }
  content: 检查点前导 + <compacted-summary>…</compacted-summary>
  source: compactCheckpointSource（可识别压缩检查点）

append compaction/end            # log-only，释放锁
```

检查点用户可见前导（产品文案，basic README「模型体验」）：

```markdown
This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.

<compacted-summary>
…模型写的摘要…
</compacted-summary>
```

---

## ⑤ 压缩后模型下一请求看到什么

`deriveMessages()` 示意：

```text
[
  { role: system,  text: <节点0 当前提示词> },
  { role: user,    text: <检查点 + compacted-summary> },  # 替换了 1…K
  … 近期尾巴 K+1…N 原样 …
  { role: user,    text: <本步新接纳的用户话 / runtime-context> }
]
```

日志里 1…K 的原始事件**仍在**，只是 surface 看不见 → 回放可重建同一视图。

---

## ⑥ 溢出恢复（对照）

若提供方返回 `CONTEXT_WINDOW_EXCEEDED`（[`L213–L228`](../packages/compaction/compaction-basic/src/index.ts#L213)）：

```text
agent/request-error
  → compactIfNeeded(..., 'context-overflow')
  → 尽量压最大平衡头部（绕过常规阈值/保留偏好）
  → 仅当 replaceGeneration 前进 → 返回 retry，同一步重跑
```

与 `llm-retry` 不同：这是 **compaction 驱动的 step 重试**，不是 `llm/retry` 事件。

---

## ⑦ 切模型（对照）

```text
agent/request 选出新 provider/model
  → 用「旧历史 + 新模型容量」measure
  → 必须压到新阈值以下再继续
  → 失败：MODEL_SWITCH_COMPACTION_FAILED，保留旧 header
```

---

## 对照表

| 步骤 | 日志 / 表面 |
|---|---|
| ① 未超阈值 | 无写入 |
| ② prune | 可能有 prune 相关事件；无 compaction 锁 |
| ④ 摘要成功 | start → summary → **一条 replace user** → end |
| ⑤ 下一请求 | 摘要 + 尾巴；旧节点仅日志 |
| 图片预算 | `image/offload`（另一插件），不是本篇事务 |

## 还没搞懂

1. 真实会话里 `shadowedTokenCount` 与 `measure` 前后 `totalTokens` 的落差（待实测）。
2. 摘要请求是否复用主路由 KV 前缀的边界条件（basic README 称尽量复用热前缀）。

## 读代码最短路径

1. [16](./16-compaction.md)
2. `_registerAutomaticCompaction` → `region.ts` 事务
3. `summarizer.ts` 请求形状
4. （可选）本机 jsonl 搜 `compaction/start`
