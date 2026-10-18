"""Draws the README's step pictures, in a light and a dark version each.

Run from the repository root: python3 assets/make_svgs.py
"""

from pathlib import Path

THEMES = {
    "light": {
        "fg": "#1f2328",
        "muted": "#59636e",
        "faint": "#818b98",
        "line": "#d1d9e0",
        "panel": "#f6f8fa",
        "head": "#eef1f4",
        "key": "#ffffff",
        "acc": "#9a6700",
        "ok": "#1a7f37",
        "band": "#fff8c5",
        "bandb": "#d4a72c",
        "btn": "#ffffff",
    },
    "dark": {
        "fg": "#f0f6fc",
        "muted": "#9198a1",
        "faint": "#656c76",
        "line": "#3d444d",
        "panel": "#151b23",
        "head": "#1c232c",
        "key": "#0d1117",
        "acc": "#d4a72c",
        "ok": "#3fb950",
        "band": "#2b2100",
        "bandb": "#bb8009",
        "btn": "#0d1117",
    },
}

W = 880
PAD = 24  # inside the window, left
ROW = 26  # line height
TOP = 56  # first baseline below the title bar
GLOSS = 380  # where the grey explanations start


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def window(c: dict, height: int, title: str, body: str, label: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="{W}" height="{height}" viewBox="0 0 {W} {height}" role="img" aria-label="{esc(label)}">
  <style>
    .m {{ font: 400 13.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: {c["fg"]}; }}
    .d {{ fill: {c["muted"]}; }}
    .f {{ fill: {c["faint"]}; }}
    .a {{ fill: {c["acc"]}; font-weight: 700; }}
    .k {{ fill: {c["ok"]}; }}
    .t {{ font: 600 12.5px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: {c["muted"]}; }}
    .key {{ font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: {c["fg"]}; }}
  </style>
  <rect x="0.5" y="0.5" width="{W - 1}" height="{height - 1}" rx="10" fill="{c["panel"]}" stroke="{c["line"]}"/>
  <path d="M0.5 32 V10.5 a10 10 0 0 1 10 -10 H{W - 10.5} a10 10 0 0 1 10 10 V32 Z" fill="{c["head"]}"/>
  <line x1="0.5" y1="32" x2="{W - 0.5}" y2="32" stroke="{c["line"]}"/>
  <circle cx="18" cy="16.5" r="4.5" fill="{c["line"]}"/><circle cx="33" cy="16.5" r="4.5" fill="{c["line"]}"/><circle cx="48" cy="16.5" r="4.5" fill="{c["line"]}"/>
  <text x="{W / 2}" y="21" class="t" text-anchor="middle">{esc(title)}</text>
{body}
</svg>
'''


def line(y: float, spans: list[tuple[str, str]], gloss: str = "") -> str:
    """One terminal line: spans of (text, class) in a row, and a grey note in its own column."""
    parts = "".join(f'<tspan class="{cls}">{esc(text)}</tspan>' if cls else esc(text) for text, cls in spans)
    note = f'<text x="{GLOSS}" y="{y}" class="m d">{esc(gloss)}</text>' if gloss else ""
    return f'  <text x="{PAD}" y="{y}" class="m">{parts}</text>{note}\n'


def prompt(y: float, mark: str, text: str, gloss: str = "") -> str:
    return line(y, [("❯ ", "f"), (mark, "a"), (text, "")], gloss)


def frame(c: dict, x: float, w: float, h: float, title: str) -> str:
    """A small window: border, title bar and title, at x on the top edge."""
    return (
        f'  <rect x="{x + 0.5}" y="0.5" width="{w - 1}" height="{h - 1}" rx="10" fill="{c["panel"]}" stroke="{c["line"]}"/>\n'
        f'  <path d="M{x + 0.5} 32 V10.5 a10 10 0 0 1 10 -10 H{x + w - 10.5} a10 10 0 0 1 10 10 V32 Z" fill="{c["head"]}"/>\n'
        f'  <line x1="{x + 0.5}" y1="32" x2="{x + w - 0.5}" y2="32" stroke="{c["line"]}"/>\n'
        f'  <text x="{x + w / 2}" y="21" class="t" text-anchor="middle">{esc(title)}</text>\n'
    )


def step1(c: dict) -> str:
    pw, ph = 400, 150
    rx = W - pw
    marks = [("+", "idea"), ("+?", "question"), ("+!", "change"), ("+-", "drop"), ("++", "dig deeper")]
    tile, space = 160, 20
    legend_y = ph + 22
    legend = "".join(
        f'  <rect x="{n * (tile + space) + 0.5}" y="{legend_y}" width="{tile - 1}" height="30" rx="15" fill="{c["panel"]}" stroke="{c["line"]}"/>\n'
        f'  <text x="{n * (tile + space) + tile / 2}" y="{legend_y + 20}" text-anchor="middle">'
        f'<tspan class="m a">{esc(mark)}</tspan><tspan class="s"> {esc(word)}</tspan></text>\n'
        for n, (mark, word) in enumerate(marks)
    )
    body = (
        frame(c, 0, pw, ph, "report.md · preview")
        + f'  <text x="{PAD}" y="66" class="doc">Sales held steady across regions.</text>\n'
        + f'  <rect x="{PAD - 6}" y="80" width="214" height="28" rx="4" fill="{c["band"]}" stroke="{c["bandb"]}"/>\n'
        + f'  <text x="{PAD}" y="99" class="sel">Revenue grew by 12% in Q3.</text>\n'
        + f'  <rect x="{pw - PAD - 64}" y="81" width="64" height="26" rx="5" fill="{c["key"]}" stroke="{c["line"]}" stroke-width="1.5"/>\n'
        + f'  <rect x="{pw - PAD - 63}" y="102" width="62" height="4" rx="2" fill="{c["line"]}"/>\n'
        + f'  <text x="{pw - PAD - 32}" y="98" class="key" text-anchor="middle">Ctrl+C</text>\n'
        + f'  <text x="{PAD}" y="132" class="doc">Costs stayed flat.</text>\n'
        + f'  <path d="M{pw + 16} 94 H{rx - 16}" stroke="{c["faint"]}" stroke-width="2" fill="none"/>\n'
        + f'  <path d="M{rx - 24} 87 L{rx - 15} 94 L{rx - 24} 101" stroke="{c["faint"]}" stroke-width="2" fill="none" stroke-linejoin="round"/>\n'
        + frame(c, rx, pw, ph, "Claude Code")
        + f'  <text x="{rx + PAD}" y="66" class="m"><tspan class="f">❯ </tspan><tspan class="a">+?</tspan> where is this from</text>\n'
        + f'  <text x="{rx + PAD}" y="99" class="m k">queued ? docs/report.md:42</text>\n'
        + f'  <text x="{rx + PAD}" y="123" class="m k">"Revenue grew by 12% in Q3."</text>\n'
        + legend
    )
    label = (
        "Copy a sentence from a markdown preview with Ctrl+C, then type +? and a question in Claude Code: the comment is queued, "
        "pinned to docs/report.md line 42 with the copied sentence. The marks: + idea, +? question, +! change, +- drop, ++ dig deeper."
    )
    height = legend_y + 31
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="{W}" height="{height}" viewBox="0 0 {W} {height}" role="img" aria-label="{esc(label)}">
  <style>
    .m {{ font: 400 13.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: {c["fg"]}; }}
    .f {{ fill: {c["faint"]}; }}
    .a {{ fill: {c["acc"]}; font-weight: 700; }}
    .k {{ fill: {c["ok"]}; }}
    .t {{ font: 600 12.5px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: {c["muted"]}; }}
    .s {{ font: 400 13px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: {c["muted"]}; }}
    .doc {{ font: 400 15px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: {c["faint"]}; }}
    .sel {{ font: 400 15px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: {c["fg"]}; }}
    .key {{ font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: {c["fg"]}; }}
  </style>
{body}</svg>
'''


def step2(c: dict) -> str:
    y0 = TOP
    band_y = y0 + 14
    body = (
        line(y0, [("● ", "a"), ("Done. Shall I update the docs too?", "")])
        + f'  <rect x="{PAD - 8}" y="{band_y}" width="{W - 2 * PAD + 16}" height="30" rx="6" fill="{c["band"]}" stroke="{c["bandb"]}"/>\n'
        + f'  <text x="{PAD}" y="{band_y + 20}" class="m d">queue: 1 idea, 4 comments</text>\n'
        + f'  <rect x="{W - PAD - 92}" y="{band_y + 5}" width="84" height="20" rx="4" fill="{c["btn"]}" stroke="{c["line"]}"/>\n'
        + f'  <text x="{W - PAD - 50}" y="{band_y + 19}" class="m" text-anchor="middle">organize</text>\n'
        + line(band_y + 30 + ROW, [("❯ ", "f"), ("yes, go ahead", "")], "your reply goes to Claude as usual")
    )
    label = (
        "Claude finishes and asks whether to update the docs. Above the prompt, a line shows the queue: 1 idea, 4 comments, "
        "with an organize button. You answer yes, go ahead, which goes to Claude as usual; the queue keeps waiting."
    )
    return window(c, int(band_y + 30 + ROW + 26), "Claude Code", body, label)


def step3(c: dict) -> str:
    # The list as /aside prints it, under the terminal's output mark. Each column has its own x,
    # since a browser may collapse the runs of spaces that line the columns up in the terminal.
    out = PAD + 40
    number, kind, text = out + 16, out + 36, out + 136
    rows = [
        ("1", "idea", "cache the parsed config", ""),
        ("2", "question", "where is this from", 'docs/report.md:42  "Revenue grew by 12% in Q3."'),
    ]
    y = TOP
    body = line(y, [("❯ ", "f"), ("/aside", "a")], "see the list")
    y += ROW
    body += f'  <text x="{PAD + 16}" y="{y}" class="m f">⎿</text><text x="{out}" y="{y}" class="m">1 idea and 1 comment waiting</text>\n'
    y += ROW * 0.5
    for n, k, t, about in rows:
        y += ROW
        body += (
            f'  <text x="{number}" y="{y}" class="m" text-anchor="end">{n}</text>'
            f'<text x="{kind}" y="{y}" class="m">{esc(k)}</text><text x="{text}" y="{y}" class="m">{esc(t)}</text>\n'
        )
        if about:
            y += ROW
            body += f'  <text x="{text}" y="{y}" class="m">{esc(about)}</text>\n'
    for command, gloss in (
        ("/aside plan", "Claude turns it into steps"),
        ("/aside run", "step 1 of 3 running"),
        ("/aside pop 2", "entry 2, ready to send"),
    ):
        y += ROW * (1.5 if command == "/aside plan" else 1)
        body += line(y, [("❯ ", "f"), (command, "a")], gloss)
    label = (
        "In Claude Code: /aside lists what waits, 1 idea and 1 comment, in columns: number, kind, text, and under a comment "
        "its file, line and quote. /aside plan has Claude turn it into steps; /aside run runs them, step 1 of 3 first; "
        "/aside pop 2 puts entry 2 in the prompt box, ready to send."
    )
    return window(c, int(y + 26), "Claude Code", body, label)


def main() -> None:
    out = Path(__file__).parent
    for name, colours in THEMES.items():
        for number, draw in ((1, step1), (2, step2), (3, step3)):
            (out / f"step-{number}-{name}.svg").write_text(draw(colours), encoding="utf-8")


if __name__ == "__main__":
    main()
