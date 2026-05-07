# `tenant_status.json` — 事業所別要件確認状態

事業所が「どの加算要件をどこまで確認・整備しているか」を記録するファイル。Web UI の「事業所ステータス JSON」アップロード欄、CLI の `--tenant-status` で使う。

## 目的

- 加算ごとの確認状態（`clear` / `waiting` / `unknown` / `not_clear`）を蓄積
- 確認待ち項目（inquiry）を一覧化して、レポートに反映
- 担当者の引き継ぎ・運用記録の可視化

## いつ使うか

- 事業所ごとに加算分析を回すとき
- レポートの「すぐ確認すべき項目 TOP5」を充実させたいとき
- CPOS 連携を使わない場合の事業所情報入力経路として

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `_meta.schema` | string | `"tenant_status"` |
| `_meta.office_code` | string | 事業所コード（例: `DEMO-0004`） |
| `_meta.tenant_id` | string | 法人 ID（任意。サンプルは `cpos-default` 等） |
| `service_key` | string | サービスキー（例: `tsusho_kaigo`） |

## よく使う任意フィールド

| パス | 型 | 説明 |
|---|---|---|
| `requirement_status` | object | 加算要件キーごとの `{ status, value, evidence }` |
| `inquiry.remaining_5_items[]` | array | 「すぐ確認すべき項目」リスト |
| `facts` | object | DSL 評価で使う dotted-key facts |
| `notes` | array | 運用メモ |

## サンプル

```json
{
  "_meta": {
    "schema": "tenant_status",
    "schema_version": "1.0",
    "office_code": "DEMO-0004",
    "tenant_id": "cpos-default",
    "updated": "2026-05-07"
  },
  "service_key": "tsusho_kaigo",
  "facts": {
    "tenant_status.kango_kaigo_2nin_kahai.status": "clear",
    "tenant_status.kango_jikantai_haichi.status": "missing"
  },
  "requirement_status": {
    "kango_kaigo_2nin_kahai": { "status": "clear", "evidence": "勤務表 2026-04" }
  },
  "inquiry": {
    "remaining_5_items": [
      {
        "id": "M1",
        "item": "看護職員の時間帯配置",
        "status": "waiting",
        "linked_kasan_req": "tsusho_kaigo.chujudosha_care_taisei.staff_continuous"
      }
    ]
  },
  "notes": ["DEMO 用サンプル"]
}
```

## 個人情報

原則として個人情報を含めません。`evidence` フィールドは「○○名簿」「△△証跡」程度の参照名で OK です。

## バリデーション

```bash
npm run validate:json -- --kind tenant_status --input path/to/tenant_status.json
```

スキーマ: [tenant_status.schema.json](/schemas/tenant_status.schema.json)

## CPOS から自動生成される場合のマッピング

CPOS の `analysis-source` を取り込むと、以下のフィールドが自動的に埋まります。

| CPOS | tenant_status.json |
|---|---|
| `dataCompleteness.staffing` | `inquiry.remaining_5_items[]` |
| `warnings[]` | `inquiry.remaining_5_items[]` |
| `staffSummary.hasExternalPtOtSt` | `notes[]` |

詳しくは `app/src/services/cpos/transform.js` の `transformInquiry()` を参照。

## よくあるエラー

| エラー | 対処 |
|---|---|
| `_meta.schema` が違う | `"tenant_status"` を指定 |
| `service_key` 未指定 | `tsusho_kaigo` 等を入れる |
| `requirement_status` の status 値違反 | `clear / waiting / not_clear / unknown / missing` のいずれか |
