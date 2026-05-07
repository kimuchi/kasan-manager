# `user.json` — 利用者個別情報

利用者を個別に扱う必要がある分析ケースで使う JSON。**個人情報を含むため、原則として `user_summary.json` を優先**してください。

## 目的

- 加算要件で「個別利用者ごとに」評価が必要な場合（ADL 維持等加算等）

## いつ使うか

- 個別利用者の状態変化を踏まえる必要があるとき
- それ以外は [`user_summary.json`](./user_summary.md) で十分

## 個人情報

**含む可能性があります。** Web UI / CLI にアップロードする前に、必ず以下をマスキングしてください。

- 氏名・カナ氏名
- 被保険者番号
- 住所・電話番号
- 生年月日

匿名 ID（`USER-001`）への置換を推奨します。

## サンプル

```json
{
  "_meta": {
    "schema": "user",
    "schema_version": "1.0",
    "office_code": "DEMO-0004",
    "tenant_id": "cpos-default",
    "updated": "2026-05-07"
  },
  "users": [
    {
      "user_id": "USER-001",
      "care_level": "youkaigo_3",
      "ninchi_jiritsudo": "IIa",
      "adl_status": "stable",
      "active": true
    }
  ]
}
```

## バリデーション

```bash
npm run validate:json -- --kind user --input path/to/user.json
```

スキーマ: [user.schema.json](/schemas/user.schema.json)

## CPOS から自動生成される場合

CPOS は基本的に `user_summary` を返すため、個別 `user.json` は通常生成されません。CPOS で `includePii=true` を有効化した場合のみ個別データが含まれますが、本アプリは既定で `includePii=false` で取得します。
