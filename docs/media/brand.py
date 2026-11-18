"""Draws the README hero banner and the GitHub social preview card as SVG.

    python3 docs/media/brand.py

Writes docs/media/hero.svg (animated, used at the top of the README) and
docs/media/social-card.svg (1280x640, static; rendered to social-card.png for the
repository's social preview, see docs/media/README.md). Edit the texts here, not in the SVGs.
"""

import os
from xml.sax.saxutils import escape

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

BLUE, PURPLE, PINK = "#4493F8", "#9B8CFF", "#F778BA"


def defs(uid):
    return f"""<defs>
<linearGradient id="bg{uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A0E17"/><stop offset="1" stop-color="#15112B"/></linearGradient>
<radialGradient id="g1{uid}" cx="0.82" cy="0.15" r="0.6"><stop offset="0" stop-color="{PURPLE}" stop-opacity="0.38"/><stop offset="1" stop-color="{PURPLE}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2{uid}" cx="0.1" cy="1" r="0.55"><stop offset="0" stop-color="{BLUE}" stop-opacity="0.30"/><stop offset="1" stop-color="{BLUE}" stop-opacity="0"/></radialGradient>
<linearGradient id="tx{uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9D8FF"/></linearGradient>
<linearGradient id="bar{uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{PURPLE}"/></linearGradient>
</defs>"""


def panel(x, y, w, h, uid, playhead=True):
    """The prompt bubble and a mini After Effects timeline, drawn at (x, y)."""
    p = []
    # prompt bubble
    p.append(f'<rect x="{x}" y="{y}" width="{w}" height="86" rx="16" fill="#FFFFFF" fill-opacity="0.07" stroke="#FFFFFF" stroke-opacity="0.18"/>')
    p.append(f'<text x="{x + 24}" y="{y + 32}" font-size="13" font-weight="650" letter-spacing="1.2" fill="{PURPLE}">YOU</text>')
    p.append(f'<text x="{x + 24}" y="{y + 60}" font-size="17" fill="#EAF0FF">Add a lower third for Maya Chen, sliding in at 1 s</text>')
    # timeline
    ty = y + 108
    th = h - 108
    p.append(f'<rect x="{x}" y="{ty}" width="{w}" height="{th}" rx="16" fill="#0A0D14" fill-opacity="0.85" stroke="#FFFFFF" stroke-opacity="0.18"/>')
    # ruler
    for i in range(0, 9):
        gx = x + 150 + i * ((w - 180) / 8)
        p.append(f'<line x1="{gx:.1f}" y1="{ty + 14}" x2="{gx:.1f}" y2="{ty + th - 14}" stroke="#FFFFFF" stroke-opacity="0.07"/>')
        if i % 2 == 0:
            p.append(f'<text x="{gx:.1f}" y="{ty + 26}" text-anchor="middle" font-size="10" font-family="{MONO}" fill="#8B94A7">{i}s</text>')
    rows = [("Maya Chen", 0.14, 0.62, [0.14, 0.30], BLUE), ("Head of Product", 0.22, 0.70, [0.22, 0.38], PURPLE),
            ("Accent bar", 0.10, 0.58, [0.10, 0.24], PINK)]
    rh = (th - 54) / 3
    for i, (name, a, b, keys, col) in enumerate(rows):
        ry = ty + 40 + i * rh
        p.append(f'<text x="{x + 20}" y="{ry + rh / 2 + 4:.1f}" font-size="13" fill="#C9D1E0">{escape(name)}</text>')
        bx = x + 150 + a * (w - 180)
        bw = (b - a) * (w - 180)
        p.append(f'<rect x="{bx:.1f}" y="{ry + 5:.1f}" width="{bw:.1f}" height="{rh - 12:.1f}" rx="6" fill="{col}" fill-opacity="0.32" stroke="{col}" stroke-opacity="0.9"/>')
        for k in keys:
            kx = x + 150 + k * (w - 180)
            ky = ry + rh / 2 - 1
            p.append(f'<path d="M{kx:.1f} {ky - 6:.1f} l6 6 l-6 6 l-6 -6 z" fill="#FFFFFF"/>')
    if playhead:
        x0 = x + 150
        x1 = x + w - 30
        p.append(f'<g><line x1="0" y1="{ty + 12}" x2="0" y2="{ty + th - 12}" stroke="{PINK}" stroke-width="2"/>'
                 f'<path d="M-6 {ty + 6} h12 l-6 9 z" fill="{PINK}"/>'
                 f'<animateTransform attributeName="transform" type="translate" values="{x0} 0;{x1} 0;{x0} 0" dur="7s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/></g>')
    return "".join(p)


def banner(w, h, uid, big=False):
    s = 1.0
    left = 72 if not big else 84
    parts = [defs(uid),
             f'<rect width="{w}" height="{h}" fill="url(#bg{uid})"/>',
             f'<rect width="{w}" height="{h}" fill="url(#g1{uid})"/>',
             f'<rect width="{w}" height="{h}" fill="url(#g2{uid})"/>']
    top = 70 if not big else 168
    # pill
    parts.append(f'<rect x="{left}" y="{top}" width="318" height="30" rx="15" fill="{BLUE}" fill-opacity="0.16" stroke="{BLUE}" stroke-opacity="0.6"/>')
    parts.append(f'<circle cx="{left + 18}" cy="{top + 15}" r="4" fill="{BLUE}"/>')
    parts.append(f'<text x="{left + 32}" y="{top + 20}" font-size="12.5" font-weight="650" letter-spacing="1.1" fill="#BBD6FF">MODEL CONTEXT PROTOCOL SERVER</text>')
    # title
    ty = top + 100
    parts.append(f'<text x="{left}" y="{ty}" font-size="66" font-weight="760" letter-spacing="-1.5" fill="url(#tx{uid})">After Effects MCP</text>')
    parts.append(f'<text x="{left}" y="{ty + 46}" font-size="23" fill="#B8C2D6">Let Claude, Cursor and any AI agent build, animate,</text>')
    parts.append(f'<text x="{left}" y="{ty + 78}" font-size="23" fill="#B8C2D6">check and render inside Adobe After Effects.</text>')
    # chips
    cy = ty + 112
    cx = left
    for label in ["278 tools", "Mac + Windows", "MIT"]:
        cw = 14 * len(label) * 0.62 + 34
        parts.append(f'<rect x="{cx:.0f}" y="{cy}" width="{cw:.0f}" height="34" rx="17" fill="#FFFFFF" fill-opacity="0.08" stroke="#FFFFFF" stroke-opacity="0.2"/>')
        parts.append(f'<text x="{cx + cw / 2:.0f}" y="{cy + 22}" text-anchor="middle" font-size="15" font-weight="600" fill="#E6ECF8">{escape(label)}</text>')
        cx += cw + 12
    px = 760 if not big else 740
    pw = w - px - 64
    parts.append(panel(px, 64 if not big else 130, pw, h - 128 if not big else h - 260, uid, playhead=not big))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}" role="img" '
            f'aria-label="After Effects MCP: let AI agents build, animate and render in Adobe After Effects">'
            f'<title>After Effects MCP</title>' + "".join(parts) + '</svg>\n')


def main():
    with open(os.path.join(OUT, "hero.svg"), "w") as f:
        f.write(banner(1280, 420, "h"))
    with open(os.path.join(OUT, "social-card.svg"), "w") as f:
        f.write(banner(1280, 640, "s", big=True))


if __name__ == "__main__":
    main()
