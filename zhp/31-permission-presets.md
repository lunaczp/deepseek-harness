# Permission presets：权限模式捆绑表

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未新切预设对照） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@052425fe0c` |
| 证据 | 源码；权威见 [`permission-presets`](../packages/interaction/permission-presets/README.zh.md)、[`docs/subsystems/permission-presets.zh.md`](../docs/subsystems/permission-presets.zh.md)、[`sandbox`](../docs/subsystems/sandbox.zh.md)、审批 [30](./30-approval.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。审批闸门 [30](./30-approval.md)；沙箱 seam [32](./32-sandbox.md)；沙箱实测 [03](./03-sandbox-and-permissions.md)。

## 一句话

**`dsh-permission-presets` 提供多条具名预设，每条把 `sandbox/mode` + `approval/policy` 捆成一套；切换时写通两个权威旋钮，本身不是第二套执行引擎。**（源码）

---

## 1. 为啥要有

底层是**两个独立事实**：

| 旋钮 | 拥有者 | 管什么 |
|---|---|---|
| `sandbox/mode` | sandbox-policy | 文件沙箱宽窄 |
| `approval/policy` | user-approval | 要不要人审（`ask` / `never`） |

用户面对分离控件易配出怪组合。Presets = Permissions 选择器的**捆绑表**；卸掉本包后，最后一次写入的 sandbox/approval **仍生效**。

---

## 2. 是「多个预设配置」吗

**是。** 配置里一张 `presets` 表，默认两条（可增删改）：

| 预设名 | sandbox | approval | 含义 |
|---|---|---|---|
| `workspace-write` | workspace-write | ask | 工作区内写；更宽要审批 |
| `danger-full-access` | danger-full-access | never | 全文件访问；不问人 |

另外：

- **`custom`**：当前两旋钮对不上任何表项时的**推导状态**（可离开，不能当可选项选中）
- **`auto`**：`auto-review` 存活时额外贡献（满沙箱 + `ask`），保留名，不进普通配置表

新会话：`defaultPreset`；用户设置命名空间只影响**未来**会话默认，不改已有会话。

---

## 3. `danger-full-access` 怎么定义（两层）

### 作为 `SandboxMode`

闭集：`'read-only' | 'workspace-write' | 'danger-full-access'`（[`sandbox/src/index.ts`](../packages/sandbox/sandbox/src/index.ts)）。

| 模式 | 文件效果 |
|---|---|
| `read-only` | 拒写 |
| `workspace-write` | 可写工作区 + 额外根 + 临时区 |
| **`danger-full-access`** | **绕过隔离**：消费方直接 spawn 原始 argv，**不调** `ctx.sandbox` |

只管文件系统效果；不管网络/进程。升权梯子顶端，不能再 wider。

### 作为 permission preset

同名预设 = 上述 sandbox 模式 + **`approval: never`**（Full file access without approval prompts）。

---

## 4. 原理：写通路径

`ctx.permissionPresets.set(session, name)`（[`#L398`](../packages/interaction/permission-presets/src/index.ts#L398)）：

1. 查表 `{ sandbox, approval }`
2. 只改有变化的旋钮 → `setSandboxMode` / `setApprovalPolicy`（或 live `approval.setPolicy`）
3. 预设身份变了才追加 **`permission/preset`**（记意图）

读：`current(session)` 折叠 `permission/preset` + `sandbox/mode` + `approval/policy`；对不上 → `custom`。
进程级 `catalog()`：UI 可选列表；Auto 注册/移除发 `permission-presets/catalog-changed`。

---

## 5. 实际怎么用 / 如何生效

**组合（base 已挂）：**

```yaml
- name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets: { ... }
    defaultPreset: workspace-write
```

需要：能报 `sandboxMode` 的 bash 执行器 + `ctx.approval` + agents/sessions/projections。

**用户：** Web Permissions UI；`/permission` / `/permission workspace-write`。

**生效链：**

```text
新 Agent → agent/created（prepend）固定默认预设 → 写两旋钮 + permission/preset
用户切换 → set() → 更新旋钮事件
工具调用 → sandboxPolicy.resolve / approval.effectivePolicy 读生效值
模型 → 间接看到审批策略文案与沙箱策略文案（不是 raw permission/preset）
```

恢复会话：保留已有权限事实；缺啥补啥，不用最新用户默认覆盖。

---

## 与 [30](./30-approval.md) 的分工

| 包 | 角色 |
|---|---|
| permission-presets | **选哪个捆绑**（UX + 会话固定） |
| user-approval / sandbox-policy | **真正闸门与执行** |

---

## 还没搞懂

1. 本机 UI `/permission` 切换后 session 事件与模型 runtime-context 一次对照。
2. 委派子会话 pin `never` 与 Auto 显示匹配的边界用例。

## 读代码最短路径

1. [permission-presets README](../packages/interaction/permission-presets/README.zh.md) + [`set` / `current`](../packages/interaction/permission-presets/src/index.ts)
2. [sandbox 子系统](../docs/subsystems/sandbox.zh.md) `SandboxMode`；总览 [32](./32-sandbox.md)
3. 审批消费 [30](./30-approval.md)
