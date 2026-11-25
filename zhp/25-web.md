# Web 访问 seam：`ctx.web` 与 `web_search` / `web_fetch`

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未实测搜索/抓取） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@a177a1fb96` |
| 证据 | 源码；权威见 [`packages/web/` 组](../packages/web/README.zh.md)、[`dsh-web`](../packages/web/web/README.zh.md)、[`tool-web`](../packages/web/tool-web/README.zh.md)、[`docs/subsystems/web.zh.md`](../docs/subsystems/web.zh.md)、[seam 决策](../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Seam 用语 [19](./19-seam-and-service.md)；工具流水线 [17](./17-tools.md)；默认工具清单 [24 §4](./24-ptc.md)。

## 一句话

**Web seam 在同一个 `ctx.web` 上横跨 search + fetch：Definition 管注册与选择，Provider 换后端，`tool-web` 独占模型 schema；换提供方不改模型怎么查、怎么抓。**（源码）

---

## 0. 不是什么（易混）

| 名字 | 关系 |
|---|---|
| `packages/web/`（本文） | ✅ 模型侧 web 访问能力缝 |
| `web-app` / `web-client` / `web-server` | ❌ GUI / Host HTTP（另一套；Typert Remote 见 [26](./26-typert.md)） |
| `browser-use` | ❌ 交互式浏览器自动化 |
| `webhook` | ❌ 外部回调进 Session |

---

## 1. 包地图（完整三角）

```text
Definition  dsh-web                 → ctx.web（WebRuntime）
Provider    web-search-deepseek     → search id: deepseek-official
            web-deepseek-api        → search: deepseek-search-api
                                    → fetch:  deepseek-fetch-api
            web-fetch-http          → fetch id: http
Consumer    tool-web                → web_search / web_fetch → ctx.tools
```

| 包 | 角色 | 源码入口 |
|---|---|---|
| [`web/web`](../packages/web/web/) | Definition | [`WebRuntime`](../packages/web/web/src/index.ts#L82) |
| [`web-search-deepseek`](../packages/web/web-search-deepseek/) | Search Provider（旧 Messages） | `registerSearchProvider`；id `deepseek-official` |
| [`web-deepseek-api`](../packages/web/web-deepseek-api/) | Search + Fetch API | ids `deepseek-search-api` / `deepseek-fetch-api` |
| [`web-fetch-http`](../packages/web/web-fetch-http/) | 匿名 HTTP(S) Fetch | id `http`（[`LOCAL_FETCH_PROVIDER_ID`](../packages/web/web-fetch-http/src/provider.ts#L30)） |
| [`tool-web`](../packages/web/tool-web/) | Consumer | [`index.ts`](../packages/web/tool-web/src/index.ts)、[`search.ts`](../packages/web/tool-web/src/search.ts)、[`fetch.ts`](../packages/web/tool-web/src/fetch.ts) |

为何两项操作同缝：[Agent Note](../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)——共用提供方选择、取消/错误词汇与产品配置面；代价是 `search*` / `fetch*` 方法对并行。

---

## 2. `ctx.web` API（Definition）

| 能力 | 作用 |
|---|---|
| `registerSearchProvider` / `registerFetchProvider` | 注册；重复 id → `WEB_DUPLICATE_PROVIDER`；装卸发 `web/providers-changed` |
| `listProviders()` | Remote 给设置页；含不可用项；可选 `title` / `description` |
| `search(request, signal?)` | 单 `query`；seam 强制 `maxResults` 截断并设 `truncated` |
| `fetch(request, signal?)` | 单 `url`；非 2xx **仍是结果**（状态码属资源态） |
| `searchReady` / `fetchReady` | 选中提供方对该 LLM 路由能否鉴权（**禁止网络**）；选择失败答 true |

选择（执行时，不看注册顺序）：

| 情况 | 结果 |
|---|---|
| 已配 id 且可用 | 用它 |
| 已配但未注册 / 不可用 | `WEB_PROVIDER_CONFIGURED_MISSING` / `_UNAVAILABLE` |
| 未配，恰好一个可用 | 自动选 |
| 未配，多个可用 | `WEB_PROVIDER_AMBIGUOUS` |
| 未配，没有可用 | `WEB_PROVIDER_UNAVAILABLE` |

配置：`searchProvider` / `fetchProvider`（或 `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER`）。

词汇与 `WebError` 代码：[web.zh.md](../docs/subsystems/web.zh.md)。`WebFetchBody` 是封闭联合（`html` | `text`），新 kind 要连带改已知消费方。

---

## 3. Consumer：`tool-web`

| 工具 | 模型参数 | 落到 seam |
|---|---|---|
| `web_search` | `queries: string[]`（1…`searchMaxQueries`） | 去重后并发多次 `ctx.web.search`；合并 sources 再截断 |
| `web_fetch` | `url` | 一次 `ctx.web.fetch`；HTML→markdown；截断提示 |

要点（源码）：

- **独占** schema / 提示词段 / 超时 / 渲染；不绑死某 Provider。
- 产品关工具用 config（`search: false` / `fetch: false`）；提供方缺失时工具**仍可见**，执行报结构化错。
- 每步 `when`：`searchReady` / `fetchReady`——未就绪本步不声明不派发（PTC 也绑不上 → `UNKNOWN_TOOL`）。
- 超时在定义上，由 timeout-policy 强制；模型 schema **不**暴露 timeout。

默认预算见包 Config（search/fetch 超时默认 30s；base 把 search 提到 60s）。

---

## 4. base 默认组合

[`base/cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)（约 L482–L503）：

```text
web:              searchProvider: deepseek-search-api, fetchProvider: http
web-search-deepseek / web-deepseek-api / web-fetch-http
tool-web:         fetch: true, searchTimeoutMs: 60000
```

→ 搜索默认 DeepSeek Search API；抓取默认本机匿名 `http`。
`web` profile 常 disabled host `tool-web`，改由 **preset** 重挂；设置页仍可选 provider（`listProviders` + Remote）。

抓取网络策略（文档）：已交付 preset 默认不逐次审批 `web_fetch`；文件 sandbox **不管** Web；HTTP 提供方可达 loopback/内网——要挡需隔离或 `tools/pre-execute`（见 [web.zh.md · 抓取网络策略](../docs/subsystems/web.zh.md)）。

---

## 5. 一次调用链（Native）

```text
模型 web_search({ queries })
  → tools 流水线 → tool-web/search
  → ctx.web.search({ query, maxResults }) × N
  → selectSearchProvider → deepseek-search-api（默认）
  → 合并 / 截断 / 渲染 Sources:

模型 web_fetch({ url })
  → tool-web/fetch → ctx.web.fetch
  → HttpFetchProvider（默认）或 deepseek-fetch-api
  → 结果含 statusCode + body；工具负责展示
```

与 LSP 对照：换 Provider，模型工具名不变——典型 seam 交付面（[19](./19-seam-and-service.md)、[22](./22-lsp.md)）。

---

## 还没搞懂

1. 本机一次真实 `web_search` / `web_fetch` 的 tool/result 与凭据就绪切换。
2. `deepseek-official` Messages 搜索与 Search API 的请求/计费差异对照。
3. web preset 相对 base host 行的完整重挂清单。

## 读代码最短路径

1. [web 组 README](../packages/web/README.zh.md) + [subsystems/web.zh.md](../docs/subsystems/web.zh.md)
2. [`WebRuntime`](../packages/web/web/src/index.ts#L82) 选择与 `search`/`fetch`
3. [`tool-web` search/fetch](../packages/web/tool-web/src/) → 再点开默认 Provider
4. base 组合：[cordis.patch.yml](../packages/bundle/base/cordis.patch.yml) `web*` / `tool-web` 行
