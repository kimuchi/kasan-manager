# alpha.5.11 Reviewer Handoff Workbook

**version**: alpha.5.11
**base_commit**: `c9cf05cf5bba29f91231837c34aa42c91153cb27` (alpha.5.10 reviewer_decision_gate)
**input_packet_version**: alpha.5.9
**input_gate_version**: alpha.5.10
**generated_at**: 2026-05-10

---

## 位置付け

alpha.5.9 master_review_packet と alpha.5.10 reviewer_decision_gate を前提に、
**業務担当・法令確認者・最終承認者が Excel で判断入力できる** 内部レビュー用ワークブック。

- このブックは **out/internal 配下の内部レビュー資料**であり、**public release pack には含めません**
- reviewer が入力した実判断ファイルも public に出しません
- alpha.5.3 / alpha.5.4 release pack には影響しません

## 不変条件（テストで保護）

- ❌ master JSON 自動修正なし（generator は読み取り専用）
- ❌ 新規 checked 昇格なし
- ❌ R8.6 案資料は checked 昇格に使わない
- ❌ public release pack は本 alpha.5.11 で更新しない
- ❌ alpha.5.9 packet / alpha.5.10 gate は破壊しない
- ❌ 過剰な完了感を与える表現は使わない（disclaimer 維持）

## 含まれるファイル

| ファイル | 内容 |
|---|---|
| `README.md` | 本ファイル |
| `reviewer_handoff_guide.md` | 業務担当 / 法令確認者 / 最終承認者向け手順・入力例 |
| `alpha5_11_reviewer_decision_workbook.xlsx` | 8シート構成のレビュー用ワークブック（プルダウン・色分けあり） |
| `reviewer_decision_export_template.csv` | export 後の CSV 形式リファレンス（空欄） |
| `workbook_export_instructions.md` | Excel 保存・export script 実行・gate 再実行の手順 |
| `alpha5_11_reviewer_handoff_manifest.json` | パケットメタデータ |

## ワークブック構成（8 シート）

1. **README** — 本ブックの目的・運用注意
2. **Decision_Input_All** — 38件の入力シート（プルダウン・色分け）
3. **Needs_Master_Review** — 業務担当向け参照（28件）
4. **Needs_Legal_Review** — 法令確認者向け参照（5件）
5. **Divergent** — divergent 3件（参照のみ）
6. **Future_Candidate** — 2件（必ず defer_until_r8_definitive）
7. **Valid_Values** — reviewer_decision / implementation_allowed の選択肢一覧
8. **Gate_Instructions** — Excel 入力後の export → gate 再実行手順

## 次にやること

### reviewer
1. このブックを開いて Decision_Input_All シートで 38 行を埋める
2. 必要に応じて Needs_Master_Review / Needs_Legal_Review / Divergent / Future_Candidate を参照
3. ブックを保存（.xlsx 形式・上書き）
4. ターミナル: `python scripts/export_alpha5_11_workbook_decisions.py`
5. 出力 CSV を alpha.5.10 gate で再検証:
   ```
   python scripts/generate_alpha5_10_reviewer_decision_gate.py \
     --input out/internal/alpha5_11_reviewer_handoff_workbook/reviewer_decision_export.csv \
     --output out/internal/alpha5_10_reviewer_decision_gate_from_workbook/
   ```
6. blocked / pending / legal_review_required を解消するまで 1〜5 を繰り返す

### 開発担当
- approved 行が確定したら、**alpha.5.12+** で master JSON 段階反映を別 PR で実施
- **本パッケージは master JSON を改変しません**（reviewer 入力 → export → gate 検証のみ）

## サマリ

| カテゴリ | 件数 |
|---|---:|
| Decision_Input_All の合計 | 38 |
| Needs_Master_Review | 28 |
| Needs_Legal_Review | 5 |
| Divergent | 3 |
| Future_Candidate | 2 |

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_11_reviewer_workbook.py
```
