#!/usr/bin/env python3
"""Render the DSH request lifecycle flow diagram (SVG -> PNG via Chrome)."""

W = 1680
M = 40
LANE_W = 150
BOX_X = M + LANE_W + 12
BOX_W = W - BOX_X - M - 130
ROW_H = 92
BOX_H = 76

BG = "#0B0E14"
BOX = "#121722"
BORDER = "#2A3446"
TITLE = "#EEF3FF"
DIM = "#7C8CA8"
MONO = "#93A5C4"

LANES = {
    "client": ("#4D6BFE", "客户端\nChrome"),
    "host": ("#2FBBA0", "宿主进程\nNode"),
    "remote": ("#E0A34E", "远端\nDeepSeek"),
}

STAGES = [
    ("client", "① 用户输入", "apps/web → gateway", "你在 GUI 里发送；走 WebSocket 帧，不是 HTTP 表单"),
    ("host", "② 入队并唤醒", "agent.ts:170 send()", "inbox.splice() 写入待处理队列，wakeDriver() 拉起 run()"),
    ("host", "③ 开一轮", "agent.ts:336 turn()", "session.append('turn/start')；一轮 = 若干 step"),
    ("host", "④ 组装上下文", "agent.ts:283 preStep()", "tools.resolve() + systemPrompt.assemble() + runtimeContext.project()"),
    ("host", "⑤ 发请求", "agent.ts:435 prepareRequest()", "renderPrompt → request/header 落盘 → llm.stream(request)"),
    ("remote", "⑥ 模型生成", "llm/llm-deepseek", "流式吐 chunk；这一步我无法自省，只拿到输出"),
    ("host", "⑦ 落盘并推送", "agent.ts:505 live.push()", "assistant/message 写入会话日志，同时增量推给前端"),
    ("host", "⑧ 执行工具", "tool-executor-native", "tool_use → 工具实现 → 沙箱包装 → tool/result 回填"),
    ("host", "⑨ 收轮与渲染", "agent.ts:388/422", "无工具调用 → step/end → turn/end；前端 Markdown 渲染"),
]


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


parts = []
y = 24

parts.append(
    f'<rect x="0" y="0" width="{W}" height="100%" fill="{BG}"/>'
    f'<text x="{M}" y="{y + 22}" fill="{TITLE}" font-family="PingFang SC,Helvetica Neue,sans-serif" '
    f'font-size="25" font-weight="700">一次提问到回复的完整链路</text>'
    f'<text x="{M}" y="{y + 46}" fill="{MONO}" font-family="SF Mono,Menlo,monospace" font-size="11.5">'
    f'packages/core/agent-loop/src/agent.ts · turn / step 双层循环</text>'
)
y += 70

positions = {}
for i, (lane, title, ref, detail) in enumerate(STAGES):
    color, label = LANES[lane]
    y0 = y + i * ROW_H
    positions[i] = y0

    # lane label (only first of each run)
    prev_lane = STAGES[i - 1][0] if i > 0 else None
    if lane != prev_lane:
        parts.append(
            f'<text x="{M}" y="{y0 + 30}" fill="{color}" font-family="PingFang SC,sans-serif" '
            f'font-size="12" font-weight="600">{esc(label.split(chr(10))[0])}</text>'
            f'<text x="{M}" y="{y0 + 46}" fill="{DIM}" font-family="PingFang SC,sans-serif" '
            f'font-size="10.5">{esc(label.split(chr(10))[1])}</text>'
        )

    parts.append(
        f'<rect x="{BOX_X}" y="{y0}" width="{BOX_W}" height="{BOX_H}" rx="10" '
        f'fill="{BOX}" stroke="{BORDER}" stroke-width="1"/>'
        f'<rect x="{BOX_X}" y="{y0}" width="4" height="{BOX_H}" rx="2" fill="{color}" opacity="0.9"/>'
        f'<text x="{BOX_X + 22}" y="{y0 + 30}" fill="{TITLE}" '
        f'font-family="PingFang SC,sans-serif" font-size="16" font-weight="600">{esc(title)}</text>'
        f'<text x="{BOX_X + 22}" y="{y0 + 53}" fill="{color}" '
        f'font-family="SF Mono,Menlo,monospace" font-size="11">{esc(ref)}</text>'
        f'<text x="{BOX_X + 300}" y="{y0 + 53}" fill="{MONO}" '
        f'font-family="PingFang SC,sans-serif" font-size="11.5">{esc(detail)}</text>'
    )

    # connector down
    if i < len(STAGES) - 1:
        cx = BOX_X + 22
        parts.append(
            f'<path d="M {cx} {y0 + BOX_H} L {cx} {y0 + ROW_H - 4}" stroke="{BORDER}" stroke-width="1.5"/>'
            f'<path d="M {cx - 4} {y0 + ROW_H - 10} L {cx} {y0 + ROW_H - 3} L {cx + 4} {y0 + ROW_H - 10}" '
            f'fill="none" stroke="{BORDER}" stroke-width="1.5"/>'
        )

# loop-back arc: stage 8 (index 7) back to stage 4 (index 3)
top = positions[3] + BOX_H / 2
bottom = positions[7] + BOX_H / 2
lx = BOX_X + BOX_W
parts.append(
    f'<path d="M {lx} {bottom} L {lx + 26} {bottom} L {lx + 26} {top} L {lx} {top}" '
    f'fill="none" stroke="#4D6BFE" stroke-width="1.6" stroke-dasharray="6 5" opacity="0.85"/>'
    f'<path d="M {lx + 8} {top - 5} L {lx + 1} {top} L {lx + 8} {top + 5}" fill="none" '
    f'stroke="#4D6BFE" stroke-width="1.6" opacity="0.85"/>'
)
mid = (top + bottom) / 2
parts.append(
    f'<text x="{lx + 34}" y="{mid - 6}" fill="#6E83B8" font-family="PingFang SC,sans-serif" font-size="10.5">'
    f'有工具调用</text>'
    f'<text x="{lx + 34}" y="{mid + 10}" fill="#6E83B8" font-family="PingFang SC,sans-serif" font-size="11">'
    f'→ 下一 step</text>'
)

y = y + len(STAGES) * ROW_H + 18

# footnote panel
parts.append(
    f'<rect x="{M}" y="{y}" width="{W - 2 * M}" height="102" rx="10" fill="#0E1420" stroke="#2A3346"/>'
    f'<text x="{M + 22}" y="{y + 28}" fill="{TITLE}" font-family="PingFang SC,sans-serif" font-size="14" '
    f'font-weight="600">关键点</text>'
    f'<text x="{M + 22}" y="{y + 52}" fill="{MONO}" font-family="PingFang SC,sans-serif" font-size="12">'
    f'· 没有「一次性的我」：每一轮回答都是 step⑥ 的一次独立请求，step④ 每步重装一次上下文。</text>'
    f'<text x="{M + 22}" y="{y + 72}" fill="{MONO}" font-family="PingFang SC,sans-serif" font-size="12">'
    f'· 我的「思考」在 ⑥ 内部（远端、不可见）；其余每一步都是本地可读的 TS 代码。</text>'
    f'<text x="{M + 22}" y="{y + 92}" fill="{MONO}" font-family="PingFang SC,sans-serif" font-size="12">'
    f'· 会话日志（turn/step/tool/assistant 事件）在每一步落盘，所以重启后能 resume。</text>'
)
y += 102 + 20

H = int(y)
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
    + "".join(parts) + "</svg>"
)

path = "/Users/lux/Documents/deepseek-harness/default-workspace/request-lifecycle.svg"
with open(path, "w") as f:
    f.write(svg)
print(f"ok {W}x{H}")
