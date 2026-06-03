# `staff.json` — 職員・資格・常勤換算

事業所の職員（および外部有資格者）情報を扱う JSON。加算要件の配置判定（OR 条件・代替資格）に使う。

## 目的

- 加算要件で必要な職種・資格・常勤換算を機械判定するためのファクト供給
- 「機能訓練指導員 = PT/OT/ST だけでなく看護師・柔整師でも可」のような OR 条件を網羅する判定
- 外部 PT 等、従業員マスタに無い人材も登録可能

## いつ使うか

- Web UI の「staff_json アップロード」欄
- CLI `npm run judge -- --staff-data path/to/staff.json`
- CPOS 連携時は自動生成される

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `_meta.schema` | string | `"staff"` |
| `office_code` | string | 事業所コード |
| `service_key` | string | サービスキー |
| `staff[]` | array | 職員リスト（少なくとも 1 件） |

`staff[]` の各要素:

| パス | 型 | 説明 |
|---|---|---|
| `staff_id` | string | 匿名 ID（`STAFF-001` 推奨） |
| `role` | string | `kango / kaigo / saseki / cm / shunin_cm / kinou_kunren / rihabilitation` |
| `qualifications[]` | string | `"看護師"`, `"介護福祉士"`, `"理学療法士"` 等 |
| `fte` | number | 常勤換算（例: `1.0` = 常勤、`0.5` = 半常勤） |
| `active` | boolean | 在籍中かどうか |

## よく使う任意フィールド

| パス | 型 | 説明 |
|---|---|---|
| `is_joukin` | boolean | 常勤かどうか |
| `display_label` | string | 画面表示用の匿名ラベル（`架空職員A`） |
| `kinzoku_years` | number | 勤続年数（処遇改善加算等に使用） |
| `senjuu` | boolean | 専従かどうか |
| `note` | string | 補足（資格証エビデンスへの参照名など） |

## サンプル

```json
{
  "_meta": {
    "schema": "staff",
    "schema_version": "1.0",
    "office_code": "DEMO-0004",
    "tenant_id": "cpos-default",
    "updated": "2026-05-07"
  },
  "service_key": "tsusho_kaigo",
  "sample_policy": "public_demo_synthetic",
  "staff": [
    {
      "staff_id": "STAFF-001",
      "display_label": "架空職員A",
      "role": "kango",
      "qualifications": ["看護師"],
      "fte": 1.0,
      "active": true,
      "is_joukin": true
    },
    {
      "staff_id": "STAFF-002",
      "display_label": "外部PT",
      "role": "kinou_kunren",
      "qualifications": ["理学療法士"],
      "fte": 0.2,
      "active": true,
      "is_joukin": false,
      "note": "外部 PT。機能訓練指導員 OR 条件を満たす"
    }
  ]
}
```

## 個人情報

- 氏名・住所・電話番号・生年月日は **含めない**
- `staff_id` は匿名 ID にする（CPOS 側 `staff_id` 由来でも、加算マネージャのレポートには出ない）
- `display_label` は画面表示用の擬似ラベル
- `note` には人物特定可能な情報を書かない

## 安全策

サーバ側 `dsl.buildFactsFromStaffData` は `sample_policy === 'public_demo_synthetic'` でない場合に空ファクトを返します。これは「個人情報が含まれている可能性のあるファイル」を機械的にブロックするフェイルセーフです。

公開デモ・他社共有用には必ず `"sample_policy": "public_demo_synthetic"` を入れてください。

## バリデーション

```bash
npm run validate:json -- --kind staff --input path/to/staff.json
```

スキーマ: [staff.schema.json](/schemas/staff.schema.json)

## CPOS から自動生成される場合のマッピング

CPOS の `analysis-source` を取り込むと、`staffSummary.qualifiedPersonCountByProfession` と `fteByProfession` から **合成 staff[] が自動生成**されます。

| CPOS | staff.json |
|---|---|
| `qualifiedPersonCountByProfession.nurse: 3` | `staff[]` に `role=kango, qualifications=[看護師]` × 3 |
| `fteByProfession.nurse: 2.4` | 各 `fte=0.8`（=2.4/3） |
| `qualifiedPersonCountByProfession.physical_therapist: 1` | `role=rihabilitation, qualifications=[理学療法士]` |

詳しくは `app/src/services/cpos/transform.js` の `transformStaffSummary()` を参照。

## よくあるエラー

| エラー | 対処 |
|---|---|
| `staff[]` が空 | 1 件以上は必要 |
| `role` 値違反 | 既定値（`kango/kaigo/...`）を使う |
| `fte` が文字列 | 数値で書く |
| 個別資格名のスペル違い | `"看護師"`, `"介護福祉士"` の正字を使う |
