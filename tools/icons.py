#!/usr/bin/python3
"""Gold 10X on the ground. Nearest-neighbor, no image library."""

import struct
import zlib
from pathlib import Path

GROUND = (0x45, 0x45, 0x45, 255)
GOLD = (0xFF, 0xA5, 0x12, 255)

# 5x7
GLYPH = {
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "X": ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
}


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(size):
    gap = 1
    glyph_w = 5
    width = glyph_w * 3 + gap * 2
    height = 7
    scale = max(1, (size * 5 // 8) // width)
    art_w = width * scale
    art_h = height * scale
    ox = (size - art_w) // 2
    oy = (size - art_h) // 2
    marks = set()
    x = 0
    for ch in "10X":
        for yy, row in enumerate(GLYPH[ch]):
            for xx, bit in enumerate(row):
                if bit == "1":
                    for sy in range(scale):
                        for sx in range(scale):
                            marks.add((ox + (x + xx) * scale + sx, oy + yy * scale + sy))
        x += glyph_w + gap
    raw = []
    for y in range(size):
        row = bytearray([0])
        for px in range(size):
            row.extend(GOLD if (px, y) in marks else GROUND)
        raw.append(bytes(row))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"".join(raw), 9)) + chunk(b"IEND", b"")


def main():
    root = Path(__file__).resolve().parents[1]
    for size, name in ((180, "icon-180.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        (root / name).write_bytes(png(size))


if __name__ == "__main__":
    main()
