# Skill seam：`ctx.skills`、多 Provider 与首次发现

| | |
|---|---|
| 状态 | 学习中（源码走读；本机未实测加盘 skill / Office 加载） |
| 日期 | 2026-11-25 |
| 基线 | `zhp@a66fbdc124` |
| 证据 | 源码；权威见 [`packages/skill/`](../packages/skill/README.zh.md)、[`docs/subsystems/skills.zh.md`](../docs/subsystems/skills.zh.md)、[`docs/capability-seams.zh.md`](../docs/capability-seams.zh.md)、[`dsh-skill`](../packages/skill/skill/README.zh.md)、[`skill-filesystem`](../packages/skill/skill-filesystem/README.zh.md)、[`tool-skill`](../packages/skill/tool-skill/README.zh.md) |

> 证据约定：**实测** = 本机跑过；**源码** = 读仓库确认；**日志** = 系统/内核日志；**二手** = 外部文档；**推断** = 尚未验证。
> **跳转**见 [05](./05-workspace-conventions.md)。Seam 用语 [19](./19-seam-and-service.md)；工具流水线 [17](./17-tools.md) / [17e](./17e-tool-pipeline.md)；GUI Remote [26](./26-typert.md)。

## 一句话

**Skill seam = `ctx.skills` 合并多来源目录 + 按需加载正文；模型侧只有固定 loader 工具 `skill`，目录是持久 user 消息摘要，不是 conditional tool，也不是启动时一次扫盘。**（源码）

---

## 1. 能力缝三角

| 角色 | 包 | `ctx` |
|---|---|---|
| Definition | [`dsh-skill`](../packages/skill/skill/) | `ctx.skills`（`SkillRegistry`） |
| Provider | filesystem / office / badge / windows-acl | `registerProvider` |
| Consumer | [`tool-skill`](../packages/skill/tool-skill/) | 注册 `ctx.tools` 的 `skill`；GUI 另有 `ctx.sessionSkillCatalog` |

注册表本身不含内容；模型访问还需 Consumer。核心类型：[`skill/src/index.ts`](../packages/skill/skill/src/index.ts) 的 `SkillInvocationPolicy`、`SkillSummary` / `SkillDefinition`、`SkillProvider`（约 #L49–#L92、Provider 契约见子系统文档）。

分层与 tools 同形：宿主层 + agent scope 层；近层同名直接赢，层内 `rank → Provider 注册顺序`。

---

## 2. 多 Provider 可否同时启用

**可以，且产品组合就是并存。**

- 同层 **Provider 名**唯一；重复抛错。`runtime` 留给 `skills.register()`，不能当 Provider 名（[`registerProvider` #L390](../packages/skill/skill/src/index.ts#L390)）。
- **Skill 名**可撞车：跨层近层覆盖；同层 rank（filesystem 项目 100–500 压 office/bundled 600）。
- base：`skill` + `skill-filesystem` + `tool-skill`（[`base/cordis.patch.yml` ~#L313](../packages/bundle/base/cordis.patch.yml)）。
- sdk-app：再加 `skill-office`；win32 可再挂 ACL 诊断 Provider；`skill-badge` 能并存但默认不进交付组合。

**不是 Provider：** [`tool-workspace-dependencies`](../packages/skill/tool-workspace-dependencies/) 往 `ctx.tools` 报告 Office 解释器路径，不调 `registerProvider`。

---

## 3. filesystem：何时扫、扫哪里

**不是启动扫一次。** `apply` 只注册 Provider + WatchManager（[`#L133`](../packages/skill/skill-filesystem/src/index.ts#L133)）。

真正扫盘在 Provider `list()`：

```185:207:../packages/skill/skill-filesystem/src/index.ts
  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    const roots = await this.roots(options.cwd)
    // ... observeRoots → discoverRoot 逐根
```

根列表 [`roots()` #L251](../packages/skill/skill-filesystem/src/index.ts#L251)（默认 `includeDefaultRoots`）：

| Rank | Source | 路径 |
|---|---|---|
| 100 | project-dsh | `<gitRoot>/.dsh/skills`（随 Session cwd 找项目根） |
| 200 | project-agents | `<gitRoot>/.agents/skills` |
| 300 | custom | `Config.customSkillDirs` |
| 400 | user-dsh | `<dshHome>/skills`（跳过 `.system`） |
| 500 | user-agents | `<agentsHome>/skills` |
| 600 | bundled | `bundledSkillDir` / `$DSH_BUNDLED_SKILL_DIR` |

[`discoverRoot` #L737](../packages/skill/skill-filesystem/src/index.ts#L737)：根下**一层**——目录读 `SKILL.md`，文件须 `*.md`；**不递归**。变更靠 Chokidar / `fs/observed` → `invalidate()`，下次 lookup 再扫。

---

## 4. 第一次 `list` / 发现何时发生

**Boot 不 `list`。** 注册表 `list` = `snapshot` → `collect` → 各 Provider `list`（[`skill/src/index.ts` #L470–#L488](../packages/skill/skill/src/index.ts#L470)）。

| 触发方 | 时机 | 调用 |
|---|---|---|
| **默认产品路径** | Agent **第一次**要跑模型步的 `agent/pre-step`，且本插件 `skill` 工具对该 agent **可见** | [`tool-skill` catalog → `skills.snapshot`](../packages/skill/tool-skill/src/index.ts#L225) |
| GUI 更早 | 用户打开 skill 面板 Remote | [`sessionSkillCatalog.list`](../packages/api/session-controller/src/skill-catalog.ts#L36) → `skills.list` |
| `/name` 更早 | 同一步 pre-step，手势监听器**先于** catalog | [`skills.get`](../packages/skill/tool-skill/src/index.ts#L193)（内部也 `collect`） |
| 模型 `skill` 工具 | execute | [`skills.list` + `get`](../packages/skill/tool-skill/src/index.ts#L138) |

工具不可见时 catalog 不 `snapshot`，filesystem 可能一直未扫，直到别的调用方。完整成功的 `collect` 按 cwd/scope/revision 缓存，直到 `invalidate`。

---

## 5. Consumer：目录、工具、手势

[`tool-skill`](../packages/skill/tool-skill/src/index.ts)：

1. 注册 `skill` 工具（#L84–#L165）——精确 `name` → 正文 → `renderSkillContent`。
2. `agent/pre-step` 会话目录——modelInvocable 摘要进持久 user 消息 `<available_skills>`；digest 变则追加替换。
3. `/name`——仅 **userInvocable**；`disable-model-invocation` 的唯一入口。

Skill ≠ conditional tool。渐进加载 = 目录摘要 + 显式 load。改正文不刷目录 digest；改 description / 成员关系才刷。

SKILL.md frontmatter：`name`、`description`、可选 `whenToUse`、`disable-model-invocation`、`user-invocable`。

---

## 6. 边界（易混）

| 易混 | 实际 |
|---|---|
| `ctx.tools` | 只多一个 loader；skill 正文不是工具定义 |
| system prompt | 目录是**持久 user 角色**消息 |
| Typert | `sessionSkillCatalog` 冷列元数据；加载仍在 Host |
| PTC / pipeline | `skill` 走普通工具执行路径（[17e](./17e-tool-pipeline.md)） |

web-app 常在 Host 禁用 filesystem/tool-skill，再在 **preset 层**挂回（scope 分层）。

---

## 还没搞懂

1. web preset 相对 base 的精确 disable/re-enable 对照。
2. Office progressive-loading（router → 子 skill）本机一次加载轨迹。
3. `incomplete: true` 在 session 事件里的落盘字段。

## 读代码最短路径

1. [skills 子系统](../docs/subsystems/skills.zh.md) + [组 README](../packages/skill/README.zh.md)
2. 注册表：[`skill/src/index.ts`](../packages/skill/skill/src/index.ts) `registerProvider` / `snapshot` / `collect`
3. 本地发现：[`skill-filesystem` `list` / `roots` / `discoverRoot`](../packages/skill/skill-filesystem/src/index.ts)
4. 模型面：[`tool-skill` catalog + `skill` tool](../packages/skill/tool-skill/src/index.ts)
5. GUI：[`session-controller/skill-catalog.ts`](../packages/api/session-controller/src/skill-catalog.ts)
