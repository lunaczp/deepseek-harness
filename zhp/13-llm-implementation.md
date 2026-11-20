# LLM 实现：中立服务、适配器与一次调用

| | |
|---|---|
| 状态 | 学习中（源码梳理；无本机落盘 / 流式实测） |
| 日期 | 2026-11-20 |
| 基线 | `zhp@2dcdec0e2a` |
| 证据 | 源码；权威文档见 `packages/llm/README.md`、`docs/subsystems/llm-streaming.md` |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。

## 一句话

**所有模型调用都走 `ctx.llm`：服务层只认一套 Message / ContentBlock / StreamChunk；适配器负责 wire 翻译；`prepareCall` 绑定当前这一代适配器后一次性分发；重试在 agent 步骤边界，不在原始 `stream()` 上。**（源码）

关联：[13b `dsh-llm` 深读](./13b-dsh-llm.md)（核心包边界与投影）；[02 请求链路](./02-request-lifecycle.md)（九步里的⑤⑥）；[12 Session 实现](./12-session-implementation.md)（`request/header`、assistant 结算）；官方 [llm 组](../packages/llm/README.md)、[llm-streaming](../docs/subsystems/llm-streaming.md)。

## 1. 包地图

| 包 | 角色 | ctx |
|---|---|---|
| [`llm`](../packages/llm/llm/README.md) | 中立服务：注册、发现、准备、流式边界、投影 | `ctx.llm` |
| [`llm-deepseek`](../packages/llm/llm-deepseek/README.md) | DeepSeek Messages 传输库（不单独注册路由） | — |
| [`llm-deepseek-api-key`](../packages/llm/llm-deepseek-api-key/README.md) | 路由 `deepseek-official`，`x-api-key` | 注册到 `ctx.llm` |
| [`llm-deepseek-account`](../packages/llm/llm-deepseek-account/README.md) | 路由 `deepseek-account`，账号 token + 列表门控 | 注册到 `ctx.llm` |
| [`llm-pi-ai`](../packages/llm/llm-pi-ai/README.md) | 多提供方 / 手写网关（pi-ai） | 注册到 `ctx.llm` |
| [`deepseek-llm-api-extensions`](../packages/llm/deepseek-llm-api-extensions/README.md) | 官方请求顶层扩展字段（不进模型输入） | `ctx.deepseekLlmApiExtensions` |
| [`plugin-package-inventory-deepseek`](../packages/llm/plugin-package-inventory-deepseek/README.md) | 贡献 `dsh_plugin_packages` | 经 extensions |
| [`llm-retry`](../packages/llm/llm-retry/README.md) | 按提供方策略在失败步骤重试 | 听 `agent/request-error` |
| [`token-meter`](../packages/llm/token-meter/README.md) | 从日志估压力，不发模型调用 | `ctx.tokenMeter` |

组说明：[packages/llm/README.md](../packages/llm/README.md)。

## 2. 核心类型（共享词汇）

权威定义：[`packages/llm/llm/src/types.ts`](../packages/llm/llm/src/types.ts)、[llm-streaming](../docs/subsystems/llm-streaming.md)。

### ContentBlock / Message

可声明合并的块：`text` · `reasoning` · `image` · `file` · `tool-call` · `tool-addition` · `tool-removal`。

- 工具**结果**是独立的 `ToolResultMessage`，不是内容块。
- `Message` 不可变；助手消息带 `provider` / `model`，可选适配器私有 `replayState`。
- `GenerateOptions.messages` 可含持久 `Message` 与仅请求用的 `RequestUserInput`（无 `id` / `source`）；Session 写入仍要持久消息。

### StreamChunk（闭集）

```text
block-start → (text|reasoning|tool-call)-delta* → block-end
… usage → finish   # usage 在 finish 前；finish 后无后续
```

`finish` 三种结局：成功 / `{ kind: 'error', failure }` / `{ kind: 'aborted', failure }`。适配器抛错由 `LlmRuntime` 收成终端 finish；瀑布监听器与消费方自己的错误仍外抛。

### 组装与紧凑流

| 工具 | 作用 |
|---|---|
| `BlockAssembler` | 增量 chunk → ContentBlock |
| `AssistantStreamAccumulator` | 带时间戳压缩为 `AssistantStreamRecord[]`（保留 token 边界） |
| `expandAssistantStream` | 持久边界上的校验展开路径 |

紧凑流嵌在 `assistant/message`（有表面消息）或 `assistant/attempt`（无表面结果）里——见 [12](./12-session-implementation.md)。

## 3. 服务边界：`LlmAdapter` 与 `LlmRuntime`

源码：[`packages/llm/llm/src/index.ts`](../packages/llm/llm/src/index.ts)。

- **`LlmAdapter`**：唯一必实现的是 `stream()`；可选 `listModels` / `resolveModel` / `prepareCall` / 图像定价与目标尺寸 / `providerRetryPolicy`。
- **`registerAdapter(providers, adapter)`**：路由名全局唯一；重复 → `DUPLICATE_ADAPTER`。注册可 `replace` 整组路由，校验失败不改当前状态。
- **`llm/stream` waterfall**：监听器必须 `next()` 才到适配器；可短路产出自己的 chunk（测试 / replay 常用）。
- **GUI 选型**依赖 `listModels`；核心路由仍可接受未列出的 model id。

### `prepareCall` vs `stream`

| | `prepareCall(config)` | 直接 `stream(options)` |
|---|---|---|
| 谁用 | agent-loop（正式一步） | 标题生成、测试、无循环调用 |
| 绑定 | 捕获**当前一代**适配器 + 冻结配置 | 分发时再解析 |
| 次数 | 返回的 `stream` **只能调一次**；config 必须一致 | 每次独立 |
| 重试 | 失败可进 `llm-retry`（经 agent） | **单次尝试** |

`prepareCall` 还会物化适配器默认的 `reasoningEffort` / `maxTokens`，并带上 `systemPromptUpdate`、`toolUpdate`、`inputModalities` 等路由能力——循环用这些决定系统提示怎么进历史（详见 agent-loop README；与 [12 还没搞懂](./12-session-implementation.md#还没搞懂) 交叉）。

## 4. 一次 agent 调用（与 02 的⑤⑥对齐）

驱动：[`packages/core/agent-loop/src/agent.ts`](../packages/core/agent-loop/src/agent.ts)（约 `prepareCall` / `preparedCall?.stream`）。

```text
step/start
  → agent/request waterfall     # 可调控制项，不改本步模型选择
  → ctx.llm.prepareCall(...)    # 绑定适配器代次 + 校验
  → 系统提示 / user 批次提交    # 取消则两边都不 commit
  → request/header + request/context（按需）
  → 派生并冻结 GenerateOptions
  → preparedCall.stream(request)
       → llm/stream waterfall
       → 投影：file→句柄文本；纯文本路由 image→占位；toolUpdate 投影
       → adapter.stream(...)
  → chunk → live 推送 → assistant/message|attempt 结算
```

分发前投影（源码，`adapterStream`）：

1. **File**：任何路由都不收文件字节；换成只读路径句柄文本（`fileRequestText` / `projectFilesToText`）。
2. **Image**：无 `image` modality → 稳定占位；有能力则按路由版本（Files id 或 base64）。超预算 → `IMAGE_OFFLOAD_REQUIRED`（由 compaction-image-offload 记 `image/offload` 再试）。
3. **Tool updates**：按 `toolUpdate`（`in-history` / `addition-only`）决定 developer 块与 deferred 声明；缺 history 则退回当前声明。
4. **replayState**：仅当历史 provider 与目标 provider **同一适配器实例**拥有时保留，否则剥掉。

不变量：**Model-visible ⟺ logged**；loop 组装的请求 deep-freeze，瀑布/适配器只读不改。

## 5. DeepSeek 双路由 vs pi-ai

Twin adapters 说明：[Agent Note](../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md)。

### 共享传输 `llm-deepseek`

- 默认根：`https://api.deepseek.com/anthropic`；Messages `/v1/messages`，Files `/v1/files`。
- 思考：`off|low|high|max`（`thinking: disabled` 锁死为 `off`）。
- 图片：优先 Files 上传（缓存按端点+认证头哈希）；失败整请求退回内联 base64，**同一请求不混用**。
- `systemPromptUpdate: in-history`（默认 flash）→ 循环可追加系统快照；否则 leading system。

### 两条认证路由（互不回退）

| 路由 | 插件 | 头 | 目录 |
|---|---|---|---|
| `deepseek-official` | `llm-deepseek-api-key` | `x-api-key` | 官方端点 + 内置 `models` 时跟随 `GET /models`；约 10min 刷新，失败退内置 |
| `deepseek-account` | `llm-deepseek-account` | `x-dsh-auth-token` | 账号 `GET /models` + `min_version` 门控；不足 → `CLIENT_UPGRADE_REQUIRED` |

账号 401 分类与登录失效由 account 提供方处理；API key 畸形 → `INVALID_CREDENTIAL`，缺失 → `MISSING_CREDENTIAL`。

### `llm-pi-ai`

一份 `providers` 字典 = 多条路由（openai / anthropic / 手写 OpenAI-compat 网关等）。可与 DeepSeek 同挂；路由名冲突则加载失败。凭据经 `apiKeyEnv` 引用解析，密钥不进配置文件。

### 请求扩展（仅官方 DeepSeek）

`deepseekLlmApiExtensions`：序列化 base body 后并发 prepare 顶层字段，2xx 后再 `accept()`。产品侧：`dsh_session_log`、`dsh_plugin_packages`——**在 messages / tools 之外**，模型看不到。pi-ai 不读此表。

## 6. 重试与计量

### `llm-retry`

- 听 `agent/request-error`，**不**包装 `ctx.llm.stream()`。
- 策略在适配器 `retryPolicy`：默认 normal（`EMPTY_RESPONSE` / `RATE_LIMIT` / `SERVER` / `TIMEOUT` / `TRANSPORT`，最多 5 次）；`always` 无次数上限。
- 顺序：先 append `llm/retry`（含 delay）→ 等待 → `llm/retry-started` → 同一未关闭 turn 内重跑 step。
- 对模型不可见；取消 / 卸载中止 backoff。

### `token-meter`

- `measure(session)` 重放日志估 `totalTokens` / surface 节点；可选复用「信封完全一致」时的 provider usage。
- 图像：有 `imageRequestPricing` 用路由价，否则启发式；offload 后的图按占位文本计价。
- 文件：按与分发相同的句柄文本计价。
- 投影：`tokenUsage` / `contextPressure` / `contextBreakdown`（见包 README）。

## 7. 失败码（消费方按 code，不按文案）

常见：`NO_ADAPTER` · `MISSING_CREDENTIAL` · `INVALID_CREDENTIAL` · `AUTH` · `RATE_LIMIT` · `QUOTA` · `ACCOUNT_QUOTA` · `CONTEXT_WINDOW_EXCEEDED` · `IMAGE_OFFLOAD_REQUIRED` · `UNSUPPORTED_REASONING_EFFORT` · `CLIENT_UPGRADE_REQUIRED` · `INVALID_PREPARED_CALL` · `DUPLICATE_ADAPTER`。

`LlmFailure` 还可带 `status`、`providerRetryAfterMs`、`requestId`、`offloadImages`——重试策略读这些事实，不把 Retry-After 当成「已经决定要重试」。

## 8. 重要不变量（清单）

1. 进模型的输入必须能从 session 日志重建；loop 请求 deep-freeze
2. 一次 `stream` = 一次提供方尝试；重试是 agent 步骤边界的事
3. 每个流恰好一个终端 `finish`；`usage` 在其前
4. `prepareCall` 结果一次性；跨代适配器能力与端点不得混用
5. File 永不进适配器字节面；Image 投影跟捕获路由走
6. `replayState` 仅同适配器实例跨历史/目标路由传递
7. 工具参数保持原始 JSON 字符串
8. 注册变更原子：候选集整批校验，拒绝则旧状态继续服务

## 还没搞懂

1. **`agent/request` 与 `prepareCall` 的控制字段归属**：哪些能在 waterfall 里改、哪些必须进 prepared config 才合法？
2. **`systemPromptUpdate` admission**：准备结果 vs 上一条 `request/context` 谁说了算的边界用例（与 [12](./12-session-implementation.md) 交叉）。
3. **pi-ai OAuth / 跨进程 refresh lock**：登录流与密钥刷新在哪些进程边界生效？
4. **Files 上传缓存失效**：`stale-file` 与配额清理批次如何与重试交互？
5. **本机对照**：对一次真实 `deepseek-official` 流，对照 session 里 `request/header`、chunk 结算与 `llm/retry*`（待实测）。

## 读代码最短路径

1. [packages/llm/README.md](../packages/llm/README.md) → [llm/README.md](../packages/llm/llm/README.md)
2. [docs/subsystems/llm-streaming.md](../docs/subsystems/llm-streaming.md)
3. `llm/src/index.ts`（`LlmAdapter` / `prepareCall` / `adapterStream`）→ `types.ts` → `assembler.ts`
4. `agent-loop/.../agent.ts`（`prepareCall` + `stream`）
5. `llm-deepseek`（`adapter.ts` / `messages-api.ts` / `transport.ts`）+ `llm-deepseek-api-key` 或 `account`
6. `llm-retry/src/index.ts`；需要计量时再读 `token-meter`
