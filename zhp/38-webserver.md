# Host webserver：路由席位与 SPA 回退

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@3b54ee8b7e` |
| 证据 | 源码；权威见 [`packages/host/webserver/`](../packages/host/webserver/README.zh.md)、[`packages/host/frontend-static/`](../packages/host/frontend-static/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。启动挂载对照 [07](./07-startup.md)；Typert / 同进程 Host 对照 [26](./26-typert.md)；浏览器插件热重载对照 [39](./39-hmr.md)。

## 一句话

**`ctx.webServer` = 浏览器 GUI 的唯一 HTTP/HTTPS 监听器：其他插件注册 exact / prefix / upgrade；匹配顺序固定为精确 → 最长前缀 → 唯一 fallback。它自己不提供任何文件——SPA dist、`/api`、HMR SSE、插件 bundle 全是注册方的事。**（源码）

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | `node:http`（或配置了 `tls` 时的 `node:https`）服务器 + 路由注册表 |
| **是** | Peer / Origin 相关入口上的载体；`getOrigin()` 给本机客户端根 URL |
| **不是** | 静态文件服务器（无内置 `sendFile`） |
| **不是** | Electron 主路径（Desktop 用 `dsh-app://`，API 仍可打到本机 Host） |
| **不是** | 模型可见输入；改路由不进 session 日志 |

web-app 由 `web-startup` 解析 `--host` / `--port` 等，再注入 webserver 配置；见 [07 §5](./07-startup.md)。

---

## 2. 匹配顺序

固定三档（[`match` / `resolve`](../packages/host/webserver/src/index.ts#L648)）：

```text
pathname
  → exact 表命中？
  → 否则 prefixes 里最长前缀（path 或 path/...）
  → 否则唯一 fallback
  → 都没有 → 404
```

| API | 用途 |
|---|---|
| `register({ kind: 'exact' \| 'prefix', path, handler \| resource })` | 具名 HTTP 路由；同表重复 path **抛错** |
| `registerUpgrade({ path, handler })` | **仅 exact** 的 HTTP upgrade（如 WS）；未命中直接关连接 |
| `registerFallback(handler \| { resource })` | **唯一**回退席；第二次注册抛错 |

注册顺序不影响匹配；组合层保证路径互不相交。`resource` 形态只应答 `GET`/`HEAD`（其它方法 405）；`handler` 自己管完整响应生命周期。

常见注册方（示意，非穷尽）：

| 路径 / 席位 | 谁认领 |
|---|---|
| `/api`（一元 Remote POST 等） | Connection / Gateway 桥 |
| `/api/remote.mux`（upgrade） | API Gateway 流式 mux → [40](./40-api-gateway.md) |
| `/plugins/events`（SSE） | [`client-hmr`](./39-hmr.md) |
| **fallback** | [`host-frontend-static`](../packages/host/frontend-static/src/index.ts#L152) → SPA dist |

---

## 3. Fallback 与 index

Web 组合里 **`frontend-static` 占住唯一 fallback**：未命中具名路由的请求交给 SPA dist；对其渲染的每个 `index.html` 调用 `renderIndex`。

Index 注入两层（按页面 Peer 计算）：

1. `collectIndexInjections(peer)` → 发 `webserver/index-inject`，订阅方推当前行（含 `script-preload` 等）；
2. `renderIndex(html, peer)` → 先渲染注入行，再按注册顺序跑 `tapIndex` 原始转换。

没有 fallback 时具名未命中 → 404。第二次 `registerFallback` → 抛错（「fallbacks cannot compose」）。

---

## 4. 实现要点

1. **不服务文件**：注释写明 `/api`、插件 bundle、HMR 事件、SPA 都是别的插件注册的（[`index.ts` L4–L7](../packages/host/webserver/src/index.ts#L4)）。
2. **激活即 listen**：`Service.init` 里 `createServer` → `listen`；`port: 0` 由 OS 分配，读 `ctx.webServer.port`。
3. **TLS**：同一地址 HTTPS，不另开 HTTP、不做 HTTP→HTTPS 重定向；材料在激活时读一次，坏证书拒绝初始化。
4. **压缩**：可选 gzip；SSE / 已编码 / 过小 body 等保持原样。
5. **Handler 抛错**：HTTP → 400（头已发则毁 socket）+ warn，**不**拖垮进程；upgrade 抛错毁该 socket。

---

## 与 Typert / Client 进程

同 [26](./26-typert.md)：web profile = **一个 Node Host**（agent + Gateway + **同一个** `webServer`）+ 浏览器文档。不是「前端 Nginx 一进程 + API 另一进程」的默认形态。

---

## 还没搞懂

1. 本机抓一条 `/` → fallback → index-inject 实际注入行（对照 `window.__DSH_BOOT__`）。
2. `readResource` 被进程内调用方（非浏览器）使用的完整名单。
3. public mount / 反代前缀下 `getOrigin` 与 document-relative 路由的对照实测。

## 读代码最短路径

1. [webserver README](../packages/host/webserver/README.zh.md#use-this-package)
2. [`register` / `registerFallback` / `match`](../packages/host/webserver/src/index.ts#L445)
3. [frontend-static fallback](../packages/host/frontend-static/src/index.ts#L152)
4. 启动侧：[07](./07-startup.md) + [web-startup](../packages/bundle/web-app/src/startup.ts)
