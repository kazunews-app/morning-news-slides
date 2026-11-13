# Morning Briefing — 毎朝のトレンドニューススライドアプリ

毎朝、**国内・総合 / テクノロジー・AI / ビジネス・経済** のトレンドニュースを収集し、見やすいスライドショー形式で閲覧できる Web アプリです。

## 主な機能

- **スライドショーUI**: 表紙・ニュースカード・振り返りまとめの3構成で見やすく表示
- **カテゴリフィルター**: 「すべて」「国内・総合」「テクノロジー・AI」「ビジネス・経済」で絞り込み
- **自動再生（オートプレイ）**: 朝の支度をしながら流して見られる自動スライド送り（8秒間隔）
- **目次一覧（Overview）**: すべてのトピックを一覧表示してジャンプ可能
- **テーマ切替**: 爽やかなライトモードと目に優しいダークモードをワンクリックで切替
- **キーボード・スワイプ対応**:
  - `→` / `Space`: 次のスライド
  - `←`: 前のスライド
  - `P`: 自動再生のオン/オフ
  - `O`: 目次一覧を開く
  - `F`: フルスクリーン切替

---

## 使い方

### 1. スライドを開く（PC）
`index.html` をダブルクリックしてブラウザ（Chrome / Edge など）で開くだけで動作します（サーバー起動やビルドは不要です）。

### 2. スマホから確認する（同じWi-Fi内）
PowerShell で以下のローカルWebサーバー起動スクリプトを実行します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_server.ps1
```

画面に表示された `スマホから開く: http://192.168.x.x:8080/` の URL を、同じWi-Fiに接続したスマホのブラウザで開いてください。スマホでは縦画面レイアウト・スワイプ操作・下部固定ナビゲーションで快適に閲覧できます。

### 3. 手動で最新ニュースを取得する
PowerShell で以下のスクリプトを実行すると、Google News RSS から最新記事を取得して `data/news.js` を更新します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fetch_news.ps1
```

### 3. 毎朝決まった時間に自動更新する（2つの方法）

#### 方法A: Windows タスクスケジューラを使う（完全ローカル自動実行）
以下のコマンドを PowerShell で1回実行すると、毎日朝7:00に自動でニュースを収集します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_schedule.ps1 -Time "07:00"
```

解除したい場合：
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_schedule.ps1 -Unregister
```

#### 方法B: Antigravity の `/schedule` 機能を使う（AI要約付き）
Antigravity のチャットで `/schedule` を使うと、毎朝 AI エージェントが最新ニュースを Web 検索し、「3つのポイント」や「注目・影響」を要約した高品質なスライドデータを `data/news.js` に自動生成させることもできます。
