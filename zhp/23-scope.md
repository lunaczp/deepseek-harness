# Scope：身份、父链与按 agent 的贡献隔离

| | |
|---|---|
| 状态 | 学习中（源码走读；无本机多 agent 实测） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@89f14d6390` |
| 证据 | 源码；权威见 [`dsh-scope` README.zh](../packages/core/scope/README.zh.md)、[`docs/subsystems/scope.zh.md`](../docs/subsystems/scope.zh.md)、[`agent-loop` README.zh](../packages/core/agent-loop/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。工具如何按 scope 选执行器 → [17](./17-tools.md)、[24](./24-ptc.md)；seam 用语 → [19](./19-seam-and-service.md)。

## 一句话

**`ScopeKey` 是不透明对象身份；通过 `createScope` 打上标签的 `ctx` 同时表达「谁看得见这些贡献」与「谁 dispose 时拆掉」。没有固定枚举名——部署根 / preset / Agent 只是常见用法。**（源码）

---

## 1. 不是什么

| 误解 | 实际 |
|---|---|
| 字符串标签 / 枚举（`agent`/`preset`） | `type ScopeKey = object`，比的是引用（[`scope` L15](../packages/core/scope/src/index.ts)） |
| 沙箱或权限边界 | 只隔离**插件注册贡献**；权限仍看 sandbox / approval（[03](./03-sandbox-and-permissions.md)） |
| 任意 `ctx.xxx` 自动按 agent 分叉 | 只有感知 scope 的注册表（`scopeOf` / `ScopedLayers`）才隔离；普通 Cordis Service 仍是上下文全局 |

---

## 2. 常见三层（交付用法）

| 层 | Key 怎么来 | 典型贡献 |
|---|---|---|
| **部署根** | `scopeOf(ctx) === undefined`，插件挂全局 `ctx` | base 的 `tool-executor-native`、全局 `tools.register` |
| **Preset / 分组** | `createScope(owner, presetKey)`；agent 可 `bindScopeParent(agent, presetKey)` | 一组插件共用一套 executor / 工具面（web preset） |
| **Agent** | `createScope(loopCtx, this)`，**key = Agent 实例**（[`agent.ts` L147](../packages/core/agent-loop/src/agent.ts#L147)） | 该会话的限制、影子工具、覆盖执行器 |

父链：`bindScopeParent` / `createScope(..., { parent })`；`scopeChainOf` = `[self, parent, …]`，近的在前（[`scope` README · 父链](../packages/core/scope/README.zh.md)）。

```text
注册视图：子看得见祖先层（近的遮蔽）
事件放行：标签为祖先的监听器也能收到后代事件
dispose：拆掉本 scope 拥有的一切注册
```

---

## 3. 对 tools / executor 的含义

[`ToolsService.selectExecutor`](../packages/core/tools/src/index.ts#L357)：沿 `scopeChainOf` 找最近一层的 `setExecutor`，否则部署根；**卸掉后不回落**到别的执行器。

- 每 scope **只能一个** executor（再挂抛错）。
- 不同 agent 可绑不同 parent / 自挂不同 executor → 一个 PTC、一个 Native 可以并存于同进程。
- `restrict` 只掩**全局**名；scoped 注册仍可见。

详解交付模式差异 → [24](./24-ptc.md)。

---

## 4. API 地图（读代码）

| API | 作用 |
|---|---|
| `createScope(ctx, key)` | 铸造带标签的 `Scope.ctx` + `dispose` |
| `scopeOf(ctx)` | 读最近标签 |
| `bindScopeParent` / `scopeChainOf` | 父链 |
| `scopeTarget` | 带作用域事件载体 |
| `ScopedLayers` | 全局层 + 惰性 scope 层；`merge` / `effect`（[`store.ts`](../packages/core/scope/src/store.ts)） |

preset 注册表侧：[`agent-preset-registry`](../packages/preset/agent-preset-registry/src/index.ts) 也会 `createScope`。

---

## 还没搞懂

1. web 各 preset 挂载时，agent↔preset 父链的本机一次真实装配对照。
2. 嵌套 `createScope(outer.ctx, innerKey)` 与 `bindScopeParent` 在产品路径上是否常用。

## 读代码最短路径

1. [scope README.zh](../packages/core/scope/README.zh.md) + [subsystems/scope.zh.md](../docs/subsystems/scope.zh.md)
2. [`agent.ts` L147](../packages/core/agent-loop/src/agent.ts#L147) → `agent.ctx`
3. [`tools` `setExecutor` / `selectExecutor`](../packages/core/tools/src/index.ts#L325)
