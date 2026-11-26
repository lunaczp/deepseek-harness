# Credentials：引用式机密与本机存储

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@519565cc85` |
| 证据 | 源码与文档；权威见 [`docs/subsystems/credentials.zh.md`](../docs/subsystems/credentials.zh.md)、[`packages/credentials/`](../packages/credentials/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。设置表单对照 [47](./47-settings.md)；LLM 消费对照 [13](./13-llm-implementation.md)；Remote [40](./40-api-gateway.md)。

## 一句话

**配置只写凭据名字，值归 Provider；消费方每次操作 `resolve`，轮换立即作用于下一次请求。设置页／Remote 只见「是否配置／来源／可写」，永不回传明文。**（源码）

---

## 1. 组内包

| 包 | 角色 | ctx |
|---|---|---|
| `credentials` | Service Definition：两套键、抽象 API | `ctx.credentials` |
| `credentials-local` | 默认 Provider：YAML + 环境分层 | 实现上列 |
| `authorization` | 人引导拿凭据的 flow 注册表 | `ctx.authorization` |
| `deepseek-account*` | Platform 登录／token（相关独立） | `deepseekAccount` 等 |

浏览器：[`settings-controller`](../packages/api/settings-controller/) 的 `remote.credentials`（describe／set／unset，无值）。完整 seam：Definition + Provider + Consumer（LLM／设置页）。

base：`authorization` + `credentials-local`（[`cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)）。

---

## 2. 两套键空间

| | `CredentialRef` | `CredentialKey` |
|---|---|---|
| 形如 | `DEEPSEEK_API_KEY`（POSIX） | `llm-pi-ai/openai-codex`（`<owner>/<id>`） |
| 回答 | 这个环境变量名背后是什么 | 这个插件为这个 id 存了什么 |
| 分层 | 有（见下） | **无**；有记录=事实 |
| 空值 | 存储空串=不存在 | 空 `api-key` 仍可表示「确认 ambient」 |
| 写 | `set`／`unset` | 仅 `modifyRecord`（独占读改写） |
| 事件 | `credentials/reference-updated` | `credentials/record-updated` |

工厂：[`credentialRef`／`credentialKey`](../packages/credentials/credentials/src/index.ts#L29-L76)。抽象面：[`CredentialProvider`](../packages/credentials/credentials/src/index.ts#L171-L256)。

记录种类：`api-key`（可选 key／env）｜`grant`（owner 不透明 payload）。

---

## 3. local 解析优先级

```text
resolve(ref)
  → 文件存储（可写，最高）
  → 启动环境快照（DEEPSEEK_API_KEY=… dsh）
  → 项目 cwd/.env
  → $DSH_HOME/.env
```

**存盘优先于启动环境注入**；要用 `export KEY=… dsh` 须先 `unset` 文件值（[决策](../.agents/notes/implemented/architecture/2026-10-09-stored-credential-precedence.zh.md)）。环境是启动快照，启动后再 export 不可见。默认路径 `$DSH_HOME/.credentials.yaml`，可 watch 重载。

`describe(ref)` → `{ configured, source?, writable }`，无 value 槽 → 可安全过 Remote。

---

## 4. 消费与授权

```text
配置: apiKeyEnv: DEEPSEEK_API_KEY
请求: credentials.resolve(ref)   // 每操作，禁止跨请求缓存
```

例：[`llm-deepseek/credential.ts`](../packages/llm/llm-deepseek/src/credential.ts#L15-L22)——有 credentials 服务则以它为准（含未配置）；无服务才退回 launch environment。

授权：插件 `registerFlow` → 人交互（notice／prompt）→ `modifyRecord` 写 grant；每 key 同时只一次 attempt；`authorized` 仅在本轮已提交新凭据时。

---

## 5. 与 settings

| | settings | credentials |
|---|---|---|
| 存什么 | 插件 Config（可含**引用名**） | 机密**值**／grant |
| 介质 | profile Cordis patch | `.credentials.yaml` 等 |
| UI | 表单；secret 角色脱敏 | 只显示配置态 |
| 热更新 | volatile Config | 按操作 `resolve` |

Models 页：settings 写 `apiKeyEnv`，密钥写 credentials；同 controller 两个 Remote。

---

## 6. 刻意限制

1. 文件对 OS 用户私有，但 agent 工具同用户——**无法对 agent 隔离**。
2. 空存储值一律未配置。
3. 监听器失败隔离，不影响已提交写。
4. grant payload 仅拥有插件可解释。

---

## 还没搞懂

1. credentials-local 跨进程 `modifyRecord` 文件锁细节。
2. deepseek-account PlatformSession 与 Ref／Key 两空间的边界对照。
3. pi-ai OAuth flow 一次完整走读。

## 读代码最短路径

1. [credentials.zh.md](../docs/subsystems/credentials.zh.md)
2. [`credentials/src/index.ts`](../packages/credentials/credentials/src/index.ts)
3. [`credentials-local`](../packages/credentials/credentials-local/)
4. [`llm-deepseek/credential.ts`](../packages/llm/llm-deepseek/src/credential.ts)
5. [`authorization`](../packages/credentials/authorization/)；settings-controller Remote
