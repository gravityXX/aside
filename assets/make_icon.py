# Draws the plugin's icon for the Claude plugin directory listing: the queue as the band shows
# it, entries in a line with one pulled aside, on Claude's terracotta. The directory
# takes a square PNG and refuses SVG, so this is the one picture here that is not drawn by
# make_svgs.py; it writes the PNG with the standard library alone (8.1), rounding every edge
# by how much of the pixel the shape covers, since nothing here rasterizes for us.
#
# The directory reads the icon once, the first time the plugin is submitted, and a later change
# does not reach the listing - so this runs before the submission and its output is committed
# beside it (8.4).

import struct
import zlib
from math import hypot
from pathlib import Path

OUT = Path(".claude-plugin/icon.png")

# A tile of 1024 px sits inside the 512 to 2048 the directory allows, and every mark stays well
# inside the circle a round mask would leave.
SIZE = 1024

# THEMES['light'] in make_svgs.py: 'claude' behind, 'key' for the marks.
BACK = (0xC1, 0x5F, 0x3C)
MARK = (0xFF, 0xFF, 0xFF)

PILL_H = 104
PILL_W = 520
GAP = 72
LEFT = 200
# How far the entry set aside is pulled out of the line, and how much the two still in it fade
# against the terracotta, so the one set aside is what the eye finds first.
ASIDE = 150
IN_LINE = 0.58

Box = tuple[float, float, float, float]

TOP = (SIZE - (3 * PILL_H + 2 * GAP)) / 2
PILLS: list[tuple[Box, float]] = [
    ((LEFT, TOP, LEFT + PILL_W, TOP + PILL_H), IN_LINE),
    ((LEFT + ASIDE, TOP + PILL_H + GAP, LEFT + ASIDE + PILL_W, TOP + 2 * PILL_H + GAP), 1.0),
    ((LEFT, TOP + 2 * (PILL_H + GAP), LEFT + PILL_W, TOP + 3 * PILL_H + 2 * GAP), IN_LINE),
]


def covered(px: float, py: float, box: Box) -> float:
    """How much of the pixel at (px, py) the pill `box` covers: 1 inside, 0 outside, and the
    width of one pixel in between, which is the whole of the smoothing here."""
    x0, y0, x1, y1 = box
    r = (y1 - y0) / 2
    qx = abs(px - (x0 + x1) / 2) - ((x1 - x0) / 2 - r)
    qy = abs(py - (y0 + y1) / 2) - ((y1 - y0) / 2 - r)
    away = hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r

    return min(max(0.5 - away, 0.0), 1.0)


def rows() -> list[bytes]:
    """The tile's pixels, row by row, the terracotta where no pill reaches."""
    plain = bytes(BACK) * SIZE
    first = min(box[1] for box, _ in PILLS) - 1
    last = max(box[3] for box, _ in PILLS) + 1
    drawn: list[bytes] = []
    for y in range(SIZE):
        if not first <= y + 0.5 <= last:
            drawn.append(plain)
            continue
        row = bytearray()
        for x in range(SIZE):
            here = [float(one) for one in BACK]
            for box, alpha in PILLS:
                over = covered(x + 0.5, y + 0.5, box) * alpha
                if over > 0:
                    here = [one + (mark - one) * over for one, mark in zip(here, MARK)]
            row += bytes(round(one) for one in here)
        drawn.append(bytes(row))

    return drawn


def png(drawn: list[bytes]) -> bytes:
    """The rows as an 8-bit RGB PNG."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    head = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    body = zlib.compress(b"".join(b"\x00" + row for row in drawn), 9)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", body) + chunk(b"IEND", b"")


def main() -> None:
    OUT.write_bytes(png(rows()))
    print(f"{OUT}: {SIZE}x{SIZE}, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
