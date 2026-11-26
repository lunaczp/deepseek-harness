# Settings：插件 Config 表单与 profile 热改

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@f19f23eacb` |
| 证据 | 源码与文档；权威见 [`docs/subsystems/settings.zh.md`](../docs/subsystems/settings.zh.md)、[`packages/settings/settings/`](../packages/settings/settings/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Loader／启动 [10](./10-cordis-boot-loader.md)；非会话 KV 对照 [45](./45-storage.md)（settings **不是** storage）；凭据值对照 [48](./48-credentials.md)；Remote／Gateway [26](./26-typert.md)／[40](./40-api-gateway.md)。

## 一句话

**`ctx.settings` = 从活动 profile 条目的 Config schema 投影 volatile 表单；经 `configEditor` 写 Cordis patch；业务插件仍读自己的 Config。浏览器 Remote 读必脱敏。不是 storage-domain，也不存 workspace 类实体。**（源码）

---

## 1. 与 storage／workspace 的边界

| | settings | storage／workspace |
|---|---|---|
| 存什么 | profile 插件配置（yml patch） | 应用领域 KV |
| 介质 | Cordis profile + config-editor | storage-json／sqlite |
| 谁消费 | 设置页／Remote；插件读 Config | Host 产品包 |
| 热更新 | volatile → 不重挂插件 | domain 写后内存投影 |

组内一包 `dsh-settings`；wire 在旁包 [`api-settings-controller`](../packages/api/settings-controller/)（同挂 credentials Remote）。

---

## 2. 栈位置

```text
设置 UI (Client)
  → ctx.remote.settings.*          ← settings-controller
  → ctx.settings (SettingsForms)   ← 本包
  → ctx.configEditor.edit(...)     ← profile Cordis patch
  → Loader 应用 volatile
业务插件：Config.get()／volatile 引用
```

`inject = ['configEditor', 'profileContext']`（[`index.ts`](../packages/settings/settings/src/index.ts#L224)）。base 挂载 `id: settings`。

---

## 3. 核心概念

| 概念 | 含义 |
|---|---|
| `ns` | profile **条目 id**（如 `llm-deepseek`），不是包名 |
| volatile | schema `.volatile()`；普通 Config 不进表单 |
| descriptor | schema + value／base／user + revision + autoGenerate |
| revision | 乐观锁；过期 → `SettingsConflictError` |
| secret | `role('secret')`：wire 只给「是否有值」 |

投影（[`schema.ts`](../packages/settings/settings/src/schema.ts)）：`volatileForm`／`projectForm`／`plainConfig`。脱敏（[`redact.ts`](../packages/settings/settings/src/redact.ts)）。

---

## 4. API

| 方法 | 作用 |
|---|---|
| `describe({ redactSecrets? })` | 全部可表单条目 |
| `update` | 合并用户层 |
| `replace` | 先回继承再套提交字段 |
| `mutate` | 路径 set／unset——不必回传脱敏 secret |
| `configure({ auto }, fiber)` | 是否自动生成页（默认 true） |
| `prepareDocument()` | 原生编辑器用的 patch 路径 |

写路径（[`write`](../packages/settings/settings/src/index.ts#L378-L423)）：

```text
entry + volatileForm
  → configEditor.edit
  → 校验 revision／仅 volatile 路径／完整 Config
  → 合并回 raw（普通字段不动）
  → describe → emit settings/document-updated
```

---

## 5. 秘密、凭据、遗留

- Host 本地可不脱敏；**Remote 一律 `redactSecrets: true`**。
- 客户端优先 `mutate`，避免 `replace` 整段重建静默删掉从未下发的 secret。
- Credentials 是**另一 seam**；controller 只是同包挂两个 Remote。
- Loader 齐后一次性导入 `$DSH_HOME/settings.yaml` → `.imported`（[`importLegacyDocument`](../packages/settings/settings/src/index.ts#L241-L258)）。

限制：嵌套 Include 不能经当前 profile 表单改；重置只回继承值；Home／CLI overlay 更高优先时写入拒绝。

---

## 模型体验

无工具／提示词／session 事件；改到 LLM 等 Config 时间接影响请求。

---

## 还没搞懂

1. config-editor 文件锁／HMR 队列与 settings 写入的时序对照。
2. 某插件 `configure({ auto: false })` + 自建设置卡的完整竖切（cookbook）。
3. credentials 同页协作见 [48](./48-credentials.md)。

## 读代码最短路径

1. [settings.zh.md](../docs/subsystems/settings.zh.md)
2. [`index.ts`](../packages/settings/settings/src/index.ts) describe／write
3. [`schema.ts`](../packages/settings/settings/src/schema.ts) + [`redact.ts`](../packages/settings/settings/src/redact.ts)
4. [`settings-controller`](../packages/api/settings-controller/)；[`config-editor`](../packages/boot/config-editor/README.zh.md)
