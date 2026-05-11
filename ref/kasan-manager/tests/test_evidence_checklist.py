"""不足証跡チェックリスト テスト（alpha.5.2）"""
import io
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from requirement_dsl import (
    load_evidence_labels, build_evidence_checklist,
)


ROOT = Path(__file__).resolve().parents[2].parent
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"


def test_load_evidence_labels():
    config = load_evidence_labels()
    assert "labels" in config
    assert config["labels"], "label辞書が空"
    sample_key = "tenant_status.monthly_meeting_record.status"
    assert sample_key in config["labels"]
    assert config["labels"][sample_key]["label"] == "月次会議議事録"
    print("✅ test_load_evidence_labels")


def test_build_checklist_from_blocked_dsl():
    dsl_results = {
        "tokutei_jigyousho_I": {
            "status": "blocked_by_missing_evidence",
            "missing_evidence": [
                "tenant_status.monthly_meeting_record.status",
                "tenant_status.saseki_uwanose_count.status",
            ],
            "mapping_held_conditions": [],
        }
    }
    judgements = {"tokutei_jigyousho_I": {"name": "特定事業所加算(Ⅰ)"}}
    config = load_evidence_labels()
    cl = build_evidence_checklist(dsl_results, judgements, config)
    assert len(cl) == 2
    assert cl[0]["kasan_name"] == "特定事業所加算(Ⅰ)"
    assert any(it["label"] == "月次会議議事録" for it in cl)
    assert any(it["label"] == "常勤サービス提供責任者の上乗せ配置" for it in cl)
    print("✅ test_build_checklist_from_blocked_dsl")


def test_checklist_includes_mapping_held():
    """mapping保留もチェックリストに含まれる"""
    dsl_results = {
        "X": {"status": "blocked_by_unverified_mapping",
              "missing_evidence": [],
              "mapping_held_conditions": ["X件数>=1"]}
    }
    judgements = {"X": {"name": "テスト加算X"}}
    cl = build_evidence_checklist(dsl_results, judgements, load_evidence_labels())
    assert len(cl) == 1
    assert cl[0]["category"] == "mapping_unverified"
    assert "保留" in cl[0]["label"]
    print("✅ test_checklist_includes_mapping_held")


def test_not_applicable_excluded_from_checklist():
    """not_applicableはチェックリストに含まれない"""
    dsl_results = {
        "X": {"status": "not_applicable", "missing_evidence": [],
              "mapping_held_conditions": []},
        "Y": {"status": "blocked_by_missing_evidence",
              "missing_evidence": ["tenant_status.A.status"],
              "mapping_held_conditions": []},
    }
    judgements = {"X": {"name": "対象外加算"}, "Y": {"name": "未充足加算"}}
    cl = build_evidence_checklist(dsl_results, judgements, load_evidence_labels())
    assert all(it["kasan_key"] != "X" for it in cl), "not_applicableが混入"
    assert any(it["kasan_key"] == "Y" for it in cl)
    print("✅ test_not_applicable_excluded_from_checklist")


def test_judge_with_tenant_status_outputs_checklist():
    """judge_kasan.py に --tenant-status を渡すとチェックリストが出る"""
    out_md = ROOT / "products/kasan-manager/out/_test_checklist.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "houmon_kango_kaigo",
           "--office", "DEMO-0007",
           "--receipt-pdf", str(PRODUCT_ROOT / "tests/fixtures/houmon_kango_kaigo_receipt_sample.pdf"),
           "--evidence-out", str(PRODUCT_ROOT / "tenant_data/evidence/DEMO-0007/"),
           "--tenant-status", str(PRODUCT_ROOT / "tenant_data/demo_status/DEMO-0007/tenant_status.json"),
           "--apply-evidence",
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    assert "🧾 不足証跡チェックリスト" in md, "チェックリストセクションがない"
    assert "DEMO用の架空tenant_status" in md, "DEMO注記がない"
    print("✅ test_judge_with_tenant_status_outputs_checklist")


def test_judge_without_tenant_status_still_works():
    """judge_kasan.py に --tenant-status なしでも動作（後方互換）"""
    out_md = ROOT / "products/kasan-manager/out/_test_no_ts.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "houmon_kango_kaigo",
           "--office", "DEMO-0007",
           "--receipt-pdf", str(PRODUCT_ROOT / "tests/fixtures/houmon_kango_kaigo_receipt_sample.pdf"),
           "--evidence-out", str(PRODUCT_ROOT / "tenant_data/evidence/DEMO-0007/"),
           "--apply-evidence",
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    assert "📄 PDF取込結果サマリ" in md
    print("✅ test_judge_without_tenant_status_still_works")


if __name__ == "__main__":
    test_load_evidence_labels()
    test_build_checklist_from_blocked_dsl()
    test_checklist_includes_mapping_held()
    test_not_applicable_excluded_from_checklist()
    test_judge_with_tenant_status_outputs_checklist()
    test_judge_without_tenant_status_still_works()
    print("\nAll evidence checklist tests passed.")
