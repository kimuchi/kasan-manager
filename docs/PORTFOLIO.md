# ポートフォリオ最適化 PoC

> 「現状あと一歩で取れる加算が複数ある。
> 限られた事務工数の中で、**どれから着手すれば最大の収益増になるか**を提案する」
> ための簡易シミュレータです。

## 何をやっているか

1. 判定エンジンの結果から、**「あと一歩で取れる」加算** を抽出
   - `algorithm_judgement` が `waiting` / `unknown` / `claimed_but_requirements_unknown`
   - `applicability` が `not_applicable` でない
2. 各加算について以下を見積もり:
   - **月額収益（円）**: `revenue_per_user_per_day` または `unit_per_day` から推定
   - **必要工数 (effort)**: 不足エビデンスの件数（高優先度は 1.5 倍）
   - **優先度スコア (priority)**: `収益 / 工数 × priority_hint 補正`
3. priority 降順でランキング表示

## 使い方

### UI

1. 履歴から解析を開く → 「📊 ポートフォリオ最適化」タブ
2. 上位の候補から **アクションアイテム** が並ぶ
3. 1 つやれば 1 つ加算が取れる、という構造

### API（無料プランでも使える）

inline で judge JSON を渡せば誰でも呼べます（保存はされません）。

```
POST /api/portfolio/optimize
Content-Type: application/json
X-CSRF-Token: <csrf>

{
  "judge": { ...judge.run() の戻り値... }
}
```

レスポンス:
```json
{
  "ok": true,
  "portfolio": {
    "service": "tsusho_kaigo",
    "service_month": "2026-04",
    "total_potential_yen_per_month": 3000484,
    "recommendation_count": 13,
    "recommendations": [
      {
        "kasan_key": "kobetsu_kinou_I_ro",
        "kasan_name": "個別機能訓練加算Ⅰ(ロ)",
        "algorithm_judgement": "unknown",
        "missing_evidence": [...],
        "revenue_per_month_yen": 686858,
        "effort_score": 1.0,
        "priority_score": 686858,
        "rationale": "概算 686,858円/月",
        "action_items": ["..."]
      },
      ...
    ],
    "assumptions": {
      "yen_per_unit": 10.27,
      "days_per_month": 22,
      "note": "..."
    }
  }
}
```

### 保存済 analysis から（有料プラン）

```
GET /api/analyses/:id/portfolio
Authorization: Bearer <Firebase ID Token>
```

## 収益見積もりの計算式

```
revenue_per_month_yen
  = unit_per_day               (単位/日)
    × users_total              (利用者総数)
    × days_per_month           (= 22。実稼働日数の概算)
    × yen_per_unit             (= 10.27 円/単位。6 級地)
```

`unit_type` に「月」が含まれる加算は `days_per_month = 1` として扱います
（月固定の加算）。

`revenue_per_user_per_day` が `roi_estimation` に明示されていればそれを優先します。

## 工数見積もりの計算式

```
effort_score
  = 1.0                         (基本)
    + sum(missing_evidence の重み)
```

不足エビデンス 1 件あたりの重み:
- `priority = '高'` → 1.5
- それ以外      → 1.0

例: 不足エビデンスが「高」1 件 + 「中」2 件 → effort = 1 + (1.5 + 1.0 + 1.0) = 4.5

## 優先度スコア

```
priority_score
  = (revenue_per_month_yen / effort_score)
    × priority_hint_multiplier
```

`priority_hint` から:
- 「取得価値大」を含む → ×1.3
- 「ボーダー / 注意 / 要確認」を含む → ×0.95

数値の絶対値より、**並び順** を信用してください。「上位 N 件を片付ければ
収益カーブが立ち上がる」という相対比較が目的です。

## 前提と限界

1. **地域単価は固定 10.27 円**（6 級地）。1 級地（東京 23 区中心）は 11.40 円、
   その他級地はもっと低い。地域単価による補正はまだ入れていません。
2. **利用者総数 = 算定対象者数** と仮定。実際は「要介護 3 以上限定」「個別機能訓練対象者のみ」
   など制限がある加算が多く、利用率（uptake）も加算ごとに異なります。
3. **工数は不足エビデンス件数のプロキシ**。実際の工数は「証跡を整える」「会議を開く」
   「規程を整備する」など項目によって大きく違います。
4. **連動加算（処遇改善加算ベースアップ等）は考慮していません**。実際には
   1 つ取ると他の加算も連動して取れる/取れないケースが多いです。

これらは将来的に強化していく予定です。当面は **「優先順位を決める材料」** として
ご活用ください。

## ロードマップ

- [ ] 地域単価（級地）対応
- [ ] 算定対象者数の精緻化（要介護度・記録の有無で絞り込み）
- [ ] 連動加算の考慮（処遇改善・特定処遇改善・ベースアップ）
- [ ] 「やる / やらない」を保存して、次回からのレコメンドに反映（学習）
- [ ] 工数の人時 (h) 推定（証跡種別ごとの平均工数を持つ）

## 関連ファイル

- 実装: `app/src/services/portfolio.js`
- エンドポイント: `app/src/server.js` の `/api/portfolio/optimize` と
  `/api/analyses/:id/portfolio`
- マスタの roi_estimation: `regulatory_master/kaigo/*.json` 内の各 kasan の
  `roi_estimation` フィールド
