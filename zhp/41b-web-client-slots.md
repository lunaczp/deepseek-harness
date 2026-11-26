# Web Client Slot 与 React 渲染

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@9e3ceed689` |
| 证据 | 源码；权威见 [`ui-slots`](../packages/client/ui-slots/README.zh.md)、[`ui-renderer`](../packages/client/ui-renderer/)、[slot Note](../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)、[`docs/subsystems/web-client.zh.md`](../docs/subsystems/web-client.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。竖切组织 / Workspace [41](./41-web-client.md)；启动 [07](./07-startup.md)。

## 一句话

**Slot = 带类型的 UI 插槽账本（谁声明洞、谁 register 组件）；React 只负责按账本挂组件树。外壳是 `apps/web` `#root` → `uiRenderer.mount` → 唯一的 `renderSlot('root')`。**（源码）

---

## 1. Slot 是啥（不是钱、不是 HTTP）

Web Client 预留的 **组合洞**：壳声明「这里可挂 UI」，插件 `register` 填坑；可再声明 **children** 子洞给别的插件填。

| kind | 含义 |
|---|---|
| `single` | 一个占用方（同 priority） |
| `list` | 有序多项（要 `id`，可 `order`） |
| `keyed` | 按 key 分派 |
| `chain` | `select` 选举第一个非 null |
| `hoc` | 层层包 `children` |

类型：`SlotMap` 空表 + 各包 `declare module` 合并。包：[`dsh-client-ui-slots`](../packages/client/ui-slots/)（账本）+ [`ui-renderer`](../packages/client/ui-renderer/)（React）。

与 [41](./41-web-client.md) 的关系：slot 管 **UI 插哪**；`ctx.workspaces` 管 **数据**。

---

## 2. 实现：两层

```text
ui-slots SlotCore     纯账本（无 React）
ui-renderer           Outlet + createRoot，读账本画组件
```

### 账本 `SlotCore`

- 自带 **`root`**
- **先声明再 register**；未声明抛错（[`register`](../packages/client/ui-slots/src/index.ts#L1241)）
- 父 `register({ children: { 'sidebar.workspaces': { kind, scope } } })` → 写入子 `spec`，`declarationEpoch++`
- disposer 卸注册并释放子声明

### `inject`：等声明再装

[`ctx.slots.inject(key, cb)`](../packages/client/ui-renderer/src/client/registry.ts#L209)：

- 洞已声明 → 立刻跑 `cb`（通常内部 `register`）
- 未声明 → 等父级声明后再跑；epoch 变则 dispose 再跑（HMR 友好）

### 授权渲染

- ctx 级几乎只允许：`renderSlot('root', …)`
- 子洞只能由**声明了该 children 的 entry** 通过 props.`renderSlot` 画
- 否则 `SlotOwnershipError` / 卸后 `StaleAuthorizationError`（[`boundRenderSlot`](../packages/client/ui-renderer/src/client/scoped-slots.tsx#L72)）

---

## 3. Workspace 具体例子

[`ui-workspace`](../packages/client/ui-workspace/src/client/index.ts#L320)：

```ts
ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
  {
    name: 'sidebar.workspaces',
    children: {
      'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
      // …
    },
    inject: browserInjected,
    locale: NS,
  },
  WorkspaceBrowser,
))

ctx.slots.inject('sidebar.workspaces.session.row.action', function* () {
  yield ctx.slots.register({ name: '…row.action', id: 'archive', order: 100, … }, ArchiveSessionRowButton)
  yield ctx.slots.register({ name: '…row.action', id: 'pin', order: 200, … }, PinSessionRowButton)
})
```

目录选择器填子洞（[`ui-directory-picker-browse`](../packages/client/ui-directory-picker-browse/src/client/index.ts#L177)）：

```ts
ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
  yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', … }, BrowseDirectoryFlow)
})
```

没有占用方 → 「添加工作区」无选目录 UI。Hero picker 同理：`conversation.hero.workspace` + 其子 `directoryFlow`。

---

## 4. React 最后怎么画

### 浏览器外壳

```text
apps/web/index.html          <div id="root">
  → apps/web/src/main.ts     new AppWebEntry(el).run()
    → packages/client/web    boot Client 插件图
      → uiRenderer.mount(#root)
```

[`main.ts`](../apps/web/src/main.ts) · [`ui-renderer apply`](../packages/client/ui-renderer/src/client/index.ts#L89)：`createRoot` / `hydrateRoot` → `buildRenderApp` → **`ctx.slots.renderSlot('root', {})`**（[`app.tsx`](../packages/client/ui-renderer/src/client/app.tsx#L21)）。

`root` 的占用方通常是 **ui-layout `AppFrame`**（[`ui-layout`](../packages/client/ui-layout/src/client/index.ts#L192) 声明 sidebar/main/overlay 等 children）。

### 树怎么长出来

```text
createRoot(#root)
 └─ renderRoot → RootOutlet
     └─ data-slot="root" → <AppFrame />
         └─ props.renderSlot('sidebar', …)
             └─ <SlotOutlet slotKey="sidebar" />
                 └─ … → renderSlot('sidebar.workspaces')
                     └─ <SlotOutlet> → <WorkspaceBrowser />
                         └─ renderSlot('…directoryFlow')
                             └─ <BrowseDirectoryFlow />
```

`SlotOutlet`（[`scoped-slots.tsx` L1228](../packages/client/ui-renderer/src/client/scoped-slots.tsx#L1228)）：

1. `useSyncExternalStore(host.subscribe(key), getVersion)` —— 账本变就重渲
2. `display:contents` 锚点 `data-slot="…"`
3. 按 kind 取 `entriesOfSlot` → ErrorBoundary → Entry → **`entry.component` 这个 FC**

**没有自定义 reconciler**；就是标准 React 组件树 + 外接账本。

### `useSyncExternalStore` 是啥

React 18 Hook：把 **React 外的数据源** 安全接到组件（并发下防 tearing）。

```ts
useSyncExternalStore(subscribe, getSnapshot)
```

Slot 用它订阅 SlotCore 的 version；`register`/dispose → version++ → Outlet 重读 entries。比手写 `useEffect`+`setState` 订阅更适合并发。

---

## 5. 和相邻概念

| | Slot | Client `workspaces` service | Gateway |
|---|---|---|---|
| 面 | 浏览器 UI 组合 | 浏览器状态/命令 | Host↔Client RPC |
| 变了什么 | 谁画哪块 DOM | Workspace 投影 | wire 调用 |

HMR（[39](./39-hmr.md)）可整插件重载 → inject/register 再跑 → Outlet 经 version 更新。

---

## 还没搞懂

1. Factory slot（`registerFactory`）与普通 slot 在 layout 中的实际占用点。
2. `session` / `session-maybe` scope 与 Session 切换 remount 规则的一次对照。
3. `#root` hydrate（boot DOM `[data-dsh-boot]`）与首屏闪白的边界实测。

## 读代码最短路径

1. [ui-slots README](../packages/client/ui-slots/README.zh.md) + [slot Note](../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)
2. 外壳：[`apps/web/index.html`](../apps/web/index.html) → [`main.ts`](../apps/web/src/main.ts) → [`ui-renderer`](../packages/client/ui-renderer/src/client/index.ts)
3. Outlet：[`scoped-slots.tsx` SlotOutlet / createSlotRenderer](../packages/client/ui-renderer/src/client/scoped-slots.tsx)
4. 例子：[41](./41-web-client.md) + [`ui-workspace` register](../packages/client/ui-workspace/src/client/index.ts#L320)
