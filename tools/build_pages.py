#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Kawade502
# Based on XBill 2.1 (Copyright (C) Brian Wellington, Matias Duarte; GPL). See NOTICE.md.
"""GitHub Pages 用の docs/index.html を作る。

使い方:  python3 tools/build_pages.py [--out 出力先] [--api ランキングAPIのURL]
  --out  出力先（既定は docs/）。手元での確認用に、別の場所へ出せる
  --api  pages.config.json の rankingApi を、この値で上書きする（手元の wrangler dev を指すときなど）
入力  :  src/index.html と、その <!-- @include 名前 --> で読み込む部品（src/*.html）、pages.config.json
出力  :  docs/index.html, docs/.nojekyll

次のことを行う。
  - <!-- @include 名前 --> を、部品の中身で置き換える（部品は <script> / <style> ごと入っている）
  - <head> に、viewport、description、OGP / Twitter Card、favicon、ランキング API の URL（window.XBILL_CONFIG）を入れる
  - include の取りこぼしが無いことと、インラインの JavaScript の構文を検査する
docs/ogp.png と docs/favicon.png は tools/make_ogp.py で作る。
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
DOCS = os.path.join(ROOT, 'docs')

TITLE = 'XBill Web Remake - ビルを叩いて、OSを守れ'
DESCRIPTION = ('1994年の名作ゲーム XBill をブラウザで。ビルが PC の OS を Wingdows に入れ替える前に、叩いて守ろう。'
               'ログイン不要・スマホ対応・ランキングあり（GPL-3.0以降で公開）')
VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def i18n_json():
    """src/i18n/*.json を 1 つの JSON にまとめる（ja を先頭に）。</script> を壊さないよう < をエスケープする。"""
    d = {}
    for name in sorted(os.listdir(os.path.join(SRC, 'i18n'))):
        if name.endswith('.json'):
            d[name[:-5]] = json.loads(read(os.path.join(SRC, 'i18n', name)))
    return json.dumps(d, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')


def expand_includes(text):
    def repl(m):
        body = read(os.path.join(SRC, m.group(1) + '.html'))
        if m.group(1) == 'i18n':
            body = re.sub(r'/\*@dicts\*/.*?/\*@end\*/', lambda _m: i18n_json(), body, count=1, flags=re.S)
        return body
    return re.sub(r"<!-- @include ([A-Za-z0-9_]+) -->", repl, text)


def head_extras(config):
    site = config['siteUrl'].rstrip('/') + '/'
    e = html.escape
    tags = [
        '<meta name="viewport" content="%s">' % VIEWPORT,
        '<meta name="description" content="%s">' % e(DESCRIPTION, quote=True),
        '<meta name="theme-color" content="#1a1e29">',
        '<link rel="icon" type="image/png" href="favicon.png">',
        '<link rel="canonical" href="%s">' % e(site),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="XBill Web Remake">',
        '<meta property="og:locale" content="ja_JP">',
        '<meta property="og:title" content="%s">' % e(TITLE, quote=True),
        '<meta property="og:description" content="%s">' % e(DESCRIPTION, quote=True),
        '<meta property="og:url" content="%s">' % e(site),
        '<meta property="og:image" content="%sogp.png">' % e(site),
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="XBill のロゴと、PC・ケーブル・OS を頭に載せたビルの絵">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="%s">' % e(TITLE, quote=True),
        '<meta name="twitter:description" content="%s">' % e(DESCRIPTION, quote=True),
        '<meta name="twitter:image" content="%sogp.png">' % e(site),
        # ランキング API の URL。空なら、この端末だけのランキングになる
        '<script>window.XBILL_CONFIG = %s;</script>' % json.dumps({'rankingApi': config.get('rankingApi', '')}, ensure_ascii=False),
    ]
    return '\n  '.join(tags)


def check_scripts(page):
    """インラインの <script> を取り出して、node があれば構文を検査する。"""
    scripts = re.findall(r'<script>\n?([\s\S]*?)</script>', page)
    if not scripts:
        raise SystemExit('エラー: <script> が見つかりません')
    node = shutil.which('node')
    if not node:
        print('警告: node が無いので、JavaScript の構文検査を省略しました')
        return
    for i, code in enumerate(scripts):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write(code)
            path = f.name
        try:
            r = subprocess.run([node, '--check', path], capture_output=True, text=True)
            if r.returncode != 0:
                raise SystemExit('エラー: %d 番目の <script> の構文が不正です\n%s' % (i + 1, r.stderr))
        finally:
            os.unlink(path)
    print('JavaScript の構文: OK（%d 個の <script>）' % len(scripts))


def parse_args(argv):
    opts = {'out': DOCS, 'api': None}
    i = 0
    while i < len(argv):
        if argv[i] in ('--out', '--api') and i + 1 < len(argv):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            raise SystemExit('使い方: build_pages.py [--out 出力先] [--api ランキングAPIのURL]')
    return opts


def main():
    opts = parse_args(sys.argv[1:])
    out = os.path.abspath(opts['out'])
    config = json.loads(read(os.path.join(ROOT, 'pages.config.json')))
    if opts['api'] is not None:
        config['rankingApi'] = opts['api']
    page = expand_includes(read(os.path.join(SRC, 'index.html')))

    if '@include' in page:
        raise SystemExit('エラー: <!-- @include ... --> が残っています')

    page = re.sub(r'<title>.*?</title>', '<title>%s</title>' % html.escape(TITLE), page, count=1)
    page = page.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  ' + head_extras(config), 1)
    if 'name="viewport"' not in page:
        raise SystemExit('エラー: viewport を入れられませんでした')

    check_scripts(page)

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    open(os.path.join(out, '.nojekyll'), 'w').close()
    for name in ('ogp.png', 'favicon.png'):
        src = os.path.join(DOCS, name)
        if not os.path.exists(src):
            print('警告: docs/%s がありません。tools/make_ogp.py を実行してください' % name)
        elif out != DOCS:
            shutil.copy(src, os.path.join(out, name))
    print('wrote %s/index.html (%d KB), rankingApi=%r' % (out, len(page.encode('utf-8')) // 1024, config.get('rankingApi', '')))


if __name__ == '__main__':
    sys.exit(main())
