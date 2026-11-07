# 副業管理ツール

副業の収支・案件・税務をひとまとめに管理するための、単一 HTML ファイルの Web アプリです（`index.html` のタイトル／ヘッダー表記に基づく）。

## できること

- **ダッシュボード**: 今月の収入・支出・純利益・利益率を表示。月別収支の棒グラフと、経費カテゴリ内訳のドーナツグラフ（Chart.js 使用）
- **登録・一覧**: 種別（収入／支出）・日付・内容／案件名・金額・カテゴリで取引を登録。月での絞り込み、削除、CSV ダウンロードに対応
- **年間レポート**: 対象年を選んで、月別収支サマリー（収入・支出・純利益・利益率）を確認

登録データはブラウザの `localStorage`（キー: `fukugyou`）に保存されます。

## 開き方

`index.html` をブラウザで開いてください。ビルドは不要です。

グラフ表示には CDN（jsDelivr）から Chart.js 4.4.0 を読み込むため、表示にはインターネット接続が必要です。

## テスト

セキュリティ回帰テストがあります。

- `security.test.js` — Node.js のテストランナーで実行するテスト（表示時の文字列の literal 扱い、CSV のクォート／数式無害化など）
- `browser.test.js` — Playwright（Chromium）で実際にブラウザ上で確認するテスト

CI: `.github/workflows/security-tests.yml` が `push` / `pull_request` で Node.js 22 を使って両テストを実行します。

ローカル実行の例（CI の手順に基づく）:

```sh
node --test security.test.js
npm install --no-save playwright
npx playwright install --with-deps chromium
node browser.test.js
```
