# NOTICE / クレジット

このプロジェクトは **XBill 2.1** をもとにした、Web ブラウザ向けの移植です（GitHub Pages で公開）。
Google Apps Script 版（[xbill-gas](https://github.com/Kawade502/xbill-gas)）と同じゲームで、こちらは別のリポジトリとして管理しています。

## 原作

- 名前: XBill 2.1
- 著作権: Copyright (C) Brian Wellington, Matias Duarte
  - メインのプログラム: Brian Wellington
  - 2.0 までのプログラムとグラフィック: Matias Duarte
- 入手先: <http://www.xbill.org/>
- ライセンス: **GPL**。原作の `xbill.spec` に `Copyright: GPL` とあり、版の指定はありません
  （[`third_party/xbill-2.1/xbill.spec`](third_party/xbill-2.1/xbill.spec)）。
  GPL は、版の指定がないときは任意の版を選べるため、この派生物は **GPL-3.0 以降**（`GPL-3.0-or-later`）としています。

## このリポジトリに含まれる、原作由来のもの

| 場所 | 内容 |
|---|---|
| `third_party/xbill-2.1/pixmaps/` | 原作の絵の元データ（XPM）。変更していません |
| `third_party/xbill-2.1/README`, `xbill.spec` | 原作の README と、ライセンス表記のあるファイル。変更していません |
| `src/assets.html` | 上の XPM を PNG（data URI）に変換したもの。`tools/make_assets.py` で作り直せます |
| `src/game.html`, `src/sprites.html` | 原作の C ソース（`Game.c` `Bill.c` `Horde.c` `Computer.c` `Network.c` `Cable.c` `Spark.c` `Bucket.c` `OS.c`）を読んで、JavaScript に移植したもの |

## 原作からの主な変更点

- C 言語のゲームを、JavaScript と HTML の Canvas で動くウェブアプリに書き直した（静的なページとして GitHub Pages で公開）
- 画面の広さに合わせて世界を広げる（原作は 400x400 固定）。スマホのタッチ操作に対応し、当たり判定を少し広げた
- レベル 1〜10 で全クリア（原作はレベルに上限がない）。難易度の数値は原作の式ではなく、`src/game.html` の `LEVELS` の表で決めている
- ランキング（Cloudflare Workers + KV に保存）、効果音、ポーズ、ヘルプ画面を追加した

## ライセンス

このリポジトリは **GNU General Public License v3.0 以降** の下で公開しています。全文は [`LICENSE`](LICENSE) にあります。
各ソースファイルの先頭に `SPDX-License-Identifier: GPL-3.0-or-later` を記しています。

XBill is free software. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY.
