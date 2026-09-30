#!/usr/bin/env python3
"""原作 XBill 2.1 の pixmaps/*.xpm を PNG（data URI）に変換して、src/assets.html を作る。

使い方:  python3 tools/make_assets.py
入力  :  third_party/xbill-2.1/pixmaps/*.xpm
出力  :  src/assets.html   （<script> で XBILL_ASSETS = { 名前: data URI } を定義する）

XBill は GPL のソフトウェアで、ここで変換している絵も原作の一部です。
Copyright (C) Brian Wellington, Matias Duarte.

SPDX-License-Identifier: GPL-3.0-or-later
Copyright (C) 2026 Kawade502
"""
import base64, os, re, struct, sys, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'third_party', 'xbill-2.1', 'pixmaps')
OUT = os.path.join(ROOT, 'src', 'assets.html')

# ゲームで使う絵（原作のファイル名から拡張子を除いたもの）
NAMES = (
    ['billL_%d' % i for i in range(3)] + ['billR_%d' % i for i in range(3)] +
    ['billD_%d' % i for i in range(5)] + ['billA_%d' % i for i in range(13)] +
    ['toaster', 'maccpu', 'nextcpu', 'sgicpu', 'suncpu', 'palmcpu', 'os2cpu', 'bsdcpu'] +
    ['wingdows', 'apple', 'next', 'sgi', 'sun', 'palm', 'os2', 'bsd', 'linux', 'redhat', 'hurd'] +
    ['spark_0', 'spark_1', 'bucket', 'logo']
)

NAMED = {'black': (0, 0, 0), 'white': (255, 255, 255), 'red': (255, 0, 0), 'green': (0, 255, 0),
         'blue': (0, 0, 255), 'yellow': (255, 255, 0), 'cyan': (0, 255, 255), 'magenta': (255, 0, 255),
         'gray': (190, 190, 190), 'grey': (190, 190, 190)}


def parse_color(s):
    s = s.strip()
    if s == 'None':
        return None
    if s.startswith('#'):
        h = s[1:]
        if len(h) == 6:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        if len(h) == 12:
            return tuple(int(h[i:i + 2], 16) for i in (0, 4, 8))
        if len(h) == 3:
            return tuple(int(c * 2, 16) for c in h)
    m = re.match(r'gr[ae]y(\d+)$', s, re.I)
    if m:
        v = round(int(m.group(1)) * 2.55)
        return (v, v, v)
    if s.lower() in NAMED:
        return NAMED[s.lower()]
    raise ValueError('unknown color %r' % s)


def load_xpm(path):
    txt = open(path, encoding='latin-1').read()
    strs = re.findall(r'"((?:[^"\\]|\\.)*)"', txt)
    w, h, n, cpp = map(int, strs[0].split()[:4])
    pal = {}
    for line in strs[1:1 + n]:
        m = re.search(r'\bc\s+(\S+)', line[cpp:])
        pal[line[:cpp]] = parse_color(m.group(1)) if m else None
    rows = strs[1 + n:1 + n + h]
    return w, h, [[pal[r[x * cpp:(x + 1) * cpp]] for x in range(w)] for r in rows]


def png(w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            c = px[y][x]
            raw += bytes(c + (255,)) if c else b'\x00\x00\x00\x00'

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def main():
    entries = []
    for name in NAMES:
        w, h, px = load_xpm(os.path.join(SRC, name + '.xpm'))
        uri = 'data:image/png;base64,' + base64.b64encode(png(w, h, px)).decode('ascii')
        entries.append("    %s: '%s'" % (name, uri))
    body = (
        "<script>\n"
        "  // 自動生成: tools/make_assets.py（原作 XBill 2.1 の pixmaps を PNG に変換したもの）。手で編集しない。\n"
        "  // XBill is free software (GPL). Copyright (C) Brian Wellington, Matias Duarte.\n"
        "  // SPDX-License-Identifier: GPL-3.0-or-later. See NOTICE.md.\n"
        "  const XBILL_ASSETS = {\n" + ",\n".join(entries) + "\n  };\n"
        "</script>\n")
    open(OUT, 'w', encoding='utf-8').write(body)
    print('wrote', OUT, len(body) // 1024, 'KB,', len(entries), 'images')


if __name__ == '__main__':
    sys.exit(main())
