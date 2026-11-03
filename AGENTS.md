# AGENTS.md

×はどこだ：広告をよけて記事を最後まで読むタイムアタック。単体の `index.html` を GitHub Pages で公開する。

## 準備（最初に一度）

```bash
bash scripts/setup.sh   # Node.js（版は .nvmrc）を確かめ、検査の依存とブラウザを入れる。何度実行してもよい
```

## push する前の確認

```bash
node qa/run.mjs      # 形・乱数（500回）・通しで遊ぶ・押してはいけない所・記録・スマホ幅・外へ通信しない・PWA（CI の QA と同じ）
node qa/run.mjs 20   # 広告の組み合わせを変えたときは、通しを20回ずつに増やして確かめる
```

## このリポジトリの決まり

- ゴールは記事を最後まで読むこと。タイムアタック（ヒントは+5秒）。まちがって広告を押すと、ウイルスに感染したような画面になってゲームオーバー。
- 本物っぽさを優先する。広告の文言・商品・サイト・記事は「ありそうな普通のもの」にし、笑わせる文言（「（うそ）」のようなツッコミ）は入れない（2026-11-03 satouさん）。
- 広告・サイト・会社・商品はすべて架空。実在の会社名・ロゴ・ブラウザや OS の本物そっくりの画面は使わない。本物の広告（広告の部品・外への通信）は入れない。
- 広告の出方は本物のサイトに寄せる：本文の間の広告・下に貼りつく広告（×で閉じられる）・ときどき画面をふさぐ広告・ページを移るときの全画面広告。ふさぐ広告どうしの間は1画面の0.75以上あける（qa が見る）。
- 広告の種類を足すときは `TYPES` に `lv`（1〜3）と `hint` を書き、`qa/run.mjs` の `solve()` に正しい閉じ方を足す。
- 乱数で組む部分（広告の組み合わせ・関所の位置）は、1回遊ぶだけでなく何百回も作って毎回の結果を確かめる（shared-workflows `incidents/2026-10-31-roppo-empty-village.md`）。
- 機能を足す・直すたびに `qa/run.mjs` に検査を足す。
- PWA（`manifest.webmanifest`・`sw.js`・`icon-*.png`）：画面のファイルを足したら `sw.js` の `SHELL` にも足し、中身を大きく変えたら `CACHE` の版を上げる。sw.js は外へ何も送らない。
- 記録は遊ぶ人のブラウザ（localStorage）にだけ置き、外へ送らない。公開リポジトリなので、個人情報・鍵を入れない。

## 公開

- GitHub Pages は `main` のルート（`/`）を公開する。PR の QA と Secret scan が ✅ になると `automerge.yml` が自動でマージする。止めたいときは下書きにするか、ラベル「自動マージしない」を付ける。
- PWA の仕組み（`sw.js`・`manifest.webmanifest`）を変える PR は自動ではマージされない（`hold_paths`）。CodeRabbit のレビューを待ち、手でマージする直前に今の head へのレビューのスレッドを読み直す（shared-workflows `incidents/2026-11-01-roppo-merged-before-review.md`）。

## 共通のきまり

- PR の作り方・マージの仕方は satou-aaaaa/shared-workflows の `routines/pr.md`、全体のきまりは `routines/common.md` に従う。
- CI の部品は shared-workflows の共通部品を呼ぶ。リポジトリ側の .github/workflows には呼び出しと設定値だけを書く。
- Claude 以外の AI・人が作業するときは、shared-workflows の `routines/tool-map.md` と `routines/without-claude.md` を読む。
