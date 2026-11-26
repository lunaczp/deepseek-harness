# Web Client 前后端组织：以 Workspace 为竖切

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@9e3ceed689` |
| 证据 | 源码；权威见 [`workspace`](../packages/workspace/workspace/README.zh.md)、[`workspace-controller`](../packages/api/workspace-controller/README.zh.md)、[`ui-workspace`](../packages/client/ui-workspace/README.zh.md)、[`docs/subsystems/web-client.zh.md`](../docs/subsystems/web-client.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Slot / React 渲染续篇 [41b](./41b-web-client-slots.md)；插件如何进浏览器 [42](./42-client-modules.md)；Typert / Gateway [26](./26-typert.md) / [40](./40-api-gateway.md)；HTTP [38](./38-webserver.md)；双面同库设计对照 [44](./44-host-client-dual-face.md)；workspace 实体落盘对照 [45](./45-storage.md)。

## 一句话

**Web 功能按「实体 → Host Controller（@Remote）→ Client 无 UI 状态 → ui-* 插件」竖切分包；Workspace 是完整样板。UI 用 slot 组合（见 41b），数据走 `ctx.workspaces` / Gateway，不直连 registry。**（源码）

---

## 1. 分层（不是前后端两个文件夹）

| 层 | 典型包 | 跑在哪 | 职责 |
|---|---|---|---|
| **对象实体** | `packages/workspace/workspace` | Host | `ctx.workspaceRegistry`、持久 `Workspace` |
| **服务端接口** | `packages/api/*-controller` Host 入口 | Host | `@Remote` / `follow` 流 |
| **Client 状态** | 同包 `src/client/`（`./client` 导出） | **浏览器 Client** | 无 React 的 model + `ctx.*` 门面 |
| **前端渲染** | `packages/client/ui-*` | 浏览器 | React + slots + locale |
| **载体** | gateway / connection / webserver | Host + Client | `/api`、`/api/remote.mux` |

和常见 Web 对照：REST Controller ≈ `@Remote`；Redux ≈ Client model；页面路由树 ≈ Cordis client 插件 + **slots**。

---

## 2. Workspace 包地图

```text
packages/
  workspace/workspace/                 # 领域实体 Host-only
    src/types.ts, entity.ts, index.ts → ctx.workspaceRegistry

  api/workspace-controller/            # 一包两面
    src/index.ts                       # Host：WorkspaceController @Remote
    src/commands.ts, feed.ts
    src/client/                        # Client：model + ctx.workspaces
      index.ts / model.ts / service.ts
    → ./remote（Typert 生成）、./client（浏览器插件面）

  client/ui-workspace/                 # 仅 UI
    src/client/*.tsx + index.ts        # slots + React

web-app cordis.patch.yml
  dsh-workspace
  dsh-api-workspace-controller         # Host 半（"." 入口）
  … api-remotes 挂 remote.workspace …
  dsh-client-ui-workspace              # 浏览器 UI
  # Client 半 ./client 经 package.json dsh.client 进 Client 插件图
```

### 实体

- `WorkspaceId`：uuid，**不是路径**（[`types.ts`](../packages/workspace/workspace/src/types.ts)）
- `Workspace`：`id` / 规范 `path` / `title` / `sessionIds` / 时间戳…
- 删登记 **不删** 磁盘目录、不删 Session

### Host API

[`WorkspaceController`](../packages/api/workspace-controller/src/index.ts#L55)：`namespace: 'workspace'`

- 一元：`create` / `rename` / `delete` / `archiveSession` / `pinSession`…
- 流：`@Remote({ mode: 'stream' }) follow` → baseline + upsert/remove/order…（重连换一代 baseline）
- 注入 `workspaceRegistry`、`remoteAccess`；同包挂 directoryPicker

### Client `src/client`（重要澄清）

| 问题 | 答案 |
|---|---|
| 跑在哪 | **只在 Client**（浏览器 Cordis）；不是 Host |
| Host yml 的 `workspace-controller` | 加载包 **Host 入口** `src/index.ts`，**不执行** `service.ts` |
| `./client` 怎么进浏览器 | `package.json` → `exports["./client"]` + `dsh.client`，进 Client 插件图 |
| 同名类 | Host / Client 各有一个 `WorkspaceController`；Client 的注册 key 是 **`workspaces`** |

[`apply`](../packages/api/workspace-controller/src/client/index.ts#L47)：

```text
ClientWorkspaceModel(remote.workspace)
  → new WorkspaceController → ctx.workspaces
  → createWorkspaceStateStream(...).start()  // follow + 重连
```

- `ctx.workspaces.list`：`getSnapshot` / `subscribe`（无 React）
- `ctx.workspaces.create/rename/…`：调 Remote，折 `RemoteResult`，供 UI 用

### UI

[`ui-workspace`](../packages/client/ui-workspace/src/client/index.ts)：inject `workspaces`、`slots`…；往 `sidebar.workspaces` / hero picker 等洞 register 组件；业务写读只碰 `ctx.workspaces`。

---

## 3. 一条调用（添加工作区）

```text
WorkspacePicker / 侧栏「添加」
  → slot directoryFlow 选出 Host path
  → workspaces.create({ path })
  → remote.workspace.create          // 一元 POST /api
  → Host @Remote create → registry
  → follow 流 upsert（或一元回显）
  → ClientWorkspaceModel 更新 snapshot
  → UI 订阅重绘
```

列表实时性主要靠 **`follow`（mux）**；按钮动作用一元 Remote。见 [40](./40-api-gateway.md)。

---

## 4. 设计要点

1. **UI 不拥有权威列表**；权威在 Host registry，Client 是投影。
2. **Controller Client 半无 JSX**；React 只在 `ui-*`。
3. **扩展 UI 用 slot**（子洞：directoryFlow、row.action），不改壳死代码——细节 [41b](./41b-web-client-slots.md)。
4. 对模型不可见（无工具/提示词）。

---

## 还没搞懂

1. Client 插件图里 `dsh.client` 扫描与 `ui-workspace` 的激活依赖边一次对照。
2. `ClientWorkspaceModel` 一元回显 vs follow 帧的完整竞态表。
3. 非 owner Peer 过滤后的 `replace` 帧在 UI 上的表现实测。

## 读代码最短路径

1. [workspace README](../packages/workspace/workspace/README.zh.md)
2. Host：[`workspace-controller/src/index.ts`](../packages/api/workspace-controller/src/index.ts)
3. Client：[`src/client/index.ts`](../packages/api/workspace-controller/src/client/index.ts) + [`service.ts`](../packages/api/workspace-controller/src/client/service.ts)
4. UI：[`ui-workspace/src/client/index.ts`](../packages/client/ui-workspace/src/client/index.ts) → [41b](./41b-web-client-slots.md)
