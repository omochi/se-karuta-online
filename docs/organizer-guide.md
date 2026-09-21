# 運営向けの説明つきスライド

公開対象は [`guide/`](guide/) 内の静的なWebサイトです。ビルドやゲームサーバーへの接続は不要です。

- 16枚のスライドと、各ページの説明文を収録しています。
- 「発表モード」でスライドのみ表示し、「一覧で読む」で説明文と一緒に通読できます。
- 左右キー、Page Up / Page Down、画面上のボタンで移動できます。
- `#3` のようなURLで特定のスライドを直接共有できます。
- スクリーンショットを押すと拡大します。画面と成績はローカルのデモデータです。

## ローカルで確認する

リポジトリのルートで次を実行し、<http://localhost:8139> を開きます。

```sh
python3 -m http.server 8139 --bind 127.0.0.1 --directory docs/guide
```

`slides.json` を読み込むため、HTMLファイルの直接オープンではなくHTTP経由で確認します。

## GitHub Pagesへ公開する

1. GitHubのリポジトリ設定で **Pages → Build and deployment → Source: GitHub Actions** を選びます。
2. 資料と `.github/workflows/guide-pages.yml` を `main` に反映します。
3. 「運営向けスライドをGitHub Pagesへ公開」が成功したら、ワークフローの公開URLから確認します。手動実行も可能です。

独自ドメインがない場合の公開先は `https://omochi.github.io/se-karuta-online/` です。これはゲーム本体ではなく紹介資料のURLです。GitHub PagesではWorkers / Durable Objects / D1を使うゲーム本体は動かしません。

公開方式は[GitHub公式のカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に基づきます。

## 内容を更新する

- `guide/slides.json`: 各スライドの文言、説明文、図の配置、実装の参照先。
- `guide/assets/`: 実画面のスクリーンショット。公開用のデモだけを使用します。
- `guide/slides.js` / `style.css`: ページ送り、発表・閲覧モード、レイアウト。

文章と図はHTML / SVGで描画しているため、画像化したスライドと異なり、文言の修正、検索、拡大ができます。画面写真だけを画像として配置しています。
