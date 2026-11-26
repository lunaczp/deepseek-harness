# Client Resources：`dsh-resource://` 实时值总线

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@bf45290539` |
| 证据 | 源码；权威见 [`packages/client/resources/`](../packages/client/resources/README.zh.md)、[`workspace-files` client](../packages/api/workspace-files/src/client/)、[`ui-sidebar-documentpreview`](../packages/client/ui-sidebar-documentpreview/) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Slot [41b](./41b-web-client-slots.md)；插件加载 [42](./42-client-modules.md)；Gateway [40](./40-api-gateway.md)；Workspace 竖切 [41](./41-web-client.md)；双面同库 [44](./44-host-client-dual-face.md)。

## 一句话

**`dsh-client-resources` = 浏览器里按 `dsh-resource://协议/路径` 订阅实时数据的总线：协议包 `register` 出流，组件 `useResource` / `pin` 订值。只跑 Client；不是 Host 文件服务，也不是 `/plugins` 静态资源。**（源码）

---

## 1. 客户端还是服务端？

**客户端（浏览器）。**

| | |
|---|---|
| 真逻辑 | [`src/client/`](../packages/client/resources/src/client/) → `ctx.resources`、`useResource` |
| Host 入口 | [`src/index.ts`](../packages/client/resources/src/index.ts) `apply` **为空** |
| 进图方式 | `dsh.client` → client-modules（[42](./42-client-modules.md)） |

提供方可在 `open` 里调 `remote.*` 打到 Host，但 **resources 包本身不在服务端跑**。

---

## 2. 用户视角：打开文件预览

侧栏点 `src/a.ts` → 右侧 tab 预览。地址形如：

```text
dsh-resource://file/session/<sessionId>/src/a.ts
         │      │         └─ 路径（作用域 + session + 相对/绝对路径）
       scheme  协议名（hostname）
```

预览不关心 Host 怎么 `stat`，只订这个 URL。

---

## 3. 怎么使用（读）

每个 slot 组件 props 上有 `useResource`（resources 经 `slots.provideRoot` 注入）：

```ts
// TextPreview 一类
const meta = useResource<'file'>(tab.contentId)
// status: 'none' | 'loading' | 'live' | 'failed'
```

- 非 `dsh-resource://`（如 `sidebar://guide`）→ `none`
- 订阅 = 持有者 +1，会打开/共享该地址的流
- 卸 UI 仍想保活：`ctx.resources.pin(address, signal)`（Sidebar/dock 对打开 tab 常用）
- 非 React：`ctx.resources.source(address)`

编址：[`fileAddressFor` / `sessionFileAddress`](../packages/util/workspace-path/src/index.ts)，不要手拼。

---

## 4. 怎么注册（提供协议）

以 **`file`** 为例，全在浏览器插件 **`workspace-files/client`**：

### ① 类型合并

[`types.ts`](../packages/api/workspace-files/src/client/types.ts) → `ResourceProtocolMap.file = WorkspaceFileStat`（合并进 ui-slots 的空表）。

### ② `open` 实现

[`provider.ts`](../packages/api/workspace-files/src/client/provider.ts)：

```ts
{
  protocol: 'file',
  async *open(address, { signal }) {
    // parseFileAddress → sessionId + path
    // 首帧 remote.workspaceFiles.stat
    // ChangeFeed 变更 → 再 stat → yield RemoteResult 帧
  }
}
```

失败：`{ ok: false, error }`；必须听 `signal`；流内抛错当编程错误。

### ③ register

[`client/index.ts`](../packages/api/workspace-files/src/client/index.ts)：

```ts
inject = ['resources', 'remote', 'remote.workspaceFiles']
ctx.effect(() => {
  const release = ctx.resources.register(provider)
  return async () => { release(); await changes.settle() }
}, 'workspace-files: file resource provider')
```

一协议一提供方；重复注册抛错。其它协议同理（`plan`、`subagentchat`…），各包自己 `register`。

---

## 5. 总线怎么实现

[`ResourceRegistry`](../packages/client/resources/src/client/resources.ts) + [`apply`](../packages/client/resources/src/client/index.ts)：

```text
useResource / pin
  → holders++
  → 第一个持有者：providers.get(protocol).open(address, { signal })
  → 帧写入 snapshot store → 订阅者重渲
  → 最后一个持有者：abort；快照回 idle
  → record 条目页面内不删（StrictMode / 订阅窗口引用稳定）
```

`protocolOf(address)`：仅 `dsh-resource:`，hostname 小写 = 协议键。

[`client-resources` apply](../packages/client/resources/src/client/index.ts#L30)：`inject: ['slots']`，`provideRoot({ keyedHooks: { resource: address => resources.source(address) } })`。

---

## 6. 与相邻概念

| | resources | modules `/plugins` assets | Gateway |
|---|---|---|---|
| 是什么 | 按地址的**实时值流** | 静态图片等文件字节 | Host↔Client RPC |
| 例子 | `dsh-resource://file/…` | `plugins/<pkg>/assets/…` | `workspaceFiles.stat` |

```text
点文件 → 编址 dsh-resource://file/…
      → useResource
      → file 提供方 open
      → remote.workspaceFiles.*（Gateway）
      → Host
```

---

## 还没搞懂

1. dockkit 对 tab 的 `pin` 与预览 `useResource` 的 holders 时序对照。
2. `absolute` 作用域地址为何不能授权 Host 调用的产品边界用例。
3. 同地址多预览实例共享一流时的 version/absent 帧表现实测。

## 读代码最短路径

1. [resources README](../packages/client/resources/README.zh.md)
2. 总线：[`resources.ts`](../packages/client/resources/src/client/resources.ts) + [`client/index.ts`](../packages/client/resources/src/client/index.ts)
3. 提供方：[`workspace-files` provider](../packages/api/workspace-files/src/client/provider.ts)
4. 使用：[`TextPreview.tsx`](../packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx) `useResource<'file'>`
