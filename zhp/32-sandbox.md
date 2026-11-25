# 进程沙箱 seam：作用、使用、实现与策略/机制分离

| | |
|---|---|
| 状态 | 学习中（源码走读；本机实测仍见 [03](./03-sandbox-and-permissions.md)） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@ef186b59b1` |
| 证据 | 源码；权威见 [`packages/sandbox/`](../packages/sandbox/README.zh.md)、[`docs/subsystems/sandbox.zh.md`](../docs/subsystems/sandbox.zh.md)、[`docs/capability-seams.zh.md`](../docs/capability-seams.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。实测边界 [03](./03-sandbox-and-permissions.md)；argv 拼接 [17c](./17c-sandbox-local.md)；审批升权 [30](./30-approval.md)；权限预设 [31](./31-permission-presets.md)；计划模式（软指引，正交）[33](./33-plan-mode.md)。

## 一句话

**Sandbox = 同宿主内核上的文件效果隔离：`sandbox-policy` 解析「这次允许多宽」，`sandbox`/`sandbox-local` 落实「怎么包 argv」；`danger-full-access` 显式绕过。不是容器，也不是审批本身。**（源码）

---

## 1. 作用（是 / 不是）

| | |
|---|---|
| **是** | 按模式限制子进程文件写入；无法强制则 `SANDBOX_UNAVAILABLE` fail-closed |
| **不是** | 容器 / microVM（整组能力替换） |
| **不是** | `ctx.approval`（人审；升权会调用它 → [30](./30-approval.md)） |
| **不是** | permission-presets（捆旋钮 UI → [31](./31-permission-presets.md)） |

词表只覆盖**文件系统效果**；网络、进程可见性不在内。

**模式**（[`SandboxMode`](../packages/sandbox/sandbox/src/index.ts)）：

| 模式 | 行为 |
|---|---|
| `read-only` | 拒写 |
| `workspace-write` | 可写工作区 + 额外根 + 临时区 |
| `danger-full-access` | 不调 `ctx.sandbox`，原 argv spawn |

升权梯子：`read-only` → `workspace-write` → `danger-full-access`（更宽经 `approveEscalation`）。

---

## 2. 包地图与两个 `ctx`

| 包 | 职责 | ctx |
|---|---|---|
| [`sandbox`](../packages/sandbox/sandbox/) | 模式、`confine` 抽象、升权词汇 | 定义 `ctx.sandbox` |
| [`sandbox-policy`](../packages/sandbox/sandbox-policy/) | 部署默认 + 会话覆盖 + `resolve()` | **`ctx.sandboxPolicy`** |
| [`sandbox-local`](../packages/sandbox/sandbox-local/) | 本机 runner | 注册到 `ctx.sandbox` |
| [`sandbox-windows-acl`](../packages/sandbox/sandbox-windows-acl/) | Win 受限令牌 | 由 local 挂 |

消费方：`bash-sandbox` / `pwsh-sandbox` / `fs-sandbox` / `terminal-bash`；远端 `sandbox-ssh`。

- **bash**：`confine` → 平台包装 argv → subprocess spawn
- **fs**：进程内路径围栏，**共用**同一 `sandboxPolicy`，不走 `confine`

---

## 3. 使用

**组合（base）：** `sandbox-local` + `sandbox-policy` + `bash-sandbox` + `fs-sandbox`；常配 presets。默认 mode 常来自 `DSH_PERMISSION_MODE` / preset。

**用户：** Permissions 切预设 → 写 `sandbox/mode`；模型可申请 `sandbox_permissions` + justification（一次性更宽，常需人审）。

**执行器模式：**

```text
policy = ctx.sandboxPolicy.resolve({ session })  // 或升权后 mode
if danger-full-access → 直接执行
else → confined = await ctx.sandbox.confine(argv, policy) → spawn
```

---

## 4. 实现（关键链路）

```text
tool-bash
  → resolve / approveEscalation
  → bash-sandbox
       → ctx.sandbox.confine
            → sandbox-local 选 runner
                 Linux: bwrap → Landlock
                 macOS: sandbox-exec + Seatbelt
                 Windows: ACL 受限令牌（常 partial）
            → 包装 argv → subprocess
```

`enforcement`：`full` | `partial`——partial 时不能当绝对边界。

平台 argv 细节 → [17c](./17c-sandbox-local.md)；本机读写实测 → [03](./03-sandbox-and-permissions.md)。

---

## 5. 策略与实现分离：是不是经典模式

**很接近经典思路，不单等于某一个 GoF 名。**

| 说法 | 贴合度 |
|---|---|
| **Policy vs Mechanism**（OS/安全：策略与机制分离） | ✅✅ `sandbox-policy` 定「允许多宽」；local/runner 定「怎么限制」 |
| **Strategy** | ✅ `confine` 接口下可换 bwrap/Landlock/Seatbelt/ACL |
| **共享策略归属** | ✅ bash 与 fs 同一 `resolve`，避免两套边界 |
| 「仅此一个设计模式」 | ❌ |

DSH 用语是 **capability seam**（Definition / Provider / Consumer）：`sandbox` 定义机制，`sandbox-local` 为 Provider，bash/fs 为 Consumer；`sandbox-policy` 是横切的**策略归属服务**（capability 表里偏 core，非多 Provider 注册表）。

Presets / approval 更外层捆 UI 与人审；机制仍读 policy 事件。

---

## 还没搞懂

1. Seatbelt 依赖弃用 `sandbox-exec` 的长期替代。
2. Windows partial 与 `additionalWritableRoots` 对子进程的限制边界深读。
3. 环境一致能力组（同容器上配对 bash+fs）示例是否落地。

## 读代码最短路径

1. [sandbox 子系统](../docs/subsystems/sandbox.zh.md) + [组 README](../packages/sandbox/README.zh.md)
2. [`sandbox` confine 抽象](../packages/sandbox/sandbox/src/index.ts) + [`sandbox-policy` resolve](../packages/sandbox/sandbox-policy/src/index.ts)
3. [`sandbox-local`](../packages/sandbox/sandbox-local/src/index.ts) + [`bash-sandbox`](../packages/shell/bash-sandbox/src/index.ts)
4. 升权：[`escalation.ts`](../packages/sandbox/sandbox/src/escalation.ts)
