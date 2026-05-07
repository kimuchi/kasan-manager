# `cpos_export_bundle.json` — CPOS 連携統合形式

CPOS の `/api/platform/kasan/export` が返す統合 bundle 形式。加算マネージャは これを既存判定エンジンの入力（`tenant_status` / `staff` / `user_summary` / `evidence`）に変換する。

## 目的

- CPOS 一回呼び出しで加算分析に必要な全情報を取得
- `formatVersion` で互換性を担保

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `formatVersion` | string | 現在 `"1"` |
| `facility.id` | string | 事業所 ID |
| `serviceMonth` | string | `YYYY-MM` |

## 任意フィールド

| パス | 型 | 説明 |
|---|---|---|
| `staffSummary` | object | 職員集計（`qualifiedPersonCountByProfession` 等） |
| `userSummary` | object | 利用者集計 |
| `claimSummary` | object | 請求集計（加算別件数・単位数） |
| `benefitManagementSummary` | object | 給付管理集計 |
| `fteSummary` | object | 常勤換算集計 |
| `source.authMethod` | string | `personal_access_token` / `app_token` |
| `source.subjectUserId` | string | CPOS の発行ユーザ ID |
| `source.tokenPreview` | string | PAT のプレビュー（先頭 14 文字） |

## サンプル

```json
{
  "formatVersion": "1",
  "generatedAt": "2026-05-07T12:00:00.000Z",
  "organizationId": "default",
  "facility": {
    "id": "facility-a",
    "name": "デイほっと",
    "businessNumber": "1234567890",
    "serviceTypeCodes": ["15"]
  },
  "serviceMonth": "2026-04",
  "serviceKey": "tsusho_kaigo",
  "source": {
    "system": "CPOS",
    "authMethod": "personal_access_token",
    "subjectUserId": "user_xxx",
    "tokenPreview": "cpos_pat_abcd...wxyz"
  },
  "staffSummary": {
    "qualifiedPersonCountByProfession": { "nurse": 3, "care_worker": 8 },
    "fteByProfession": { "nurse": 2.4, "care_worker": 6.8 }
  },
  "userSummary": {
    "activeUserCount": 42,
    "careLevelDistribution": { "care3": 7, "care4": 4, "care5": 2 },
    "care3PlusRatio": 0.3095
  },
  "claimSummary": {
    "currentAddOnCounts": { "nyuyoku_kaijo_ii": 28 }
  }
}
```

## 個人情報

含めません。設計上、集計値のみを返します。CPOS 側で `includePii=true` オプションを使えば個別データを返すことは可能ですが、本アプリは既定で `includePii=false` を使います。

## バリデーション

```bash
npm run validate:json -- --kind cpos_export_bundle --input path/to/bundle.json
```

スキーマ: [cpos_export_bundle.schema.json](/docs/raw/../schemas/cpos_export_bundle.schema.json)

## 関連

- [CPOS_TOKEN.md](/docs/CPOS_TOKEN.md) — PAT 接続手順
- [CPOS_INTEGRATION.md](/docs/CPOS_INTEGRATION.md) — 開発者向け技術詳細
