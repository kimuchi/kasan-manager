# alpha.5.10 Reviewer Decision Gate

**version**: alpha.5.10
**base_commit**: `d0c911db9b28f561f0e40859a4c40e863982d7f6` (alpha.5.9 master_review_packet)
**input_packet_version**: alpha.5.9
**input_template_path**: `out/internal/alpha5_9_master_review_packet/reviewer_decision_template.csv`
**generated_at**: 2026-05-10

---

## 位置付け

alpha.5.9 で生成した `reviewer_decision_template.csv` に reviewer が記入した結果を読み込み、
**「どの判断が master JSON 修正候補として実装に進めるか」「どの判断が不備でブロックされるか」
「どの判断が未記入で保留中か」「どの判断が法令確認待ちか」** を分類する **安全ゲート** です。

- このゲートは **内部レビュー用** であり、**public release ではありません**
- 出力先: `out/internal/alpha5_10_reviewer_decision_gate/`（public sample / release pack には含めない）
- **本ゲートは master JSON を改変しません**。candidate を提示するだけです。
- 実装は alpha.5.11+ で別途承認・テスト・段階的に進めます

## 不変条件（テストで保護）

- ❌ master JSON 自動修正なし（generator は読み取り専用）
- ❌ 新規 checked 昇格なし
- ❌ R8.6 案資料は checked 昇格に使わない
- ❌ public release pack は本 alpha.5.10 で更新しない
- ❌ alpha.5.9 packet ファイルは破壊しない
- ❌ 過剰な完了感を与える表現を出さない（disclaimer 維持）

## 結果サマリ

- approved_changes_preview: **0** 件（master修正候補）
- blocked_or_incomplete_decisions: **0** 件（不正・不備）
- pending_decisions: **38** 件（未記入・保留・defer）
- legal_review_required: **0** 件（法令確認待ち）
- future_candidate_count（参考）: **2** 件
- divergent_count（参考）: **3** 件

合計: **38** 行

## 含まれるファイル

| ファイル | 内容 |
|---|---|
| `README.md` | 本ファイル |
| `decision_validation_report.md` | 詳細レポート（バケット別件数・次にやること） |
| `approved_changes_preview.csv` | master 修正候補（UTF-8 BOM付・Excel互換） |
| `approved_changes_preview.json` | 同上の JSON 版（プログラムから処理しやすい形式） |
| `blocked_or_incomplete_decisions.csv` | 不正・不備な行（要修正） |
| `pending_decisions.csv` | 未記入・保留・defer 行 |
| `legal_review_required.csv` | 法令確認待ち行 |
| `alpha5_10_reviewer_decision_gate_manifest.json` | パケットメタデータ |

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_10_reviewer_decision_gate.py
```

引数で別の入力 CSV を指定する場合:

```
python scripts/generate_alpha5_10_reviewer_decision_gate.py \
  --input path/to/reviewer_decision_template.csv \
  --output path/to/output_dir
```

## 次に人間がやること

1. `blocked_or_incomplete_decisions.csv` の各行の `recommended_fix` を業務担当が修正
2. `pending_decisions.csv` の `recommended_reviewer_role` に従い、未記入行を埋める
3. `legal_review_required.csv` の `legal_question` を法令確認者が解析
4. `approved_changes_preview.csv` を最終判断者が再確認し、alpha.5.11+ で master JSON 反映を承認
5. **alpha.5.11+ では別途 PR を立て、approved 行のみを段階的に master JSON へ反映**（一括反映は禁止）
