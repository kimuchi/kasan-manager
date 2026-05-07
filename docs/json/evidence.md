# `evidence.json` — 証跡集計

レセプトPDF・請求明細・CSV 取込結果などから抽出した「現状算定中加算」「要介護度分布」などの集計データ。

## 目的

- PDF 取込結果（`receipt-pdf.js` の出力）の保存・再利用
- 加算判定エンジンに「現在算定中の加算」を伝える
- 個人情報を含まない集計値のみを扱う

## いつ使うか

- レセプトPDFを取込済みで、その結果を別の事業所と比較したいとき
- CPOS 経由で `claimSummary` が取れるときは自動生成される

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `_meta.schema` | string | `"evidence"` |
| `evidence[]` | array | 1 件以上の evidence 配列 |
| `evidence[].service_key` | string | サービスキー |
| `evidence[].source_type` | string | `"receipt_pdf"`, `"cpos_analysis_source"`, `"manual"` |
| `evidence[].extracted_at` | string | 抽出日時（ISO 8601） |

## サンプル

```json
{
  "_meta": {
    "schema": "evidence",
    "schema_version": "1.2",
    "office_code": "DEMO-0004",
    "tenant_id": "cpos-default",
    "updated": "2026-05-07"
  },
  "evidence": [
    {
      "evidence_id": "receipt_pdf_DEMO-0004_20260507103045",
      "service_key": "tsusho_kaigo",
      "source_type": "receipt_pdf",
      "source_file_name": "2026-04_receipt.pdf",
      "extracted_at": "2026-05-07T10:30:45",
      "extraction_version": "v2026.05.06-alpha.4.4-nodejs",
      "current_kasan_counts": {
        "nyuyoku_II": 28,
        "kobetsu_kinou_I_i": 22
      },
      "extraction_confidence": "high",
      "warnings": []
    }
  ]
}
```

## 個人情報

含めません。`source_file_name` には PDF のファイル名のみで、被保険者番号・氏名は記録しません。

`pii_policy` フィールドで明示することを推奨:

```json
"pii_policy": {
  "policy_note": "個人を特定できる情報は意図的に抽出・保存しない設計",
  "保存しない項目": ["被保険者番号", "氏名", "住所", "電話番号"],
  "保存する項目": ["要介護度分布(集計値)", "算定中加算の件数(集計値)", "サービスコード"]
}
```

## バリデーション

```bash
npm run validate:json -- --kind evidence --input path/to/evidence.json
```

スキーマ: [evidence.schema.json](/docs/raw/../schemas/evidence.schema.json)

## 関連

- [PDF 取込 CLI](/docs/CLI.md#2-レセプト-pdf-取込--npm-run-import-receipt) で生成可能
