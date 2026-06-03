# JSON 入力形式リファレンス

加算マネージャがアップロード／読み込みできる JSON ファイルの仕様一覧です。

> このページは利用者・運用担当・連携実装者向けです。

## 一覧

| JSON | 用途 | 個人情報 | スキーマ |
|---|---|---:|---|
| [`tenant_status.json`](./tenant_status.md) | 事業所別の要件確認状態 | 原則なし | [schema](/schemas/tenant_status.schema.json) |
| [`staff.json`](./staff.md) | 職員・資格・常勤換算 | あり得る | [schema](/schemas/staff.schema.json) |
| [`user.json`](./user.md) | 利用者個別状態 | あり得る | [schema](/schemas/user.schema.json) |
| [`user_summary.json`](./user_summary.md) | 利用者集計 | なし | [schema](/schemas/user_summary.schema.json) |
| [`evidence.json`](./evidence.md) | PDF/請求等の証跡集計 | なし | [schema](/schemas/evidence.schema.json) |
| [`regulatory_master.json`](./regulatory_master.md) | 加算マスタ | なし | [schema](/schemas/regulatory_master.schema.json) |
| [`cpos_export_bundle.json`](./cpos_export_bundle.md) | CPOS 連携用集約形式 | なし | [schema](/schemas/cpos_export_bundle.schema.json) |

## 推奨匿名化レベル

| データ | 推奨される匿名化 |
|---|---|
| `staff.json` | 氏名→`staff_001` 等の匿名 ID。資格・常勤換算は実値で OK |
| `user.json` | 個別利用者を扱う必要があるケースのみ。氏名・被保険者番号は完全削除 |
| `user_summary.json` | そもそも集計値のみを扱う形式（PII を含めない） |
| `tenant_status.json` | 要件名と進捗のみを扱う形式（PII を含めない） |

公開デモ・他社共有では `user_summary.json` を使うことを強く推奨します。

## バリデーション

CLI で JSON Schema 検証ができます。

```bash
npm run validate:json -- --kind staff --input path/to/staff.json
npm run validate:json -- --kind user_summary --input path/to/user_summary.json
npm run validate:json -- --schema schemas/staff.schema.json --input path/to/staff.json
```

`--kind` で受け付ける種別:

- `tenant_status`
- `staff`
- `user`
- `user_summary`
- `evidence`
- `regulatory_master`
- `cpos_export_bundle`

詳しくは [CLI.md](/docs/CLI.md) を参照。

## 個人情報の扱い

- アップロードファイルは加算マネージャのサーバ側に **永続保存しません**（メモリ上で展開・分析のみ）
- ただし AI 補完分析（Gemini）に送信する際にテキスト化するため、**アップロード前に個人情報をマスキング**してください
- CPOS 経由で取得する場合は、CPOS 側で集計済みの値が返るので追加の匿名化は不要

詳しくは [DATA_SAFETY.md](/docs/DATA_SAFETY.md) を参照。

## 関連ドキュメント

- [USER_GUIDE.md](/docs/USER_GUIDE.md) — UI 全体の使い方
- [CPOS_TOKEN.md](/docs/CPOS_TOKEN.md) — CPOS PAT 接続手順
- [CLI.md](/docs/CLI.md) — CLI コマンド一覧
- [TECHNICAL.md](/docs/TECHNICAL.md) — 内部アーキテクチャ
