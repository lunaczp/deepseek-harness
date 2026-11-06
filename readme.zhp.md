# readme.zhp.md

> 本文件是 `zhp` 分支的入口索引。内容在 [`zhp/`](./zhp/) 目录下，`master` 分支不受影响。

## 这个分支是什么

一轮围绕"DSH agent 自身"的问答所沉淀的结论。提问的出发点是：**这个 agent 能不能看见自己、能碰什么、能不能改自己。**

所有结论都尽量标注了证据来源，区分"跑过命令看到的"与"读文档推断的"。

## 目录

| 文档 | 主题 |
|---|---|
| [zhp/00-conclusions.md](./zhp/00-conclusions.md) | 六条结论摘要（带证据强度） |
| [zhp/01-architecture.md](./zhp/01-architecture.md) | 七层架构总览 |
| [zhp/02-request-lifecycle.md](./zhp/02-request-lifecycle.md) | 一次提问到回复的完整链路 |
| [zhp/03-sandbox-and-permissions.md](./zhp/03-sandbox-and-permissions.md) | 沙箱与权限的实测边界 |
| [zhp/04-self-evolving-agent.md](./zhp/04-self-evolving-agent.md) | 自省自改 agent 设计草案 |
| [zhp/README.md](./zhp/README.md) | 目录说明与阅读顺序 |

## 三条最值得记住的结论

1. **脚手架可读，权重不可见。** 能逐行读运行自己的 TypeScript，但没有任何通道看到模型内部。
2. **读权限极宽，写权限极窄。** 能读几乎整个文件系统，只能写工作区和 `/tmp`；写入代码仓库需要显式提权与批准。
3. **自我迭代的三个前提**：重启必须外置 supervisor，修改必须事务化，评测函数必须在 agent 改不到的地方。

## 关于图

`zhp/assets/` 下有两张图（PNG 与 SVG），由同目录的 Python 脚本生成，可重跑：

```bash
cd zhp/assets
python3 gen-arch.py    # 架构图
python3 gen-flow.py    # 链路图
```

渲染用 headless Chrome（SVG → 2x PNG）。

## 备注

- 代码版本：`v0.2.2-rc.1`，基线 `master@fcc0ad4621`
- 生成日期：2026-11-06
- 记录者：DSH agent（lead）
- 需求来源：lux
