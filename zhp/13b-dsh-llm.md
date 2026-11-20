# `@deepseek-ai/dsh-llm`：中立服务深读

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机流式实测） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@b128504bfa` |
| 证据 | 源码；权威见 [`packages/llm/llm/README.zh.md`](../packages/llm/llm/README.zh.md)、[`docs/subsystems/llm-streaming.md`](../docs/subsystems/llm-streaming.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**`dsh-llm` 是唯一合法的模型入口：自己不定 DeepSeek/OpenAI 的 HTTP，也不重试、不计量；只定词汇、管路由、保边界——适配器翻 wire，loop/Session 都说同一种方言。**（源码）

关联：[13 LLM 组总览](./13-llm-implementation.md)（包地图与双路由）；[02](./02-request-lifecycle.md)⑤⑥；[12](./12-session-implementation.md)（assistant 结算）。本篇只深读核心包，适配器细节仍以 13 为准。

---

## 1. 在整条链里站哪

```text
agent-loop 组装请求
    ↓
ctx.llm.prepareCall / stream     ← 本包
    ↓  llm/stream waterfall
    ↓  文件 / 图片 / 工具投影
adapter.stream(...)              ← llm-deepseek* / llm-pi-ai
    ↓
StreamChunk… → finish
    ↓
loop：BlockAssembler / AssistantStreamAccumulator → Session
```

服务本身**零配置**；至少再挂一个适配器。选路由靠 `GenerateOptions.provider`（如 `deepseek-official`）。

挂载示例（源码 / README）：

```yaml
- name: '@deepseek-ai/dsh-llm'
- name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
```

---

## 2. 设计核心：逻辑约定 vs wire

| 本包拥有 | 适配器拥有 |
|---|---|
| `Message` / `ContentBlock` / `StreamChunk` | HTTP、SSE、SDK |
| 适配器注册表与可配置目录 | 凭据解析、端点拼接 |
| `prepareCall`、校验、默认值物化 | `stream()` 翻成自家格式 |
| 分发前 file/image/tool 投影 | Files API、thinking 字段 |
| 失败归一成终端 `finish` | 抛 `LlmError` 或原生错误 |

loop、Session、UI、compaction、标题生成器因此共用一套词汇，不会并存两套「提供方消息类型」。

---

## 3. 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](../packages/llm/llm/src/index.ts) | `LlmRuntime` + 抽象 `LlmAdapter`：注册、发现、准备、流边界 |
| [`src/types.ts`](../packages/llm/llm/src/types.ts) | 块 / chunk / usage / 模型元数据 / `GenerateOptions` |
| [`src/message.ts`](../packages/llm/llm/src/message.ts) | 不可变消息、`MessageSource`（含 `form`） |
| [`src/assembler.ts`](../packages/llm/llm/src/assembler.ts) | `BlockAssembler`：chunk → block |
| [`src/assistant-stream.ts`](../packages/llm/llm/src/assistant-stream.ts) | 紧凑带时间戳 assistant 流，供 Session 嵌入 |
| [`src/call-config.ts`](../packages/llm/llm/src/call-config.ts) | `LlmCallConfig`、`ConfigureCall`、loop 请求标记 |
| [`src/content.ts`](../packages/llm/llm/src/content.ts) | 文件句柄、纯文本图占位、工具更新、offload |
| [`src/retry-policy.ts`](../packages/llm/llm/src/retry-policy.ts) | **解析**策略（执行在 `llm-retry`） |
| [`src/error.ts`](../packages/llm/llm/src/error.ts) / [`adapter-failure.ts`](../packages/llm/llm/src/adapter-failure.ts) | `LlmError` 与终端 finish 归一化 |
| [`src/api-key.ts`](../packages/llm/llm/src/api-key.ts) | 各适配器共用的密钥格式检查 |

---

## 4. 共享词汇

权威：[`types.ts`](../packages/llm/llm/src/types.ts)、[llm-streaming](../docs/subsystems/llm-streaming.md)。

### ContentBlock

可扩展 map：`text` · `reasoning` · `image` · `file` · `tool-call` · `tool-addition` · `tool-removal`。

- 工具**结果**是 `ToolResultMessage`，不是内容块。
- 日志里 `image`/`file` 是**附件引用**；发给提供方前由本包投影（§7）。
- `tool-call.arguments` 保持**原始 JSON 字符串**，本层不 parse。

### Message

不可变：`id` / `role` / `source` / `content`。助手 `source` 含 `provider` + `model`，可选适配器私有 `replayState`。

- `source.kind`：谁写的（user / model / tool / system-prompt / …）。
- 可选 `form`：`instructions` · `catalog` · `snapshot` · `notice` · `relay` · `recall`——**语义**，不是 UI 样式。

请求侧还可混 `RequestUserInput`（有 user 内容，无 `id`/`source`）。要进 Session / Agent 投递仍须完整 `Message`；会记录完整请求的调用方（如标题生成）必须用持久消息。

### StreamChunk（闭集）

```text
block-start
  text-delta | reasoning-delta | tool-call-delta
block-end
…
usage
finish          # 之后禁止再有 chunk
```

`finish.reason`：`stop` · `tool-calls` · `max-tokens` · `error` · `aborted`。业务失败与取消都走 `finish`，不靠「迭代器抛错」表达——与插件/消费方错误硬分割。

### GenerateOptions

大致：`provider` · `model` · `messages` · 可选 `tools` / `toolHistory` · `reasoningEffort` · `temperature` · `maxTokens` · `stop` · `signal` · 可选 `purpose` · 本地品牌 `sessionId`（避免依赖 `dsh-session` 造成循环）。

采样故意很瘦：只有 temperature / maxTokens / stop；无 `tool_choice` / `top_p`（无生产方不开词汇）。

`purpose`：辅助请求通过扩展 `LlmRequestPurposeMap` 声明；适配器当模型不可见的传输元数据携带，不熟悉的 purpose 不拒绝。

---

## 5. `LlmRuntime`：三张表 + 流边界

### 注册表

1. **adapters**：`provider id → { adapter, info, retryPolicy }`
2. **directory**：可配置提供方（含休眠路由、`settingsNs`、`defaultBaseURL`、`nativeAuth`）——给 Models 页；不必已 `registerAdapter`
3. **discoveries**：按 `settingsNs` 做「草稿端点探测」——配置未存也能问对方有什么模型

均经 `ctx.effect`：fiber 卸载即 dispose。`replace` 先整批校验再原子提交；失败则旧状态继续服务。提交后发**无载荷**的 `llm/adapters-updated`；监听器失败**不能否决**注册（源码：逐个 contain）。

重复路由 → `DUPLICATE_ADAPTER`；空初始注册非法，`replace([])` 合法（休眠但登记仍在）。

### 抽象 `LlmAdapter`

唯一强制：`stream(options)`。默认：

- `listModels` → `[]`（GUI 选不到）
- `resolveModel` → 仅 id/name
- `prepareCall` → resolve + 绑定 `stream`
- `imageRequestPricing` / `providerRetryPolicy` → 无

动态适配器 override `prepareCall`，把「这一代端点/能力」与「真正 dispatch」钉死，防止 HMR 中途换配置。

### `stream` 路径

```text
ctx.llm.stream(options)
  → waterfall('llm/stream', options, next)
  → adapterStream
       解析/校验 call config + model info
       投影 file / image / tools
       剥异适配器 replayState
       dispatch → yield chunks
       适配器抛错 → finish{error|aborted}
```

瀑布监听器须 `next()`，或自己产 chunk 短路（测试 / replay）。loop 请求经 `markAgentLoopRequest` 且 deep-freeze；监听器只读不改。

---

## 6. `prepareCall` vs 直接 `stream`

```ts
const prepared = await ctx.llm.prepareCall(
  { provider, model, reasoningEffort?, maxTokens?, … },
  signal,
  configure?,  // 纯函数；在默认值物化之前改 controls
)
// 写 request/header 后：
for await (const c of prepared.stream(fullGenerateOptions)) { … }
```

准备阶段（源码）：

1. 当前注册表取适配器 → `adapter.prepareCall` → 这一代 `model` + `dispatch`
2. 可选 `configure(controls, modelInfo)`（后写覆盖先写；不能改 route）
3. 对照精确模型校验 effort；缺省填适配器默认 maxTokens / effort
4. 冻结 config；记下 `adapterDefaults`（哪些字段是适配器填的——loop 下次清掉再解析）
5. 返回的 `stream`：**只能调一次**；call-config 必须 `callConfigEquals`，否则 `INVALID_PREPARED_CALL`

| | `prepareCall` | 直接 `stream` |
|---|---|---|
| 谁用 | agent-loop 正式一步 | 标题生成、单测、无循环 |
| 绑定 | 捕获当前一代适配器 | 分发时再解析 |
| 重试 | 可经 `llm-retry` | **单次尝试** |

`ConfigureCall` 示例见 [README.zh](../packages/llm/llm/README.zh.md#use-this-package)（最低 effort + 显式 maxTokens）。

---

## 7. 分发前投影

改的是**发给适配器的请求副本**，不是 Session 日志（源码：`adapterStream`）。

| 投影 | 规则 |
|---|---|
| **File** | 任何路由都不收文件字节 → 句柄文本（名、大小、只读路径）；`fileRequestText(ref)` 与计量同结果 |
| **Image（无 image 模态）** | 稳定占位（含 tool 结果里的图） |
| **Image（有模态）** | 适配器做成 Files id / base64；超预算 → `IMAGE_OFFLOAD_REQUIRED`（compaction 记 `image/offload` 再试） |
| **offloaded: true** | 所有路由占位文本 |
| **Tool updates** | `in-history` 保留增删；`addition-only` 只加；无能力则只发当前 tools，无 developer 变更消息 |
| **replayState** | 仅当历史与目标 `provider` **同一适配器实例**拥有时保留 |

文件每次请求现扫内容（含 tool-role），不缓存「消息是否冻过」——避免漏扫。

`resolveImageAttachmentAccess()`：把附件宿主路径映射进当前工具执行世界；**不**参与 `variantId`，不改请求图本身。

---

## 8. 失败边界

| 来源 | 表现 |
|---|---|
| 无适配器、校验失败、适配器 / 迭代器 throw | 流内一个 `finish` + `LlmFailure` |
| `signal` abort 或 code `ABORTED` | `finish.reason.kind === 'aborted'` |
| `llm/stream` 监听器抛错、消费方 `for await` 里抛错 | **仍抛出**，不伪装成模型失败 |

按稳定 `code` 分支，不解析 `message` 文案。常见：`NO_ADAPTER` · `MISSING_CREDENTIAL` · `INVALID_CREDENTIAL` · `AUTH` · `RATE_LIMIT` · `QUOTA` · `ACCOUNT_QUOTA` · `CONTEXT_WINDOW_EXCEEDED` · `IMAGE_OFFLOAD_REQUIRED` · `UNSUPPORTED_REASONING_EFFORT` · `INVALID_PREPARED_CALL` · `DUPLICATE_ADAPTER`。

`providerRetryAfterMs` 只是提供方建议延迟，**不是**「已决定重试」。本包注册时**存下** `retryPolicy`，但 `stream` 从不按策略再跑——执行在 [`llm-retry`](../packages/llm/llm-retry/README.zh.md)（见 [13 §6](./13-llm-implementation.md)）。

---

## 9. 模型发现的三层（勿混）

| API | 含义 |
|---|---|
| `listModels(provider)` | 适配器**现在愿意展示**的目录；GUI 选型要求在这里 |
| `resolveModel` / prepare 内 resolve | **某个精确 id** 的能力（窗口、effort、模态、`systemPromptUpdate`）；未进目录也可能能调 |
| `discoverModels(settingsNs, draft)` | 对**尚未保存**的草稿端点问模型列表；不读写已存配置 |

目录变了发 `llm/models-updated(provider)`。角标（`badge`）只给选择器：不进 `resolveModelInfo`、不进请求、不进 Session。

`systemPromptUpdate: 'in-history'`：模型把消息列表**任意位置**最新 system 当生效提示 → loop 可追加而不改写 leading system。字段缺省 = 只认 leading。其它值 → `INVALID_MODEL_INFO`。

`toolUpdate`：`addition-only` | `in-history`；缺省 = 每次请求声明完整当前工具集（细节与限制见包 README「已知限制」）。

---

## 10. 明确不在本包

| 能力 | 归属 |
|---|---|
| 重试执行 | `dsh-llm-retry` |
| DeepSeek / 多厂 wire | `llm-deepseek*` / `llm-pi-ai` |
| Token 压力 | `token-meter`（回调 `fileRequestText` / `imageRequestPricing`） |
| 系统提示组装、工具执行 | agent-loop / tools |
| Session 落盘 | session 包（本包只提供消息与紧凑流类型） |

---

## 11. 与 Session / loop 的契约

**Model-visible ⟺ logged**：进 `GenerateOptions`、最终被模型看见的，必须能从 session 日志重建。loop 请求冻结；投影只在适配器边界，日志仍保留结构化 `FileBlock`/`ImageBlock`。

Assistant：loop 用 `AssistantStreamAccumulator` 压流，写入 `assistant/message` 或 `assistant/attempt`（[12](./12-session-implementation.md)）。读历史可用 `assistantStreamHasVisibleText` 等不展开扫描；`expandAssistantStream` 留给持久边界校验（约十倍内存，不 memoize）。

`TokenUsage`：`inputTokens` 是**未缓存**输入；cache read/write 另计；适配器若拿到含 cache 的总 prompt 须扣回。

---

## 12. 重要不变量（本包）

1. 进模型输入可从日志重建；loop 请求 deep-freeze
2. 一次 `stream` = 一次提供方尝试
3. 每流恰好一个终端 `finish`；`usage` 在其前；其后无 chunk
4. `prepareCall` 结果一次性；跨代能力与端点不得混用
5. File 永不进适配器字节面；Image 投影跟捕获路由走
6. `replayState` 仅同适配器实例传递
7. 工具参数保持原始 JSON 字符串
8. 注册变更原子；`llm/adapters-updated` 不可否决提交

---

## 还没搞懂

1. **`agent/request` waterfall 与 prepared config**：哪些控制项能在 waterfall 改、改完如何仍满足 `callConfigEquals`？
2. **`ConfigureCall` 与 `agent/request` 的分工**：生产代码里谁在用 `configure` 第三参？
3. **`projectToolUpdates` 重建基线**：addition-only 下「向空集添加 / 移除任一工具」触发重建的精确条件与 KV-cache 影响。
4. **Remote / Typert**：`listProviders` / `discoverModels` 等 `@Remote` 在 GUI Host–Client 间的实际调用路径。
5. **本机对照**：一次真实流，对照 prepare → header → chunks → finish 与 Session 嵌入的紧凑流（待实测）。

（与 [13 还没搞懂](./13-llm-implementation.md#还没搞懂) 互补：13 偏组级与 DeepSeek 路由；本篇偏核心服务边界。）

## 跳转锚点（流程关键行）

按一次正式 step 的时间顺序（基线 `zhp@b128504bfa` 附近；行号会随主干漂移，以符号名为准）：

| 步骤 | 文件 | 行号附近 |
|---|---|---|
| `agent/request` waterfall | [`agent-loop/.../agent.ts`](../packages/core/agent-loop/src/agent.ts) | L630–L644 |
| `prepareCall` | [`llm/.../index.ts`](../packages/llm/llm/src/index.ts) | L960–L1017 |
| 写 `request/header` / `request/context`、冻请求 | 同上 `agent.ts` | L655–L743（`buildRequest`） |
| `preparedCall.stream` / 消费 chunk | `agent.ts` | L490–L497、L541–L563 |
| `llm/stream` waterfall 入口 | `llm/.../index.ts` | L1170–L1183 |
| 投影 + dispatch | `llm/.../index.ts` | L1068–L1122（`adapterStream`） |
| 适配器失败 → 终端 finish | `llm/.../index.ts` | L1188–L1195 |
| 词汇 `StreamChunk` / `GenerateOptions` | [`types.ts`](../packages/llm/llm/src/types.ts) | L496–L508、L564+ |
| 投影实现 | [`content.ts`](../packages/llm/llm/src/content.ts) | `projectFilesToText` L186+；`projectImagesForTextModel` L361+；`projectToolUpdates` L439+ |
| 失败重试 | [`llm-retry/.../index.ts`](../packages/llm/llm-retry/src/index.ts) | L184–L187、L240–L248 |

## 读代码最短路径

1. [`packages/llm/llm/README.zh.md`](../packages/llm/llm/README.zh.md)
2. [`docs/subsystems/llm-streaming.md`](../docs/subsystems/llm-streaming.md)（或 `.zh.md`）
3. `types.ts` + `message.ts` → `index.ts`（`LlmAdapter` / `prepareCall` / `adapterStream`）
4. `content.ts` + `call-config.ts`
5. `assembler.ts` / `assistant-stream.ts`
6. `agent-loop/.../agent.ts` 中的 `prepareCall` + `stream` 调用点
7. 再回到 [13](./13-llm-implementation.md) 看具体适配器
