# レビュアーガイド（有料プラン）

加算マネージャの判定結果を**事業所責任者・社労士・ケアマネ等の人間レビュアー**が
加算ごとに確認し、「承認 / 差戻し / 保留」で判断を残せる機能のガイドです。

## 前提

- Firebase Authentication でログイン済
- アクセスコードを redeem して **有料プラン** が有効

無料プランでは履歴が保存されないため、Reviewer 機能は使えません。
アクセスコードの入手と redeem 手順は [AUTH_AND_PLANS.md](AUTH_AND_PLANS.md) を参照。

## レビューワークフロー

```
解析実行
   │
   ▼
[draft] 保存                  ← 初期状態。レビュー未着手
   │
   ▼
加算ごとに判断
   │
   ├── 承認 (approved)       ← この加算は問題なく取れる
   ├── 差戻し (returned)     ← 担当者に修正・追加証跡を依頼
   └── 保留 (awaiting_review) ← 後で確認する
   │
   ▼
[全体ステータス] 自動集約
   ├── 全 kasan approved      → [approved]
   ├── 1 件でも returned      → [returned]
   ├── 1 件でも awaiting      → [awaiting_review]
   └── 何も判断していない     → [draft]
```

全体ステータス（`analysis_jobs.review_status`）は **kasan ごとの最新決定** から自動で
再計算されます。レビュアーが手動で全体ステータスを変更する API はありません。
これは「いつ・誰が・どの加算を判断したか」を一意の真実とするためです。

## UI から使う

1. ヘッダー右上の「ログイン」または「プラン管理」をクリック
2. 「🗂 解析履歴」のリストから対象の解析を選び、「**詳細・レビュー**」を押す
3. 詳細パネルが開く。タブで切り替え可能:

### 📋 加算別 / レビュー タブ

各加算がカード形式で表示されます。

- **承認**: 「この加算は取れる」とレビュアーが確認した
- **差戻し**: 担当者に確認・修正を依頼する状態
- **保留**: 一時的に判断保留（後で別レビュアーが見る）

各ボタンの左にあるテキストボックスに**コメント**を入れてから押すと、決定と一緒に記録されます。

絞り込み:
- ☑ 未判定のみ: すでに「承認」した加算を非表示
- ☐ waiting/unknown のみ: あと一歩で取れる候補だけに絞る
- テキスト検索: 加算名で部分一致

#### 💡 学習ヒント badge

ログイン済の場合、各加算カードの右側に **自分が過去にこの加算をどう判断していたか**
を要約した badge が表示されます。

| 表示 | 意味 | 条件 |
|------|------|------|
| 💡 通常承認 (✅3/↩0) | 過去全部承認している | approved ≥ 3 かつ returned = 0 |
| 💡 通常差戻し (✅0/↩3) | 過去全部差戻している | returned ≥ 3 かつ approved = 0 |
| 💡 承認傾向 (✅5/↩1) | 承認が圧倒的に多い | approved ≥ 2 × returned |
| 💡 差戻し傾向 (✅1/↩4) | 差戻しが圧倒的に多い | returned ≥ 2 × approved |
| 💡 判断分かれる (✅3/↩3) | 半々で判断している | 上記いずれにも該当しない |
| 💡 （履歴少） | サンプル不足 | 判定済合計 < 2 |

「いつも返している加算」を反射的に承認してしまわないよう、レビューを開始する前の参考に。
詳しいデータは `GET /api/me/review-learning` から取得可能（[PORTFOLIO.md](./PORTFOLIO.md) も参照）。

### 📊 ポートフォリオ最適化 タブ

[PORTFOLIO.md](PORTFOLIO.md) も合わせて参照。

「あと一歩で取れる加算」を **概算月額収益 × 必要工数** でランキング表示します。
レビュアーが「次に着手すべき加算」を判断する材料として使えます。

### 📜 Markdown レポート タブ

判定エンジンが出力した完全な Markdown レポート（保存時点のスナップショット）。
コピーして他のドキュメントに貼れます。

### 🕘 レビュー履歴 タブ

`review_decisions` コレクションから、この解析に対する全てのレビュー判断を時系列で表示。
誰が、いつ、どの加算をどう判断したか、コメント込みで全部見えます。

## API から使う

### 加算別レビューの記録

```
POST /api/analyses/:id/review
Authorization: Bearer <Firebase ID Token>
X-CSRF-Token: <csrf>

{
  "kasan_key": "chujudosha_care_taisei",
  "decision": "approved",
  "comment": "看護常勤換算 2.4 名で要件クリアを確認"
}
```

`kasan_key` を省略すると「解析全体に対するレビュー」として `__overall__` キーに記録されます。
が、原則として個別加算単位で判断することを推奨します。

### レビュー履歴の取得

```
GET /api/analyses/:id/decisions
GET /api/analyses/:id/decisions?kasan_key=chujudosha_care_taisei
```

返り値:
```json
{
  "ok": true,
  "decisions": [
    { "decision": "approved", "kasan_key": "...", "comment": "...", "decided_at": "...", "reviewer_email": "..." },
    ...
  ],
  "per_kasan_status": {
    "chujudosha_care_taisei": { "decision": "approved", "decided_at": "...", "reviewer_email": "..." }
  }
}
```

## 監査ログ

すべてのレビュー判断は `audit_logs` コレクションにも `event_type=review_decision` として
記録されます。後から「いつ誰が何を判断したか」を一覧で監査できます。

## データの寿命

- `analysis_jobs/*` / `review_decisions/*`: 削除依頼があるまで永続保持
- `audit_logs/*`: 法令保全観点で **1 年保持を推奨**、その後削除
- GCS `analyses/{uid}/*`: Firestore に合わせる

削除依頼への対応は [AUTH_AND_PLANS.md §データ削除依頼への対応](AUTH_AND_PLANS.md) を参照。
