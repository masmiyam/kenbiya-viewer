# 健美家 収益物件ビューア

健美家の収益物件を1時間ごとに自動収集し、GitHub Pages で閲覧・Excel出力できるサイトです。

## セットアップ手順

### 1. このリポジトリを GitHub に作成

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_NAME/kenbiya-viewer.git
git push -u origin main
```

### 2. GitHub Pages を有効化

1. リポジトリの **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. **Save**

→ `https://YOUR_NAME.github.io/kenbiya-viewer/` でサイトが公開されます

### 3. GitHub Actions の権限設定

1. **Settings** → **Actions** → **General**
2. **Workflow permissions** → **Read and write permissions** を選択
3. **Save**

### 4. 初回クロール（手動実行）

1. **Actions** タブ → **Crawl Kenbiya Properties**
2. **Run workflow** ボタンをクリック
3. 完了したら `data/properties.json` にデータが保存されます

以降は1時間ごとに自動実行されます。

## クロール間隔の変更

`.github/workflows/crawl.yml` の `cron` 行を変更:

```yaml
# 1時間ごと
- cron: '0 * * * *'

# 2時間ごと（推奨）
- cron: '0 */2 * * *'

# 6時間ごと
- cron: '0 */6 * * *'

# 毎日 AM 9時（JST）
- cron: '0 0 * * *'
```

## 取得できる物件情報

| フィールド | 説明 |
|-----------|------|
| 物件名 | 物件のタイトル |
| 種別 | アパート / マンション / 一棟 / 戸建 等 |
| 価格 | 販売価格（万円） |
| 利回り | 表面利回り（%） |
| 築年数 | 建築からの年数 |
| 面積 | 建物 / 土地面積 |
| 所在地 | 住所 |
| URL | 健美家の物件詳細ページ |

## フィルタ・検索機能

- 物件種別チェックボックス
- 価格レンジ（万円）
- 利回りレンジ（%）
- 築年数（〇年以内）
- 都道府県選択
- フリーキーワード検索

## Excel ダウンロード

- フィルタ後の物件を `.xlsx` でダウンロード
- ヘッダー行に色付き、オートフィルタ、行固定
- 利回りに応じて色分け（高：緑 / 中：オレンジ / 低：赤）
- URLはハイパーリンク付き

## 注意事項

- 健美家の[利用規約](https://www.kenbiya.com/info/terms.html)を必ず確認してください
- 取得データの商用利用には注意が必要です
- GitHub Actions の無料枠（月2,000分）内で運用できます（1時間ごと×1分/回 = 月720分）
