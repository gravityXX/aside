"""Draws the README's pictures, the timeline and the steps, in a light and a dark version each.

Run from the repository root: python3 assets/make_svgs.py
"""

from pathlib import Path

# A theme: each colour by the name the pictures use it under.
Theme = dict[str, str]

THEMES: dict[str, Theme] = {
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
        "claude": "#c15f3c",
        "kidea": "#5769f7",
        "kquestion": "#966c1e",
        "pill": "#fff8c5",
        "work": "#ddf4ff",
        "workb": "#54aeff",
        "go": "#dafbe1",
        "gob": "#4ac26b",
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
        "claude": "#d77757",
        "kidea": "#b1b9f9",
        "kquestion": "#ffc107",
        "pill": "#3b2e00",
        "work": "#0c2d6b",
        "workb": "#1f6feb",
        "go": "#0f2d1a",
        "gob": "#2ea043",
    },
}

W = 880
PAD = 24  # inside the window, left
ROW = 26  # line height
TOP = 56  # first baseline below the title bar
GLOSS = 380  # where the grey explanations start


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def window(c: Theme, height: int, title: str, body: str, label: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="{W}" height="{height}" viewBox="0 0 {W} {height}" role="img" aria-label="{esc(label)}">
  <style>
    .m {{ font: 400 13.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: {c["fg"]}; }}
    .d {{ fill: {c["muted"]}; }}
    .f {{ fill: {c["faint"]}; }}
    .a {{ fill: {c["acc"]}; font-weight: 700; }}
    .k {{ fill: {c["ok"]}; }}
    .b {{ font-weight: 700; }}
    .claude {{ fill: {c["claude"]}; font-weight: 700; }}
    .kidea {{ fill: {c["kidea"]}; }}
    .kquestion {{ fill: {c["kquestion"]}; }}
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


def frame(c: Theme, x: float, w: float, h: float, title: str) -> str:
    """A small window: border, title bar and title, at x on the top edge."""
    return (
        f'  <rect x="{x + 0.5}" y="0.5" width="{w - 1}" height="{h - 1}" rx="10" fill="{c["panel"]}" stroke="{c["line"]}"/>\n'
        f'  <path d="M{x + 0.5} 32 V10.5 a10 10 0 0 1 10 -10 H{x + w - 10.5} a10 10 0 0 1 10 10 V32 Z" fill="{c["head"]}"/>\n'
        f'  <line x1="{x + 0.5}" y1="32" x2="{x + w - 0.5}" y2="32" stroke="{c["line"]}"/>\n'
        f'  <text x="{x + w / 2}" y="21" class="t" text-anchor="middle">{esc(title)}</text>\n'
    )


def band(c: Theme, y: float, text: str, buttons: list[str]) -> str:
    """The line above the prompt: what aside says, and its buttons at the right end."""
    out = (
        f'  <rect x="{PAD - 8}" y="{y}" width="{W - 2 * PAD + 16}" height="30" rx="6" fill="{c["band"]}" stroke="{c["bandb"]}"/>\n'
        f'  <text x="{PAD}" y="{y + 20}" class="m d">{esc(text)}</text>\n'
    )
    for n, label in enumerate(reversed(buttons)):
        x = W - PAD - 60 - n * 60
        out += (
            f'  <rect x="{x}" y="{y + 5}" width="52" height="20" rx="4" fill="{c["btn"]}" stroke="{c["line"]}"/>\n'
            f'  <text x="{x + 26}" y="{y + 19}" class="m" text-anchor="middle">{esc(label)}</text>\n'
        )
    return out


def arrow(d: str, colour: str) -> str:
    return f'  <path d="{d}" stroke="{colour}" stroke-width="1.5" fill="none" marker-end="url(#a)"/>\n'


def how_it_works(c: Theme) -> str:
    """The timeline at the top of the README: Claude, you and the queue, side by side."""
    sans = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
    mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    pill = f'fill="{c["pill"]}" stroke="{c["bandb"]}"'
    go = f'fill="{c["go"]}" stroke="{c["gob"]}"'
    idle = f'fill="{c["panel"]}" stroke="{c["line"]}"'
    steps = "".join(
        f'  <rect x="{x}" y="56" width="{w}" height="28" rx="14" {go}/>'
        f'<text x="{x + w // 2}" y="75" class="t" text-anchor="middle">{name}</text>\n'
        for x, w, name in ((624, 72, "step 1"), (704, 72, "step 2"), (784, 96, "summary"))
    )
    label = (
        "While Claude works on your task, you copy text with Ctrl+C and add ideas and comments; they go to a queue instead "
        "of to Claude. When it is done you answer it as usual, and /aside plan hands the queue over as steps, which Claude "
        "sums up after the last one."
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="{W}" height="280" viewBox="0 0 {W} 280" role="img" aria-label="{esc(label)}">
  <style>
    .lab {{ font: 600 13px {sans}; fill: {c["muted"]}; }}
    .t {{ font: 500 13px {sans}; fill: {c["fg"]}; }}
    .s {{ font: 400 12px {sans}; fill: {c["muted"]}; }}
    .m {{ font: 500 12.5px {mono}; fill: {c["fg"]}; }}
    .k {{ font: 700 12px {mono}; fill: {c["fg"]}; }}
  </style>
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="{c["faint"]}"/>
    </marker>
  </defs>

  <text x="0" y="75" class="lab">Claude</text>
  <text x="0" y="165" class="lab">You</text>
  <text x="0" y="235" class="lab">Queue</text>
  <line x1="92" y1="70" x2="{W}" y2="70" stroke="{c["line"]}" stroke-dasharray="2 4"/>
  <line x1="92" y1="160" x2="{W}" y2="160" stroke="{c["line"]}" stroke-dasharray="2 4"/>

  <rect x="92" y="56" width="420" height="28" rx="6" fill="{c["work"]}" stroke="{c["workb"]}"/>
  <text x="106" y="75" class="t">works on your task, undisturbed</text>
  <rect x="524" y="56" width="56" height="28" rx="14" {idle}/><text x="552" y="75" class="t" text-anchor="middle">done</text>

  <rect x="96" y="146" width="96" height="28" rx="14" {pill}/><text x="144" y="165" class="m" text-anchor="middle">+ idea</text>
  <text x="240" y="136" class="s" text-anchor="middle">copy first</text>
  <rect x="208" y="147" width="64" height="26" rx="5" fill="{c["key"]}" stroke="{c["line"]}" stroke-width="1.5"/>
  <rect x="209" y="168" width="62" height="4" rx="2" fill="{c["line"]}"/>
  <text x="240" y="164" class="k" text-anchor="middle">Ctrl+C</text>
{arrow("M274 160 H284", c["acc"])}  <rect x="288" y="146" width="112" height="28" rx="14" {pill}/><text x="344" y="165" class="m" text-anchor="middle">+? comment</text>
  <rect x="416" y="146" width="104" height="28" rx="14" {pill}/><text x="468" y="165" class="m" text-anchor="middle">+! change</text>

{arrow("M144 176 V212", c["bandb"])}{arrow("M344 176 V212", c["bandb"])}{arrow("M468 176 V212", c["bandb"])}  <rect x="92" y="216" width="440" height="28" rx="6" fill="{c["panel"]}" stroke="{c["bandb"]}" stroke-dasharray="4 3"/>
  <text x="106" y="235" class="s">waits here with what you copied, Claude does not see it</text>

  <rect x="548" y="146" width="52" height="28" rx="14" {idle}/><text x="574" y="165" class="t" text-anchor="middle">reply</text>
{arrow("M574 144 V90", c["faint"])}
  <rect x="616" y="146" width="112" height="28" rx="14" {go}/><text x="672" y="165" class="m" text-anchor="middle">/aside plan</text>
{arrow("M536 230 H672 V180", c["gob"])}{arrow("M672 144 V90", c["gob"])}
{steps}
  <text x="574" y="272" class="s" text-anchor="middle">you answer as usual</text>
  <text x="792" y="272" class="s" text-anchor="middle">then hand the queue over</text>
</svg>
'''


def step1(c: Theme) -> str:
    pw, ph = 400, 150
    rx = W - pw
    marks = [("+", "idea"), ("+?", "question"), ("+!", "change"), ("+-", "drop"), ("++", "dig deeper")]
    tile, space = 160, 20
    legend_y = ph + 36
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
    height = legend_y + 31 + 16
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


def step2(c: Theme) -> str:
    y0 = TOP
    band_y = y0 + 14
    body = (
        line(y0, [("● ", "a"), ("Done. Shall I update the docs too?", "")])
        + band(c, band_y, "aside: 1 idea, 4 comments", ["list"])
        + line(band_y + 30 + ROW, [("❯ ", "f"), ("yes, go ahead", "")], "your reply goes to Claude as usual")
    )
    label = (
        "Claude finishes and asks whether to update the docs. Above the prompt, a line shows the queue, aside: 1 idea, 4 comments, "
        "with a list button that opens the entries. You answer yes, go ahead, which goes to Claude as usual; the queue keeps waiting."
    )
    return window(c, int(band_y + 30 + ROW + 26), "Claude Code", body, label)


def step3(c: Theme) -> str:
    # The list as /aside draws it: a frame, the kinds in the theme's colours. Each column has
    # its own x, since a browser may collapse the runs of spaces that line columns up.
    box_x, box_w = PAD + 8, W - 2 * PAD - 8
    out = box_x + 16
    number, kind, text = out + 16, out + 36, out + 120
    rows = [
        ("1", "idea", "cache the parsed config", "", "kidea"),
        ("2", "question", "where is this from", '↳ docs/report.md:42 · "Revenue grew by 12% in Q3."', "kquestion"),
    ]
    y: float = TOP
    body = line(y, [("❯ ", "f"), ("/aside", "a")], "see the list")
    top = y + 12
    y = top + ROW
    body += (
        f'  <text x="{out}" y="{y}" class="m claude">aside</text>'
        f'<text x="{out + 60}" y="{y}" class="m b">1 idea and 1 comment waiting</text>\n'
    )
    y += ROW * 0.5
    for n, k, t, about, colour in rows:
        y += ROW
        body += (
            f'  <text x="{number}" y="{y}" class="m d" text-anchor="end">{n}</text>'
            f'<text x="{kind}" y="{y}" class="m {colour}">{esc(k)}</text><text x="{text}" y="{y}" class="m">{esc(t)}</text>\n'
        )
        if about:
            y += ROW
            body += f'  <text x="{text}" y="{y}" class="m d">{esc(about)}</text>\n'
    bottom = y + 14
    body += f'  <rect x="{box_x}" y="{top}" width="{box_w}" height="{bottom - top}" rx="8" fill="none" stroke="{c["line"]}" stroke-width="1.5"/>\n'
    y = bottom + ROW * 1.25
    body += line(y, [("❯ ", "f"), ("/aside pop 2", "a")], "entry 2, ready to send")
    label = (
        "In Claude Code: /aside draws what waits in a frame, 1 idea and 1 comment, in columns: number, kind in its colour, "
        "text, and under a comment its file, line and quote. /aside pop 2 puts entry 2 in the prompt box, ready to send."
    )
    return window(c, int(y + 26), "Claude Code", body, label)


def step4(c: Theme) -> str:
    # The plan as the list shows it while step 2 runs: a step done with its result under it,
    # the running one, one to do; the states in the colours /aside gives them.
    box_x, box_w = PAD + 8, W - 2 * PAD - 8
    out = box_x + 16
    number, state, text = out + 16, out + 36, out + 120
    rows = [
        ("1", "done", "cache the parsed config", "↳ cached once at start-up; the tests pass", "k"),
        ("2", "running", "where is this from", "", "kquestion"),
        ("3", "to do", "a shorter results section", "", ""),
    ]
    y: float = TOP
    body = line(y, [("❯ ", "f"), ("/aside plan", "a")], "Claude saves the queue as steps")
    y += ROW
    body += line(y, [("❯ ", "f"), ("/aside run", "a")], "they go one after another")
    band_y = y + 14
    body += band(c, band_y, "aside: step 2/3 running, 1 idea", ["list", "stop"])
    top = band_y + 30 + 14
    y = top + ROW
    body += (
        f'  <text x="{out}" y="{y}" class="m claude">aside</text>'
        f'<text x="{out + 60}" y="{y}" class="m b">Plan: 2 of 3 steps to do (/aside run)</text>\n'
    )
    y += ROW * 0.5
    for n, word, t, about, colour in rows:
        y += ROW
        dim = " d" if word == "done" else ""
        body += (
            f'  <text x="{number}" y="{y}" class="m d" text-anchor="end">{n}</text>'
            f'<text x="{state}" y="{y}" class="m {colour}">{esc(word)}</text><text x="{text}" y="{y}" class="m{dim}">{esc(t)}</text>\n'
        )
        if about:
            y += ROW
            body += f'  <text x="{text}" y="{y}" class="m d">{esc(about)}</text>\n'
    bottom = y + 14
    body += f'  <rect x="{box_x}" y="{top}" width="{box_w}" height="{bottom - top}" rx="8" fill="none" stroke="{c["line"]}" stroke-width="1.5"/>\n'
    y = bottom + ROW * 1.25
    body += line(y, [("● ", "a"), ("Summary of the run", "b")], "after the last step: done, open, next")
    label = (
        "In Claude Code: /aside plan has Claude save the queue as steps, and /aside run sends them one after another. "
        "Above the prompt, aside: step 2/3 running, 1 idea, with list and stop buttons. The list shows the plan: step 1 done "
        "with its result under it, cached once at start-up; the tests pass, step 2 running, step 3 to do. After the last "
        "step, Claude ends with a summary of the run: what was done, what is open and what comes next."
    )
    return window(c, int(y + 26), "Claude Code", body, label)


def main() -> None:
    out = Path(__file__).parent
    for name, colours in THEMES.items():
        (out / f"how-it-works-{name}.svg").write_text(how_it_works(colours), encoding="utf-8")
        for number, draw in ((1, step1), (2, step2), (3, step3), (4, step4)):
            (out / f"step-{number}-{name}.svg").write_text(draw(colours), encoding="utf-8")


if __name__ == "__main__":
    main()
