# `service_registry.json` — サービス登録

加算マネージャがサポートするサービス（通所介護・訪問介護・障害福祉等）の一覧管理ファイル。

## 目的

- UI のサービス選択肢、CLI の `--service` 引数の正当性判定、加算マスタ JSON へのリンクを集中管理
- 1 ファイルだけ更新すれば、フロント・バック・CLI 全てに反映される

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `services[].service_key` | string | 一意なサービスキー |
| `services[].display_name` | string | UI 表示名 |
| `services[].domain` | string | `"kaigo" / "medical" / "disability"` |
| `services[].master_file` | string | 加算マスタ JSON への相対パス |
| `services[].status` | string | `"implemented" / "draft" / "planned"` |

## サンプル抜粋

```json
{
  "_meta": { "schema": "service_registry", "schema_version": "1.0" },
  "services": [
    {
      "service_key": "tsusho_kaigo",
      "display_name": "通所介護",
      "domain": "kaigo",
      "payer": "kaigo_hoken",
      "status": "implemented",
      "master_file": "regulatory_master/kaigo/tsusho_kaigo.json",
      "effective_from": "2024-04-01",
      "revision_tag": "R6_2024_04",
      "source_required": false
    }
  ],
  "domains": {
    "kaigo": { "display_name": "介護保険" },
    "medical": { "display_name": "医療保険" },
    "disability": { "display_name": "障害福祉" }
  },
  "statuses": {
    "implemented": "本番判定対応",
    "draft": "AI 補完分析のみ対応（要件マスタ整備中）",
    "planned": "準備中"
  }
}
```

## 新サービスを追加するときの手順

1. `regulatory_master/<domain>/<service>.json` を新規作成
2. `service_registry.json` の `services[]` に登録（`status: draft` から）
3. `npm run test:smoke` でロード可能なことを確認
4. 加算要件を整備して `status: implemented` に昇格

## バリデーション

スキーマは省略（手動編集前提）。書式を間違えるとサーバ起動時に loadServices で失敗します。
