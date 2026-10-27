"""Draws the README diagrams as SVG, a light and a dark version of each.

    python3 docs/media/diagrams.py

Writes docs/media/<name>-light.svg and <name>-dark.svg. Edit the texts here, not in the SVGs.
"""

import os
from xml.sax.saxutils import escape

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

THEMES = {
    "light": dict(card="#FFFFFF", stroke="#D1D9E0", text="#1F2328", muted="#59636E", line="#818B98",
                  accent="#2F6FEB", accent_text="#FFFFFF", accent_soft="#EEF4FF"),
    "dark": dict(card="#151B23", stroke="#3D444D", text="#F0F6FC", muted="#9198A1", line="#7D8590",
                 accent="#4493F8", accent_text="#FFFFFF", accent_soft="#121D2F"),
}


class Svg:
    def __init__(self, w, h, t):
        self.w, self.h, self.t, self.parts = w, h, t, []

    def card(self, x, y, w, h, title, lines=(), num=None, accent=False):
        t = self.t
        fill, stroke = (t["accent_soft"], t["accent"]) if accent else (t["card"], t["stroke"])
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
        tx = x + 20
        if num is not None:
            self.parts.append(f'<circle cx="{x + 32}" cy="{y + 30}" r="13" fill="{t["accent"]}"/>')
            self.parts.append(f'<text x="{x + 32}" y="{y + 35}" text-anchor="middle" font-size="14" font-weight="700" fill="{t["accent_text"]}">{num}</text>')
            tx = x + 54
        self.parts.append(f'<text x="{tx}" y="{y + 36}" font-size="17" font-weight="650" fill="{t["text"]}">{escape(title)}</text>')
        for i, line in enumerate(lines):
            self.parts.append(f'<text x="{x + 20}" y="{y + 66 + i * 20}" font-size="14" fill="{t["muted"]}">{escape(line)}</text>')

    def arrow(self, d, dashed=False):
        dash = ' stroke-dasharray="5 5"' if dashed else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="{self.t["line"]}" stroke-width="2"{dash} marker-end="url(#head)"/>')

    def label(self, x, y, text, anchor="middle", bold=False, color=None, size=14):
        weight = ' font-weight="650"' if bold else ""
        self.parts.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}"{weight} fill="{color or self.t["muted"]}">{escape(text)}</text>')

    def rich(self, x, y, lead, rest_lines):
        """A bold lead word in the text colour, then muted text; extra lines below."""
        t = self.t
        first = rest_lines[0] if rest_lines else ""
        self.parts.append(f'<text x="{x}" y="{y}" font-size="14.5" fill="{t["muted"]}"><tspan font-weight="650" fill="{t["text"]}">{escape(lead)}</tspan> {escape(first)}</text>')
        for i, line in enumerate(rest_lines[1:], 1):
            self.parts.append(f'<text x="{x}" y="{y + i * 21}" font-size="14.5" fill="{t["muted"]}">{escape(line)}</text>')

    def save(self, name, theme):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" font-family="{FONT}">'
                f'<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0 0 L10 5 L0 10 z" fill="{self.t["line"]}"/></marker></defs>')
        with open(os.path.join(OUT, f"{name}-{theme}.svg"), "w") as f:
            f.write(head + "".join(self.parts) + "</svg>\n")


def how_it_works(t):
    s = Svg(960, 270, t)
    cards = [
        ("You", ["Describe the motion", "in plain words"]),
        ("AI agent", ["Claude Code or another", "AI app plans the steps"]),
        ("MCP server", ["Checks every step", "and passes it on"]),
        ("After Effects", ["A small panel builds it", "in your open project"]),
    ]
    w, gap, y, h = 206, 32, 20, 116
    for i, (title, lines) in enumerate(cards):
        x = 20 + i * (w + gap)
        s.card(x, y, w, h, title, lines, num=i + 1)
        if i < 3:
            s.arrow(f"M{x + w + 4} {y + h / 2} H{x + w + gap - 6}")
    first_cx, last_cx = 20 + w / 2, 20 + 3 * (w + gap) + w / 2
    s.arrow(f"M{last_cx} {y + h + 4} V{y + h + 52} H{first_cx} V{y + h + 8}", dashed=True)
    s.label(480, y + h + 80, "The result comes back: the agent looks at the frames it made, then tells you what it built.")
    return s


def session(t):
    s = Svg(960, 280, t)
    cards = [
        ("You direct", ["Describe a scene,", "share references"]),
        ("Agent builds", ["Comps, layers,", "keyframes, effects"]),
        ("Agent checks", ["Looks at the", "frames it made"]),
        ("You review", ["Watch it in", "After Effects"]),
        ("Render", ["The final video"]),
    ]
    w, gap, y, h = 160, 30, 74, 112
    cx = []
    for i, (title, lines) in enumerate(cards):
        x = 20 + i * (w + gap)
        cx.append(x + w / 2)
        s.card(x, y, w, h, title, lines, accent=(i == 4))
        if i < 4:
            s.arrow(f"M{x + w + 4} {y + h / 2} H{x + w + gap - 6}")
    s.arrow(f"M{cx[2]} {y - 4} V{y - 30} H{cx[1]} V{y - 8}")
    s.label((cx[1] + cx[2]) / 2, y - 40, "fixes anything that looks off")
    s.arrow(f"M{cx[3]} {y + h + 4} V{y + h + 34} H{cx[1]} V{y + h + 8}")
    s.label((cx[1] + cx[3]) / 2, y + h + 58, "your notes go back to the agent")
    return s


def guard(t):
    s = Svg(960, 390, t)
    checks = [
        ("Is After Effects open?", "Not open:", ["it stops and tells you. It never starts After Effects by itself."]),
        ("Is anyone else using it?", "In use:", ["it waits its turn."]),
        ("Is a popup in the way?", "Popup:", ["a simple message is closed for you, only while After Effects is in",
                                              "the background. Anything else: it stops and tells you."]),
    ]
    x, w, h, step = 20, 300, 64, 90
    for i, (q, lead, rest) in enumerate(checks):
        y = 20 + i * step
        s.card(x, y, w, h, q, num=i + 1)
        s.arrow(f"M{x + w + 4} {y + h / 2} H{x + w + 46}")
        s.rich(x + w + 60, y + h / 2 + (5 if len(rest) == 1 else -5), lead, rest)
        s.arrow(f"M{x + w / 2} {y + h + 4} V{y + step - 6}")
        s.label(x + w / 2 + 10, y + h + 18, "OK", anchor="start", size=12.5)
    y = 20 + 3 * step
    s.card(x, y, w, h + 16, "Runs the step", accent=True)
    s.rich(x + w + 60, y + 30, "While it runs:", ["popups stay switched off, so an error comes back to the agent"])
    s.label(x + w + 60, y + 51, "as text instead of stopping After Effects.", anchor="start", size=14.5)
    return s


def bridge(t):
    s = Svg(960, 210, t)
    boxes = [
        ("MCP server", ["Talks to your agent"]),
        ("Shared folder", ["~/Documents/ae-mcp-bridge"]),
        ("Panel in After Effects", ["Picks up each command and", "runs it as one undo step"]),
    ]
    w, gap, y, h = 250, 85, 40, 120
    for i, (title, lines) in enumerate(boxes):
        x = 20 + i * (w + gap)
        s.card(x, y, w, h, title, lines)
        if i < 2:
            s.arrow(f"M{x + w + 6} {y + 42} H{x + w + gap - 8}")
            s.label(x + w + gap / 2, y + 32, "command", size=13)
            s.arrow(f"M{x + w + gap - 6} {y + 92} H{x + w + 8}", dashed=True)
            s.label(x + w + gap / 2, y + 112, "result", size=13)
    return s


for name, fn in {"how-it-works": how_it_works, "session": session, "guard": guard, "bridge": bridge}.items():
    for theme, t in THEMES.items():
        fn(t).save(name, theme)
print("diagrams written to", OUT)
