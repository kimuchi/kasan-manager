# ポートフォリオ最適化

> 「現状あと一歩で取れる加算が複数ある。
> 限られた事務工数の中で、**どれから着手すれば最大の収益増になるか**を提案する」
> ためのシミュレータです。

## 何をやっているか

1. 判定エンジンの結果から、**「あと一歩で取れる」加算** を抽出
   - `algorithm_judgement` が `waiting` / `unknown` / `claimed_but_requirements_unknown`
   - `applicability` が `not_applicable` でないもの
2. 各加算について以下を見積もり:
   - **月額収益（円）** — 級地 × 算定対象者数 × 単位/日 × 稼働日数
   - **必要工数 (effort)** — 不足エビデンス件数（高優先度は 1.5×）
   - **優先度スコア (priority)** — 収益 / 工数 × priority_hint 補正
   - **連動加算ヒント** — 処遇改善系で何 % 上乗せされるか
3. priority 降順でランキング表示、各カードに「次にやることリスト」を提示

## 使い方

### UI

1. 履歴から解析を開く → 「📊 ポートフォリオ最適化」タブ
2. **級地を変えて再試算** のセレクタで地域単価を切り替え可能
3. 上位の候補から **アクションアイテム** が並ぶ
4. ログイン済なら、自分の過去レビュー判断（💡 通常承認/差戻し）が badge で表示される

### API

#### 解析の判定結果をその場で渡して最適化（無料プランでも利用可）

```http
POST /api/portfolio/optimize
Content-Type: application/json
X-CSRF-Token: <csrf>

{
  "judge": { ...judge.run() の戻り値... },
  "region_grade": "1"
}
```

`region_grade` は `"1"` 〜 `"7"` または `"other"`。未指定なら `judge.region_grade` を使い、
それも無ければ `"other"` に正規化されます。

#### 保存済の解析を対象にする（有料プラン）

```http
GET /api/analyses/:id/portfolio?region_grade=1
Authorization: Bearer <Firebase ID Token>
```

レスポンスには **自分の過去判断サマリ** (`learning_hint`) も自動で merge されます。

#### 級地表の取得

```http
GET /api/regional-grades
```

`1..7` と `other` の 8 グレード、上乗せ率、代表地域を返します。

#### 自分のレビュー学習サマリ

```http
GET /api/me/review-learning
Authorization: Bearer <Firebase ID Token>
```

過去 1000 件までの自分の review_decisions を kasan_key 別に集約。
`approved / returned / awaiting_review` のカウントと `tendency`（傾向ラベル）を返します。

## レスポンスのキー

主要なキーだけ抜粋:

```jsonc
{
  "service": "tsusho_kaigo",
  "service_month": "2026-04",
  "region_grade": "1",
  "region_grade_label": "1級地",
  "yen_per_unit": 10.9,
  "total_potential_yen_per_month": 2352350,
  "total_with_chain_yen_per_month": 2657030,  // 処遇改善連動を含めた合計
  "recommendation_count": 13,
  "recommendations": [
    {
      "kasan_key": "kobetsu_kinou_I_ro",
      "kasan_name": "個別機能訓練加算Ⅰ(ロ)",
      "algorithm_judgement": "unknown",
      "missing_evidence": [{ "label": "...", "next_action": "..." }],
      "revenue_per_month_yen": 510294,
      "revenue_with_chain_yen": 591241,           // 処遇改善上乗せを反映
      "target_user_count": 28,
      "target_user_source": "estimated",          // all|care_level|dementia|field|estimated|fallback|none
      "target_user_rationale": "個別機能訓練計画を作成できる利用者（推定 70%）",
      "days_per_month": 22,
      "unit_used": { "kind": "per_day", "value": 85 },
      "effort_score": 1.0,
      "priority_score": 510294,
      "interaction_hint": {
        "type": "chained_uplift",
        "rate": 0.159,
        "applied_kasans": [{ "kasan_key": "shoguu_kaizen_I" }],
        "label": "処遇改善系の連動で実質 +15.9% （≈ 81,137 円/月 上乗せ）",
        "bonus_yen_per_month": 81137
      },
      "learning_hint": {
        "approved": 5,
        "returned": 0,
        "awaiting_review": 1,
        "approval_rate": 1.0,
        "tendency": "consistently_approved",
        "last_decision": "approved",
        "last_decision_at": "2026-04-10T08:14:00.000Z"
      },
      "learning_tendency_label": "通常承認",
      "action_items": ["..."]
    }
  ],
  "assumptions": {
    "yen_per_unit": 10.9,
    "region_grade": "1",
    "region_grade_label": "1級地",
    "days_per_month": 22,
    "note": "..."
  }
}
```

## 計算式

### 月額収益

```
revenue_per_month_yen
  = unit              （単位/日 または 単位/月）
  × target_user_count （後述の filter で求める）
  × days_per_month    （月単位なら 1、それ以外は 22）
  × yen_per_unit      （regional-pricing 由来）
```

`revenue_per_user_per_day` が `roi_estimation` に明示されていればそれを優先します。

### 地域単価 (yen_per_unit)

```
yen_per_unit = 10 × (1 + 上乗せ率 × 人件費割合)
```

級地別の上乗せ率（厚労省告示）:

| 級地 | 上乗せ率 | 代表地域（例） |
|-----|---------|--------------|
| 1 級地 | 20% | 東京 23 区中心 |
| 2 級地 | 16% | 東京・神奈川の一部 |
| 3 級地 | 15% | 千葉・埼玉の一部 |
| 4 級地 | 12% | 中核都市の一部 |
| 5 級地 | 10% | 県庁所在地など |
| 6 級地 | 6% | 地方都市 |
| 7 級地 | 3% | 町村部 |
| その他 | 0% | それ以外 |

サービス別の人件費割合（同告示）:

| サービス | 人件費割合 |
|---------|----------|
| 訪問介護 / 訪問入浴 / 居宅介護支援 | 70% |
| 訪問看護 / 訪問リハ | 55% |
| 通所介護 / 通所リハ / 短期入所 / 小規模多機能 / 特養 | 45% |

例（通所介護・1 級地）: `10 × (1 + 0.20 × 0.45) = 10.90 円/単位`。

### 算定対象者数 (target_user_count)

`regulatory_master/target_user_filters.json` に定義された predicate を `user_summary` に対して評価します。

| predicate | 計算 |
|----------|------|
| `all` | `user_summary.users_total`（全員） |
| `care_level_min:N` | `youkaigo_N..5` の合計 |
| `dementia_min:LEVEL` | LEVEL 以上の認知症日常生活自立度の合計（I < IIa < IIb < IIIa < IIIb < IV < M） |
| `dementia_related` | `dementia_related_count` フィールド |
| `medical_dependency` | `medical_dependency_count` |
| `terminal` | `terminal_care_related_count` |
| `discharge_support` | `discharge_support_related_count` |
| `emergency_response` | `emergency_response_related_count` |
| `estimated_ratio:F` | `users_total × F`（推定割合のフォールバック） |

未定義の kasan は `all`（全員）として扱われます。

### 工数 (effort)

```
effort_score = 1.0 + Σ (missing_evidence × 重み)
```

重み:
- `priority = '高'` → 1.5
- それ以外 → 1.0

### 優先度

```
priority_score = (revenue / effort) × priority_hint_multiplier
```

`priority_hint` から:
- 「取得価値大」 → ×1.3
- 「ボーダー / 注意 / 要確認」 → ×0.95

数値そのものより **並び順** で判断してください。

## 連動加算（処遇改善等）

処遇改善加算 / 特定処遇改善加算 / ベースアップ等支援加算は、本体報酬に **対する % 上乗せ** の加算です。判定結果でこれらが `currently_claimed` または `clear` であれば、各候補に
`interaction_hint.bonus_yen_per_month` として「実質いくら上乗せされるか」を併記します。

```
処遇改善加算Ⅰ (約 13.7%) + ベースアップ (約 2.2%) → 候補本体の +15.9%
```

なお現実装は単純化しており、加算ごとの「処遇改善対象/対象外」を厳密に判別はしません。
**目安値** として使ってください。

## 学習ヒント (Firebase ログイン時のみ)

自分が過去にレビューでどう判断したかを集計し、各加算カードに badge で表示します。

| tendency | 表示 | 条件 |
|----------|------|------|
| `consistently_approved` | 通常承認 | approved ≥ 3 かつ returned = 0 |
| `consistently_returned` | 通常差戻し | returned ≥ 3 かつ approved = 0 |
| `usually_approved` | 承認傾向 | approved ≥ 2 × returned |
| `usually_returned` | 差戻し傾向 | returned ≥ 2 × approved |
| `mixed` | 判断分かれる | 上記いずれにも該当しない |
| `sample_too_small` | （履歴少） | 判定済合計 < 2 |

「いつも返している加算」を反射的に承認しないよう、レビュー時の注意喚起として機能します。

## 前提と限界（現時点）

1. **地域単価**: ✅ 級地 × サービスの人件費割合で正確に計算（市区町村→級地の自動マッピングは未実装）
2. **算定対象者数**: ✅ 構造化フィールド + 推定比率で計算。utilization rate（実際に算定された日数 / 総日数）は加味していません
3. **連動加算**: ✅ 処遇改善系の概算 % 上乗せをヒント表示。実際のサービス区分・取得状況に応じた厳密値ではありません
4. **学習**: ✅ 自分の過去判断を表示。AI で「ほぼ自動承認」する機能はまだありません

## ロードマップ

- [x] 地域単価（級地）対応
- [x] 算定対象者数の精緻化（要介護度・認知症レベル・推定比率）
- [x] 連動加算ヒント（処遇改善・特定処遇改善・ベースアップ）
- [x] 自分の過去判断をヒント表示
- [ ] 市区町村 → 級地の自動マッピング
- [ ] 利用日数の推定（user_summary や CPOS 実績から）
- [ ] 工数の人時 (h) 推定（証跡種別ごとの平均工数を持つ）
- [ ] AI による自動承認候補の提示（学習データから）

## 関連ファイル

- 実装:
  - `app/src/services/portfolio.js` — メインロジック
  - `app/src/services/regional-pricing.js` — 地域単価
  - `app/src/services/target-user-filter.js` — 算定対象者
  - `app/src/services/interaction-hints.js` — 連動加算ヒント
  - `app/src/services/review-learning.js` — 学習ヒント
- 設定:
  - `regulatory_master/regional_unit_prices.json`
  - `regulatory_master/target_user_filters.json`
- エンドポイント: `app/src/server.js` の
  `/api/portfolio/optimize`, `/api/analyses/:id/portfolio`,
  `/api/regional-grades`, `/api/me/review-learning`
