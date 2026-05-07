# `user_summary.json` — 利用者集計

利用者個別情報ではなく、**集計値のみ** を扱う JSON。氏名・被保険者番号などの PII を一切含まないため、公開デモ・他社共有・本番運用すべてで安全に使えます。

## 目的

- 利用者数・要介護度分布・要介護3以上比率などの集計値で加算判定
- 個別利用者を扱わない設計のため、PII 漏えいリスクなし

## いつ使うか

- Web UI の「user_summary_json アップロード」欄
- CLI `npm run judge -- --user-summary path/to/user_summary.json`
- CPOS 連携時に自動生成される

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `_meta.schema` | string | `"user_summary"` |
| `_meta.office_code` | string | 事業所コード |
| `_meta.tenant_id` | string | 法人 ID |
| `summary.total_users` | integer | 利用者数 |

## よく使う任意フィールド

| パス | 型 | 説明 |
|---|---|---|
| `summary.care_level_distribution` | object | 要介護度別の人数。キーは `youshien_1`, `youkaigo_1`〜`youkaigo_5` |
| `summary.yokaigo_3plus_ratio` | number | 要介護3以上の比率（0.0〜1.0） |
| `summary.severe_user_count` | integer | 重度者数 |
| `summary.ninchi_jiritsudo_distribution` | object | 認知症自立度の分布 |

## サンプル

```json
{
  "_meta": {
    "schema": "user_summary",
    "schema_version": "1.0",
    "office_code": "DEMO-0004",
    "tenant_id": "cpos-default",
    "updated": "2026-05-07",
    "anonymization_status": "aggregated",
    "data_source_type": "cpos_aggregate"
  },
  "summary": {
    "total_users": 42,
    "care_level_distribution": {
      "youshien_1": 3,
      "youshien_2": 4,
      "youkaigo_1": 10,
      "youkaigo_2": 12,
      "youkaigo_3": 7,
      "youkaigo_4": 4,
      "youkaigo_5": 2
    },
    "yokaigo_3plus_ratio": 0.3095,
    "severe_user_count": 13
  }
}
```

## 個人情報

**含めません。** 設計上、個別利用者の情報は持てません。氏名・被保険者番号などを書こうとしても、判定エンジンは `summary` 配下しか読みません。

`anonymization_status: "aggregated"` を書いて意図を明示してください。

## バリデーション

```bash
npm run validate:json -- --kind user_summary --input path/to/user_summary.json
```

スキーマ: [user_summary.schema.json](/schemas/user_summary.schema.json)

## CPOS から自動生成される場合のマッピング

| CPOS | user_summary.json |
|---|---|
| `userSummary.activeUserCount` | `summary.total_users` |
| `userSummary.careLevelDistribution.{care3,care4,care5}` | `summary.care_level_distribution.{youkaigo_3,4,5}` |
| `userSummary.care3PlusRatio` | `summary.yokaigo_3plus_ratio` |

詳しくは `app/src/services/cpos/transform.js` の `transformUserSummary()` を参照。

## よくあるエラー

| エラー | 対処 |
|---|---|
| `total_users` がゼロ | 0 だと判定対象なしになる。実数を入れる |
| `yokaigo_3plus_ratio` を `30%` のように書いた | 0〜1 の小数で（例: `0.3`） |
| `care_level_distribution` のキー違い | `youkaigo_3` のような snake_case 必須 |
