# XBill Web Remake

1994 年の X Window System 用ゲーム **XBill** を、ブラウザで遊べるように移植したものです。GitHub Pages で公開しています。

> ビル軍団（Bill）が、あなたのコンピュータの OS を Wingdows に入れ替えようとしてきます。ビルを叩いて、OS を守りましょう。

## 遊ぶ

<https://kawade502.github.io/xbill-webremake/>

- スマホ（縦向き）でもパソコンでも遊べます。ログインは不要です。
- Google Apps Script 版もあります: [Kawade502/xbill-gas](https://github.com/Kawade502/xbill-gas)（ゲームは同じです。ランキングは別々です）

## 遊び方

1. **ビルを叩く**: クリック（タップ）で倒します。重なったビルを一度に倒すほど高得点です（倒した数の 2 乗 × 5 点）。
2. **OS を取り戻す**: ビルは PC の OS を Wingdows に入れ替え、盗んだ OS を頭に載せて逃げます。叩くと OS を落とすので、ドラッグして同じ種類の PC に戻します。逃げ切られたビルは、また戻ってきます。
3. **火花を止める**: ケーブルでつながった PC の片方だけが Wingdows だと、そこから相手へ火花が走ります。左上のバケツをドラッグして火花にかけると、火花が最初からやり直しになるだけです。火花を止めるには、Wingdows になっている側の PC に、落ちている OS をドラッグして戻します（両方が Wingdows でなくなれば止まります）。火花で Wingdows になった PC は元の OS が落ちないので、ほかのビルを叩いて落とした OS を使います。
4. 動いている PC が 1 台以下になるとゲームオーバーです。レベルが終わるたびに、稼働率に応じたボーナスが入ります。
5. **レベル 10 をクリアで全クリア**です。

## 多言語対応

日本語・English・简体中文・繁體中文・한국어・Español・Français・Deutsch・Português・Русский・हिन्दी・Bahasa Indonesia・Italiano・Nederlands・Polski・Türkçe の16言語に対応しています。ブラウザの言語設定から自動で選び、タイトル画面の 🌐 で切り替えられます（選んだ言語は端末に保存。`?lang=en` のようにURLでも指定できます）。

- 辞書は `src/i18n/<言語>.json`（日本語が基準）。`python3 tools/check_i18n.py` で、鍵の過不足・`{n}` などの食い違い・日本語の混入を検査できます
- 日本語以外の翻訳は AI による下書きです。不自然な表現があれば、JSON を直して PR か Issue でお知らせください
- OS 名・Wingdows・アーケード風の英語タイトル（SCORE / LEVEL など）は、訳さずそのまま使っています

## 全クリア証明書

レベル10をクリアすると、結果画面に「証明書をダウンロード」ボタンが出ます。名前・最終スコア・日付を入れた PNG 画像（1200×800）を、ブラウザの中で作って保存します（サーバーには何も送りません）。スコアは自己申告で、サーバーでの検証はありません。

## 全クリア記念 SBT

レベル10をクリアすると、結果画面から、記念の SBT（譲渡できない NFT）を希望できます（任意）。

- Ethereum や Polygon で使う自分のウォレットのアドレス（MetaMask などの、0x で始まる42文字）を入力して申請します。SBT は Polygon に発行され、同じアドレスで受け取れます。発行は運営者が後日、手作業で行います（発行は保証されません）
- 記録されるのは、受取アドレス・クリアした日（UTC）・通し番号です。これらはブロックチェーン上に公開されます
- 金銭的な価値はありません。受け取った SBT は自分で消せます（発行の記録はチェーン上に残ります）
- 申請で送るのは、アドレス・名前・スコアだけです。スコアは自己申告のため、運営者が内容を見て発行を判断します。名前とスコアは、発行または見送りのあとに消します
- コントラクト: `0x54Cf87755CFC5a67e99ea648945614797106A65C`（Polygon、[PolygonScan](https://polygonscan.com/address/0x54Cf87755CFC5a67e99ea648945614797106A65C#code)）

## 特徴

- オリジナル XBill 2.1 の C ソースをもとに、PC とケーブルの配置、ビルの動き、OS の入れ替え、火花とバケツ、得点、終了条件を移植しています。
- 絵はオリジナルのものをそのまま使っています。
- ランキング（名前とスコア）を Cloudflare Workers + KV に保存します。

## 仕組みとファイル構成

ゲーム本体は、サーバーの要らない静的なページです。ランキングだけ、小さな API（Cloudflare Workers）を呼びます。

```
src/                    ゲームの部品（ビルドで 1 枚の HTML にまとめる）
  index.html              画面の骨組み。<!-- @include 名前 --> で下の部品を読み込む
  styles.html             CSS
  assets.html             オリジナルの絵（自動生成）
  sprites.html            絵の読み込みと描画
  sound.html              効果音
  game.html               ゲーム本体（ルール、操作、画面、ランキングの画面）
docs/                   GitHub Pages で公開する完成品（ビルドの出力。手で編集しない）
worker/                 ランキング API（Cloudflare Workers + KV）とそのテスト
tools/build_pages.py    src/ から docs/index.html を作る
tools/make_assets.py    オリジナルの絵（XPM）から src/assets.html を作る
tools/make_ogp.py       SNS 共有用の画像（docs/ogp.png）とファビコンを作る
third_party/xbill-2.1/  オリジナルの絵の元データ、README、ライセンス表記
pages.config.json       公開 URL と、ランキング API の URL
```

## 自分で公開する

### 1. ランキング API（Cloudflare Workers）

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create RANKING     # 出た id を wrangler.toml の id に書く
npx wrangler deploy                          # 出た Worker の URL を、次の pages.config.json に書く
npm test                                     # テスト
```

`wrangler.toml` の `ALLOWED_ORIGINS` に、ゲームを公開する URL の Origin（例: `https://ユーザー名.github.io`）を入れます。
API の URL が空のままだと、ランキングはその端末のブラウザにだけ保存されます。

### 2. ページのビルドと公開（GitHub Pages）

```bash
# pages.config.json の siteUrl と rankingApi を自分の URL に書き換える
python3 tools/make_ogp.py        # 共有画像（必要なときだけ）
python3 tools/build_pages.py     # docs/index.html を作る
```

`docs/` をコミットして push し、リポジトリの Settings → Pages で、Branch を `main`、フォルダを `/docs` にします。

### 手元で確認する

```bash
(cd worker && npx wrangler dev --port 8787) &
python3 tools/build_pages.py --out /tmp/xbill-local --api http://127.0.0.1:8787
(cd /tmp/xbill-local && python3 -m http.server 8000 --bind 127.0.0.1)   # http://127.0.0.1:8000/
```

### ランキングの保存先

Worker の KV（キー `ranking`）に、上位 20 件を JSON で保存します。KV には排他制御がなく、反映に最大 1 分ほどかかることがあります。
白紙に戻すには、`npx wrangler kv key delete ranking --binding RANKING --remote` を実行します。

## 難易度の調整

`src/game.html` の `LEVELS`（レベルごとの、ビルの数・出現の勢い・速さなど）だけを変えれば調整できます。
PC の台数とケーブルの本数は、オリジナルの式のままです。

## アクセス解析

公開ページでは、Cloudflare Web Analytics でアクセス数を数えています。Cookie を使わず、個々の訪問者を追跡しません（ページビュー・国・参照元・端末の種類などの集計だけ）。

- 計測用のトークンは `pages.config.json` の `analyticsToken`（ページに載る公開用の値）。空にすると計測しません
- 計測スクリプトは、公開用の `docs/` を作るときだけ入れます（`--out` を付けた手元の確認用には入れません）

## ライセンスとクレジット

- ライセンス: **GPL-3.0 以降**（[`LICENSE`](LICENSE)）
- オリジナル: XBill 2.1 — Copyright (C) Brian Wellington, Matias Duarte（<http://www.xbill.org/>）
- 詳しくは [`NOTICE.md`](NOTICE.md) を見てください。
