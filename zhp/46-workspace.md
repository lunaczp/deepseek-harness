# Workspace：Host 项目注册表与会话归属

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@29fa5c9225` |
| 证据 | 源码与文档；权威见 [`docs/subsystems/workspace.zh.md`](../docs/subsystems/workspace.zh.md)、[`packages/workspace/workspace/`](../packages/workspace/workspace/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Web 竖切（controller／Client／ui）对照 [41](./41-web-client.md)；落盘栈 [45](./45-storage.md)；Session 日志 [12](./12-session-implementation.md)。勿与 [05](./05-workspace-conventions.md)（笔记约定）混淆。

## 一句话

**`ctx.workspaceRegistry` = Host 侧有序项目列表：稳定 uuid + 规范路径 + 按目录归组的会话账本；落盘走 storage-domain；移除只删登记，不删文件夹／会话日志；对模型不可见。**（源码）

---

## 1. 在栈里的位置

```text
ui-workspace / Client model          ← [41]
        ↕ Remote
workspace-controller (Host)
        ↓
ctx.workspaceRegistry                ← 本包（组内唯一）
        ↓
ctx.storageDomain  (domain: workspace)
ctx.sessionPersistence (只读 SessionHeader.cwd)
```

`inject = ['storageDomain', 'sessionPersistence']`（[`index.ts`](../packages/workspace/workspace/src/index.ts#L171)）：持久化缺席时插件 pending，**不会**把「不可用」当成空历史并误写 `initialized`。

---

## 2. 核心概念

| 概念 | 含义 |
|---|---|
| `WorkspaceId` | uuid 品牌，**不是路径** |
| `path` | 创建时 `fs.realpath`；之后永不改写（目录没了也保留） |
| `title` | 显示名；允许重名 |
| `sessionIds` | 有序候选账本；活动**不**重排 |
| global | `workspaceIds`、`archived*`／`pinned*`、`initialized`、`pendingMutation`、`defaultWorkspaceId` |

唯一性：**规范路径字符串相等**（symlink 指向已有目录会撞）。

持久（[`spec.ts`](../packages/workspace/workspace/src/spec.ts#L76-L84)）：domain `workspace` v2 = 表 `workspaces` + global。消费方只见 `Workspace` 接口；实现 `WorkspaceEntity` 包私有。

---

## 3. 启动

[`Service.init`](../packages/workspace/workspace/src/index.ts#L199-L220)：

```text
open(workspaceDomainSpec)
  → recoverPendingMutation()
  → validateStoredState
  → 未 initialized：读全部 SessionHeader → bootstrap → 写 initialized
  → 否则刷新 header 索引
  → indexLiveSessions → rebuildEntities
```

Bootstrap **只读 header cwd**，按规范路径分组建 workspace，不加载事件正文。空注册表一旦 `initialized: true` 不再引导。

---

## 4. 两次写 + 崩溃恢复

创建／删除改「表行 + 顺序 global」两处；中间用 `pendingMutation`（[`createCanonical`](../packages/workspace/workspace/src/index.ts#L510-L582)）：

```text
create:
  1. global ← pendingMutation: create(id)
  2. table.put(id, record)
  3. global ← 清标记 + 插入 workspaceIds + initialized
```

[`recoverPendingMutation`](../packages/workspace/workspace/src/index.ts#L636-L648)：标记存在且 id **不在** `workspaceIds` → 删半成品行、清标记。无标记却表／序不一致 → `validateStoredState` fail loud。

实体变更（改名、attach…）走 `table.update`；注册表操作另有 `operationTail` 串行。

---

## 5. 会话归属

- **attach：** header cwd 必须是现存目录且等于 workspace `path`；已记账幂等。
- **目录缺失：** 已记账 **保留**（含悬空 symlink）；新会话仍要求目录在。
- **投影过滤：** 缺 header／cwd 坏／路径不匹配 → 不返回；下次变更剪坏候选；缺目录不剪。
- **删项目：** 只删登记 → 会话变 Ungrouped；再 create 同路径 = **新空项目**。
- **归档／置顶：** global 集合，不改 `sessionIds` 槽；归档清置顶。归档前 waterfall `workspace/session-activity`；`stopActivity` 先写归档再 parallel `workspace/session-stop`。

---

## 6. API 地图

| 面 | 职责 |
|---|---|
| `WorkspaceRegistry` | `create`／`list`／`delete`／排序、`initializeDefault`、`archive*`／`pin*`、`resolveByPath` |
| `Workspace` | `setTitle`、`attach`／`detach`／`insertSessionBefore`、`status()` |
| 实现 | [`entity.ts`](../packages/workspace/workspace/src/entity.ts) |

首次使用：`initializeDefault`——注册表与全部 session 历史皆空才建默认目录；删登记后不再自动建。

---

## 7. 与相邻概念

| | Workspace | Session 日志 | storage-domain |
|---|---|---|---|
| 存什么 | 项目元数据 + 会话账本 | 对话事件 | 通用 KV |
| 模型可见 | 否 | 是 | 否 |
| 删除 | 非破坏登记 | （独立能力） | 按 domain 写 |

刻意限制：移除≠删盘；外进程改目录延迟可见；活动检查与归档写入非原子；对模型零 token。

---

## 还没搞懂

1. `initializeDefault` 与 Host controller Documents 策略一次对照。
2. 归档活动检查与 API Session Controller `blocked` 门禁的时序边界实测。
3. `title` 参数生产调用方已无——删参时机（README TODO）。

## 读代码最短路径

1. [workspace.zh.md](../docs/subsystems/workspace.zh.md)
2. [`types.ts`](../packages/workspace/workspace/src/types.ts) → [`spec.ts`](../packages/workspace/workspace/src/spec.ts)
3. [`index.ts`](../packages/workspace/workspace/src/index.ts) init／create／recover／bootstrap
4. [`entity.ts`](../packages/workspace/workspace/src/entity.ts)
5. GUI 竖切 [41](./41-web-client.md)；落盘 [45](./45-storage.md)
