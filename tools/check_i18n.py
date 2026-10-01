#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Kawade502
"""翻訳辞書 src/i18n/*.json の検査。ja を基準に、鍵の過不足・{名前} の食い違い・日本語（かな）の混入を調べる。"""
import json, os, re, sys

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'i18n')
load = lambda n: json.load(open(os.path.join(D, n + '.json'), encoding='utf-8'))
base = load('ja')
ph = lambda s: sorted(re.findall(r'\{\w+\}', s))
bad = 0
for f in sorted(os.listdir(D)):
    if not f.endswith('.json') or f == 'ja.json':
        continue
    d = load(f[:-5])
    for k in sorted(set(base) - set(d)):
        print(f, '不足:', k); bad += 1
    for k in sorted(set(d) - set(base)):
        print(f, '余分:', k); bad += 1
    for k, v in d.items():
        if k in base and ph(v) != ph(base[k]):
            print(f, 'プレースホルダ不一致:', k); bad += 1
        if re.search(r'[぀-ヿ]', v):
            print(f, 'かなが混入:', k); bad += 1
print('OK' if not bad else '%d 件の問題' % bad)
sys.exit(1 if bad else 0)
