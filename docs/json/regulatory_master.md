# `regulatory_master/<service>.json` — 加算マスタ

サービス別の加算定義（要件・単位数・適用範囲・要件論理式 DSL）を持つマスタ JSON。

## 目的

- 加算判定エンジンの根幹データ
- 1 サービスに 1 ファイル
- リポジトリの `regulatory_master/<domain>/<service>.json` に格納

## 必須フィールド

| パス | 型 | 説明 |
|---|---|---|
| `_meta.service_key` | string | `"tsusho_kaigo"` 等 |
| `_meta.display_name` | string | 表示名 |
| `_meta.domain` | string | `"kaigo" / "medical" / "disability"` |
| `_meta.version` | string | マスタ版（例: `"2026.4"`） |
| `_meta.revision_tag` | string | 改定タグ（例: `"R6_2024_04"`） |
| `kasans` | object | 加算キー → 加算定義のマッピング |

## サンプル

```json
{
  "_meta": {
    "service_key": "tsusho_kaigo",
    "display_name": "通所介護",
    "domain": "kaigo",
    "version": "2026.4",
    "revision_tag": "R6_2024_04",
    "source_status": "implemented"
  },
  "kasans": {
    "nyuyoku_II": {
      "name": "入浴介助加算Ⅱ",
      "unit_per_day": 55,
      "service_codes": ["155302"],
      "requirements": { "..." : "..." },
      "requirement_logic": {
        "logic_status": "checked",
        "operator": "all",
        "children": [ "..." ]
      }
    }
  }
}
```

## 個人情報

含めません。法令・告示由来のマスタです。

## バリデーション

```bash
npm run validate:json -- --kind regulatory_master --input regulatory_master/kaigo/tsusho_kaigo.json
```

スキーマ: [regulatory_master.schema.json](/schemas/regulatory_master.schema.json)

## 関連

- [`service_registry.md`](./service_registry.md) — サービス一覧の管理ファイル
- [TECHNICAL.md §5](/docs/TECHNICAL.md) — DSL 仕様
