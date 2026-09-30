#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Kawade502
# Based on XBill 2.1 (Copyright (C) Brian Wellington, Matias Duarte; GPL). See NOTICE.md.
"""原作の絵（XPM）だけで、SNS 共有用の画像（OGP, 1200x630）とファビコンを作る。

使い方:  python3 tools/make_ogp.py
入力  :  third_party/xbill-2.1/pixmaps/*.xpm
出力  :  docs/ogp.png（1200x630）, docs/favicon.png（100x100）

ゲーム画面のように、白い地に PC・ケーブル・OS を頭に載せたビルを 3 倍で並べる。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_assets import SRC, load_xpm, png  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SCALE = 3
W, H = 1200 // SCALE, 630 // SCALE     # 400 x 210（ゲーム画面と同じ単位）

_cache = {}


def sprite(name):
    if name not in _cache:
        _cache[name] = load_xpm(os.path.join(SRC, name + '.xpm'))
    return _cache[name]


def compose():
    field = [[(255, 255, 255)] * W for _ in range(H)]

    def blit(name, x, y):
        w, h, px = sprite(name)
        for dy in range(h):
            for dx in range(w):
                c = px[dy][dx]
                fx, fy = x + dx, y + dy
                if c is not None and 0 <= fx < W and 0 <= fy < H:
                    field[fy][fx] = c

    def line(x1, y1, x2, y2):
        n = max(abs(x2 - x1), abs(y2 - y1))
        for i in range(n + 1):
            x = round(x1 + (x2 - x1) * i / max(n, 1))
            y = round(y1 + (y2 - y1) * i / max(n, 1))
            if 0 <= x < W and 0 <= y < H:
                field[y][x] = (0, 0, 0)

    # (PC の絵, OS の絵 or None, x, y)。OS が None なら Wingdows 表示
    pcs = [
        ('maccpu', 'apple', 14, 88), ('suncpu', 'sun', 88, 122), ('os2cpu', 'linux', 168, 96),
        ('nextcpu', 'wingdows', 246, 126), ('palmcpu', 'palm', 326, 92), ('bsdcpu', 'bsd', 30, 150),
    ]
    cables = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5)]
    centers = [(x + 18, y + 22) for _, _, x, y in pcs]

    blit('bucket', 2, 2)
    blit('logo', 70, 4)
    for a, b in cables:
        line(*centers[a], *centers[b])
    # 感染元から火花が走っている様子
    blit('spark_0', 218, 118)
    for cpu, os_name, x, y in pcs:
        blit(cpu, x, y)
        blit(os_name, x + 4, y + 4)

    # ビル: (向き, コマ, x, y, 持っている OS or None)
    bills = [('R', 0, 60, 84, 'linux'), ('L', 1, 140, 88, 'wingdows'), ('R', 2, 214, 76, 'wingdows'),
             ('L', 0, 292, 78, 'wingdows'), ('R', 1, 356, 130, 'apple'), ('L', 2, 120, 150, 'wingdows'),
             ('R', 0, 290, 168, 'wingdows')]
    for face, cel, x, y, cargo in bills:
        if cargo:
            blit(cargo, x - 2, y - 15)
        blit('bill%s_%d' % (face, cel), x, y)
    return field


def upscale(field):
    rows = []
    for row in field:
        line = [c for c in row for _ in range(SCALE)]
        rows.extend([line] * SCALE)
    return rows


def main():
    os.makedirs(DOCS, exist_ok=True)
    rows = upscale(compose())
    open(os.path.join(DOCS, 'ogp.png'), 'wb').write(png(len(rows[0]), len(rows), rows))

    # ファビコン: 原作のアイコン（50x50）を 2 倍に
    w, h, px = sprite('icon')
    icon = [[px[y // 2][x // 2] for x in range(w * 2)] for y in range(h * 2)]
    open(os.path.join(DOCS, 'favicon.png'), 'wb').write(png(w * 2, h * 2, icon))
    print('wrote docs/ogp.png %dx%d, docs/favicon.png %dx%d' % (len(rows[0]), len(rows), w * 2, h * 2))


if __name__ == '__main__':
    main()
