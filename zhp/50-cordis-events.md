# Cordis 事件分发：bail / serial 与其它模式

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@716de6c091` |
| 证据 | 源码；对照 [`docs/cordis-tutorial/04-events.zh.md`](../docs/cordis-tutorial/04-events.zh.md)、[`docs/cordis-api/events.zh.md`](../docs/cordis-api/events.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Loader／mixin 对照 [10](./10-cordis-boot-loader.md)；`ctx.on` 的清理账对照 [51](./51-cordis-effect.md)；waterfall 实务对照 [30](./30-approval.md)、[13](./13-llm-implementation.md)；Session 日志事件对照 [12](./12-session-implementation.md)（那是落盘词汇，不是 Cordis 分发）。

## 一句话

**`bail` 与 `serial` 同一套「按序跑 → `isBailed` 则停并返回」；差别几乎只有同步 `apply` vs `await apply`。选哪个看该事件的监听器能不能异步，并由事件声明的 `@mode` 固定，不在调用点临时猜。**（源码）

---

## 1. 五种 DispatchMode

权威实现：[`vendor/cordis/src/events.ts`](../vendor/cordis/src/events.ts)（`DispatchMode` 约 [#L31](../vendor/cordis/src/events.ts#L31)；分发体约 [#L203–L261](../vendor/cordis/src/events.ts#L203)）。

| 模式 | 调用 | 行为 |
|---|---|---|
| `emit` | `ctx.emit(name, …)` | 同步挨个调用；**忽略**返回值；不 `await` |
| `parallel` | `await ctx.parallel(…)` | 并发跑完所有监听器（都 settled） |
| `serial` | `await ctx.serial(…)` | **按序 `await`**；第一个 bail 值停下并返回 |
| `bail` | `ctx.bail(…)` | **同步按序**；第一个 bail 值停下并返回（serial 的同步版） |
| `waterfall` | `ctx.waterfall(…)` / 常 `await` | 末参是 `next`；不调 `next()` 则短路整条链 |

注册一律 `ctx.on` / `ctx.once`（[#L294](../vendor/cordis/src/events.ts#L294)）；底层是 `fiber.effect`，Fiber unload 时自动撤监听（[51](./51-cordis-effect.md)）。分发模式是**发事件一方**选的，不是注册 API 的参数。

---

## 2. `isBailed`：什么叫「停」

```12:14:vendor/cordis/src/events.ts
export function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined
}
```

- `null` / `false` / `undefined` → **不算** bail，继续下一个监听器。
- 其它任何值（含 `true`、对象、**未 await 的 Promise**）→ 停下并作为分发返回值。

因此：监听器若返回 Promise，而分发用的是 `bail`，Promise **对象本身**会被当成 bail 值立刻停住——通常是错的。有异步必须用 `serial`。

---

## 3. bail vs serial：实现对照

```214:234:vendor/cordis/src/events.ts
  async serial(...args: any[]) {
    const [thisArg, callbacks] = this._resolve('serial', args)
    for (const callback of callbacks) {
      const result = await Reflect.apply(callback, thisArg, args)
      if (isBailed(result)) return result
    }
  }

  bail(...args: any[]) {
    const [thisArg, callbacks] = this._resolve('bail', args)
    for (const callback of callbacks) {
      const result = Reflect.apply(callback, thisArg, args)
      if (isBailed(result)) return result
    }
  }
```

| | `bail` | `serial` |
|---|---|---|
| 调用监听器 | 同步 `apply` | `await apply` |
| 分发函数 | 同步返回 | 返回 `Promise` |
| 停判 | 同一 `isBailed` | 同一 `isBailed` |
| 顺序 | 注册序（`prepend` 可插队） | 同左 |

**结论（对话核实）：** 其它语义完全一样；主标准是监听器里有没有必须 `await` 的工作。

选型：

1. **全员同步** → `bail`（调用方也要同步拿到结果）。
2. **任一可能 `async` / 返回 Promise** → 必须 `serial`。
3. **由事件声明锁定**：JSDoc `@mode bail|serial|…`；调用方与所有 `ctx.on` 跟声明走。
4. **`serial` ≠「一定要 bail」**：可以全员返回 `undefined`，只用来排队跑完副作用。

官方教程原话：bail =「serial 的同步版本」（[`04-events.zh.md`](../docs/cordis-tutorial/04-events.zh.md) 表行）。

---

## 4. DSH 例子

### 4.1 `serial`：生命周期排队（可不 bail）

`agent/created`：`@mode serial`，返回类型约定 `undefined | Promise<undefined>`（[`runtime-types.ts#L288–L290`](../packages/core/agent/src/runtime-types.ts#L288)）。

Registry `announce` 里：

```564:568:packages/core/agent/src/index.ts
      await this.ctx.serial(entry.carrier, 'agent/created', {
        agent: entry.agent,
        source,
        ...signal === undefined ? {} : { signal },
      })
```

用意：按序等监听器做完异步初始化；**不指望**谁返回决策值。同类还有 `agent/turn-stopping`（`@mode serial`，[#L415](../packages/core/agent/src/runtime-types.ts#L415)）。

### 4.2 `bail`：同步认领／拦截

斜杠输入：第一个返回 `true` 的监听器表示「已处理」：

```487:496:packages/client/ui-input-trigger/src/client/controller.ts
      return actx.bail(actx, 'slash/input-begin-command', { claim: outcome.claim, span }) === true
    …
      return actx.bail(actx, 'slash/input-insert-text', { … }) === true
    …
    return actx.bail(actx, 'slash/input-insert-reference', { reference: outcome.insert, span }) === true
```

这里要**同步**知道是否有人认领，故用 `bail` 而非 `serial`。

### 4.3 其它模式（对照，不展开）

| 模式 | DSH 常见用途 | 笔记 |
|---|---|---|
| `emit` | 通知类（如若干 `agent/*` 生命周期旁路） | 火后不管返回值 |
| `waterfall` | 一条链一个最终决策／变换（审批、`llm/stream`、`agent/request`） | [30](./30-approval.md)、[13](./13-llm-implementation.md)；**必须 `next()`** 才委托 |
| `parallel` | 互不依赖的异步旁路 | 用得较少；与 serial 的「排队」相对 |

---

## 5. 和「Session 事件」别混

| | Cordis `ctx.emit` / `bail` / … | Session 日志事件 |
|---|---|---|
| 平面 | 进程内插件总线 | 可恢复的 append-only 日志 |
| 笔记 | **本篇** | [12](./12-session-implementation.md)、[06](./06-session-and-resume.md) |
| 关系 | 模型可见输入须可从 session 重建（AGENTS：model-visible ⟺ logged）；Cordis 分发本身不落盘 |

---

## 还没搞懂

1. `_resolve` 里 `thisArg`／filter／scope 如何裁剪监听器列表（对照 [23](./23-scope.md)）。
2. `internal/listener` 上 `on` 自身又走 `bail`（[#L302](../vendor/cordis/src/events.ts#L302)）的拦截约定。
3. 仓库里 `@mode` 与真实调用是否有漏标／错配的门禁。
