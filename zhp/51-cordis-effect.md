# Cordis `ctx.effect`：注册与最终清理

| | |
|---|---|
| 状态 | 学习中（源码走读） |
| 日期 | 2026-11-27 |
| 基线 | `zhp@91012f0c63` |
| 证据 | 源码；对照 [`docs/cordis-api/fiber.zh.md`](../docs/cordis-api/fiber.zh.md)、primer「注册是可逆的副作用」 |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Fiber／Loader 对照 [10](./10-cordis-boot-loader.md)；事件分发对照 [50](./50-cordis-events.md)；plugin 形态对照 [20](./20-plugin-and-service.md)。

## 一句话

**`ctx.effect` 把 cleanup 记在当前插件 Fiber 的 `_disposables`；最终要么手动调返回的 disposer，要么 Fiber unload 时按注册逆序 `await` 跑完——嵌套 effect／`ctx.on`／`provide` 都走同一条账。**（源码）

---

## 1. 归属：`ctx.effect` ≡ `fiber.effect`

[`ReflectService`](../vendor/cordis/src/reflect.ts) mixin：`this.mixin('fiber', ['runtime', 'effect'])`（约 [#L234](../vendor/cordis/src/reflect.ts#L234)）。

每次注册挂在 **`ctx.fiber`**（当前插件实例），不是全局表。已 disposed / `UNLOADING` 再注册 → `CordisError('INACTIVE_EFFECT')`（[`assertActive`](../vendor/cordis/src/fiber.ts#L357)、[`effect` 入口](../vendor/cordis/src/fiber.ts#L424)）。

---

## 2. 注册时发生什么

[`Fiber.effect`](../vendor/cordis/src/fiber.ts#L424)：

1. **立刻**跑 `execute()`（[`_execute`](../vendor/cordis/src/fiber.ts#L362)）。
2. 返回值收成 disposer（`Effect` 形状，[#L83–L93](../vendor/cordis/src/fiber.ts#L83)）：
   - 单个清理函数
   - `Promise<disposer>`
   - sync / async generator（`yield` 多个，边产边收）
3. 包一层 **wrapper disposer**，推进 `fiber._disposables`（[#L526](../vendor/cordis/src/fiber.ts#L526)）。
4. **返回 wrapper**：调它 = 提前拆掉这个 effect（幂等）。

`Disposable` 注释约定：unload 时 **逆序**；可为 async，unload 会 `await`（[#L69–L72](../vendor/cordis/src/fiber.ts#L69)）。

### 嵌套 effect

外层 `execute` 期间再 `ctx.effect` / `ctx.on` / `provide`：内层 disposer 会被 **从 fiber 列表挪进外层本地数组**（`collect`：`push` + `_disposables.delete`，[#L454–L456](../vendor/cordis/src/fiber.ts#L454)）。外层清理时按本地数组 **逆序**串跑，诊断树挂在 `wrapper[symbols.effect].children`。

---

## 3. 两条清理路径

| 触发 | 路径 |
|---|---|
| **手动** | 调 `effect()` 返回值 → 本地 `disposables.splice(0).reverse()` → `runDisposable`（[#L433–L447](../vendor/cordis/src/fiber.ts#L433)） |
| **Fiber 卸载** | `fiber.dispose()` → `_setEpoch(INACTIVE)` → `_unload()` → `_disposables.clear()`（已 reverse）→ 每个 wrapper `await runDisposable`（[#L712–L730](../vendor/cordis/src/fiber.ts#L712)） |

`DisposableList.clear()`：先 reverse 再清空（[`utils.ts#L27–L30`](../vendor/cordis/src/utils.ts#L27)）→ **后注册先清**。

`_unload` 额外约束：本 fiber 提供的服务，**所有 dependents 先卸完** 才清自己的 effects（[#L713–L718](../vendor/cordis/src/fiber.ts#L713)）。清理错误打 `ctx.logger.error`，不把 unload Promise 打成 reject（同段）。

```
ctx.effect(() => { …; return cleanup })
        │
        ▼
  fiber._disposables  ←── wrapper
        │
   ┌────┴────┐
手动 dispose()   fiber.dispose() → _unload()
   逆序 cleanup     逆序跑全部 wrapper（可 await）
```

---

## 4. 谁触发 `fiber.dispose`

插件 fiber 的 `dispose` **本身是挂在父 fiber 上的 effect**（label `ctx.plugin()`，[#L271–L303](../vendor/cordis/src/fiber.ts#L271)）：

1. 从 runtime 纤维列表移除、`emit internal/plugin`
2. `_setEpoch(INACTIVE)` → 必要时显式 `_unload`
3. `while (inertia) await` 直到卸完

因此常见链路：

| 场景 | 效果 |
|---|---|
| 父插件 unload | 子 `dispose` 被跑 → 子 unload → 子 `_disposables` 全清 |
| Loader disable / HMR 换插件 / registry 卸掉 | 同一条链 |
| 进程退出 | 根树一路 dispose（视启动器如何关） |

根 fiber（无 runtime）另有简化路径（[#L326–L338](../vendor/cordis/src/fiber.ts#L326)）；日常插件侧记「父 effect 拥有子 dispose」即可。

---

## 5. 与 `ctx.on` / `provide` 同源

| API | 底层 | 清理做什么 |
|---|---|---|
| `ctx.on` / `once` | `fiber.effect`（[`events.ts#L265–L269`](../vendor/cordis/src/events.ts#L265)） | 从 hooks 表 `unregister` |
| `ctx.provide` / accessor / mixin | `fiber.effect`（[`reflect.ts`](../vendor/cordis/src/reflect.ts) 约 L292+） | 撤服务／访问器 |
| `ctx.plugin` | 父 `fiber.effect` | 卸子 fiber |

AGENTS／primer：**注册是可逆的副作用**——贡献必须经 `ctx.effect()` / `ctx.on()`，reload／teardown 才能按账撤销。

---

## 还没搞懂

1. `effectInertia`／`inFlight` 与「外层 join 已开始的清理」在并发 unload 下的完整时序（[#L110–L117](../vendor/cordis/src/fiber.ts#L110)、[#L521](../vendor/cordis/src/fiber.ts#L521)）。
2. `_setEpoch` 依赖变更导致 unload→reload 时，effects 是否整表拆再建、与 volatile config 更新的边界。
3. 根 fiber `dispose = () => restart()` 与进程退出关树的实际调用点（对照 [07](./07-startup.md)／Loader）。
