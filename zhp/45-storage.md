# Storage：非会话持久化与 storage-domain

| | |
|---|---|
| 状态 | 学习中（源码 + 文档 / Agent Note） |
| 日期 | 2026-11-26 |
| 基线 | `zhp@7c2b3ef5e7` |
| 证据 | 源码与文档；权威见 [`docs/subsystems/storage.zh.md`](../docs/subsystems/storage.zh.md)、[`packages/storage/`](../packages/storage/README.zh.md)、[领域 KV Note](../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。与会话日志对照 [12](./12-session-implementation.md)；seam [19](./19-seam-and-service.md)；Workspace 竖切消费方 [41](./41-web-client.md)；schedule [37](./37-schedule.md)；插件设置表单（非本栈）对照 [47](./47-settings.md)。

## 一句话

**storage = 可选 Host 侧非会话 KV 栈：hub 只注册、后端管介质、`storage-domain` 管 schema／内存投影／写链／事件。产品包只碰 `ctx.storageDomain`；模型与 agent loop 看不到。**（源码）

---

## 1. 四包与组合

| 包 | 角色 | ctx |
|---|---|---|
| `storage` | Hub：名称→后端 + form 挂载 | `ctx.storage` |
| `storage-json` / `storage-sqlite` | Provider | 经 hub 名 `json` / `sqlite` |
| `storage-domain` | 类型化领域 API | `ctx.storageDomain`（= `ctx.storage.domain`） |

随附 base（[`cordis.patch.yml`](../packages/bundle/base/cordis.patch.yml)）：hub + JSON（`root: dshHomePath('storages')`）+ domain（`backend: json`）。可并排挂 sqlite；**哪个领域走哪边由 domain 的 `backend` / `routes` 决定**，不是 hub 全局二选一。

```text
产品包 (workspace / schedule / projection-cache / cua …)
  → ctx.storageDomain.open(spec)
  → DomainFacility 路由 → backend.kv.open(unit)
  → 不透明 JSON 读写落盘
```

Hub **不做 IO**（[`storage/src/index.ts`](../packages/storage/storage/src/index.ts)）。后端另发生命周期键 `storage.backend.<name>`，domain `inject` 等齐再激活，避免竞态。

---

## 2. 两层标准化（易混）

```text
产品 API（typed put/get/update + domain/changed）  ← storage-domain
    ↓
统一介质原语（不透明 JSON KV）                      ← KvUnit / StorageBackend
    ↓
json 文件 / sqlite 行                                ← 各后端
```

- **`KvUnit`**（[`backend.ts`](../packages/storage/storage/src/backend.ts)）：`loadAll` / `putRecord` / `delete*` / `setGlobal`；名限 `UNIT_NAME_RE`；布局 `single` | `per-record`；写完成=已持久；**不**串行并发、**无** schema。
- **`storage-domain`**：在之上加 zod、同步内存读、每域写入链、变更事件。产品约定禁止直接碰后端。

| 后端 | 介质 | 适合 |
|---|---|---|
| JSON | `$root/<unit>.json` 或 per-record 树 | 可读、小数据；`single` 整文件重写 |
| SQLite | 单库行存 | 高频定点更新；同步驱动会堵事件循环 |

---

## 3. storage-domain：作用与用法

### 作用

相对 hub／后端，补齐：

1. 声明与校验（`defineDomain` + zod；open 时校验已存记录）
2. 读写语义（内存权威、同步读；先持久→改内存→发事件）
3. 进程内 `domain/changed`（通知，不是事务参与者）

**不是**抽象可换实现的 seam：单一实现，消费方直接依赖本包。

### 用法

**拥有方声明一次：**

```ts
defineDomain({
  name: 'schedule', version: 2, compatibleVersions: [1],
  tables: { tasks: domainTable<ScheduleId, ScheduleTask>(schema) },
})
```

可选：`global`、`layout: 'per-record'`、`invalidRecords: 'backup-and-skip'`。非法名／坏 version／global 接受 `null` → 模块加载即炸。

**服务 init 时 open，effect 关闭：**

```ts
const domain = await ctx.storageDomain.open(spec)
ctx.effect(() => () => domain.close())
await domain.table('tasks').put(id, record)
const row = domain.table('tasks').get(id) // 同步
await domain.table('tasks').update(id, r => ({ ...r, … }))
```

句柄生命周期归调用方；facility 卸载时 `closeAll` 兜底。

**写路径：**

```text
enqueue → unit.put/delete → 改内存 → emit domain/changed
```

`update` 的 `fn` 在链上自己的槽位跑，并发不交错。返回对象即内存中的那份，禁止原地改。校验主要在持久读边界；`put` 默认信任类型。

### 消费者（源码）

| 包 | domain |
|---|---|
| workspace | `workspace`（表 + global） |
| schedule | `schedule`（`compatibleVersions: [1]`） |
| session-projection-cache | `session_projcache`（`per-record`） |
| experimental/cua 等 | 授权／小域 |

---

## 4. 类比：像什么、不像什么

| 说法 | 判定 |
|---|---|
| 「封装不同后端、统一读写」 | **半对**：统一原语在 `KvUnit`；domain 还加语义层 |
| 「像 BFF API」 | **偏**：稳定门面像；但是同进程 Host API，不是面向前端的聚合网关 |
| 更贴的类比 | **Repository／领域持久化门面** |
| 网络分层若硬套 | `KvUnit`≈驱动；domain≈DAO；Gateway Remote≈才更像给 Client 的 BFF |

与 session 持久化边界：对话事件日志走 session seam（[12](./12-session-implementation.md)）；跨会话／非日志应用状态走 storage。

---

## 5. 刻意缺口（缺陷／延期）

1. 无跨表事务（表 + global 靠调用方串行两次 await）
2. 无二级索引／多段键——过滤在内存
3. `domain/changed` 仅本进程；跨进程观测延期
4. 无值迁移执行器——靠 `compatibleVersions` + 拥有方重写
5. 改后端路由不搬数据
6. 跨进程写不协调（链只串本进程）
7. `unknown-state` 后必须 close 重开
8. 不是 session 日志；`log` 分面延期

**该用：** 跨重启、有 schema、不属于某条 session 日志的 Host 状态。
**不该用：** 要进模型的对话内容；SQL join；多进程实时同步；一次多表原子提交。

---

## 还没搞懂

1. projection-cache `per-record` + `backup-and-skip` 与权威域策略对照。
2. 七个拆 leaf 无关；本栈 Host-only——Client 经 Remote 见 workspace 见 [41](./41-web-client.md)；实体深读见 [46](./46-workspace.md)。

## 读代码最短路径

1. [storage.zh.md](../docs/subsystems/storage.zh.md)
2. Hub [`storage/src/index.ts`](../packages/storage/storage/src/index.ts) + [`backend.ts`](../packages/storage/storage/src/backend.ts)
3. Domain [`storage-domain/src/index.ts`](../packages/storage/storage-domain/src/index.ts) + [`domain.ts`](../packages/storage/storage-domain/src/domain.ts)
4. 消费方：[`workspace/src/spec.ts`](../packages/workspace/workspace/src/spec.ts) → `Service.init` open；实体深读 [46](./46-workspace.md)
