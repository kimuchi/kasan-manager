"""DEMO staff.json bridge テスト（alpha.5.3）"""
import io
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from requirement_dsl import (
    load_staff_data, build_facts_from_staff_data, merge_requirement_facts,
    build_staff_summary_display, evaluate_requirement_logic,
)


ROOT = Path(__file__).resolve().parents[2].parent
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"
DEMO_STAFF_DIR = PRODUCT_ROOT / "tenant_data" / "demo_staff"


def test_load_all_demo_staff_files():
    """4つのDEMO staff.jsonが読み込める"""
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = DEMO_STAFF_DIR / office / "staff.json"
        sd = load_staff_data(str(path))
        assert sd is not None, f"{office} 読込失敗"
        assert sd["sample_policy"] == "public_demo_synthetic"
        assert sd["office_code"] == office
        assert isinstance(sd.get("staff"), list) and sd["staff"]
    print("✅ test_load_all_demo_staff_files")


def test_demo_staff_no_pii_in_files():
    """4つのDEMO staffに禁止語・PIIが入っていない"""
    forbidden = ["SUN", "ホットステーション", "1367197775", "1371802743", "1371802982",
                 "専務", "事務長", "サ責A", "サ責B", "サ責C", "サ責D",
                 "藤田", "浅野", "新居", "小幡", "茂木", "増田", "506万円"]
    hits = []
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = DEMO_STAFF_DIR / office / "staff.json"
        text = path.read_text(encoding="utf-8")
        for kw in forbidden:
            if kw in text:
                hits.append((office, kw))
    assert not hits, f"DEMO staff PII HIT: {hits}"
    print("✅ test_demo_staff_no_pii_in_files")


def test_demo_staff_synthetic_marker_present():
    """4つのDEMO staffに「公開デモ用の架空サンプル」明記"""
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = DEMO_STAFF_DIR / office / "staff.json"
        sd = json.loads(path.read_text(encoding="utf-8"))
        assert sd["sample_policy"] == "public_demo_synthetic"
        notes_text = " ".join(sd.get("notes", []))
        assert "架空" in notes_text, f"{office} 架空サンプル明記なし"
    print("✅ test_demo_staff_synthetic_marker_present")


def test_houmon_kaigo_staff_facts():
    """訪問介護(DEMO-0005)から staff_summary 8 facts が生成される"""
    sd = load_staff_data(str(DEMO_STAFF_DIR / "DEMO-0005" / "staff.json"))
    facts = build_facts_from_staff_data(sd, service_key="houmon_kaigo")
    expected_keys = {
        "staff_summary.saseki_qualified_count",
        "staff_summary.saseki_uwanose_fte",
        "staff_summary.helper_total_count",
        "staff_summary.helper_total_fte",
        "staff_summary.helper_kaigo_fukushishi_count",
        "staff_summary.helper_kaigo_fukushishi_ratio",
        "staff_summary.helper_fukushishi_jitsumusha_kiso_ratio",
        "staff_summary.helper_qualified_any_count",
    }
    assert expected_keys.issubset(facts.keys()), f"足りないキー: {expected_keys - facts.keys()}"
    # 値の整合: 介護福祉士 helper = 3名 → 3/7 = 0.4286
    assert facts["staff_summary.helper_total_count"] == 7
    assert facts["staff_summary.helper_kaigo_fukushishi_count"] == 3
    assert abs(facts["staff_summary.helper_kaigo_fukushishi_ratio"] - 3/7) < 0.001
    # 福祉士+実務者+基礎研修 = 4/7 (介護福祉士3 + 実務者1 = 4)
    assert abs(facts["staff_summary.helper_fukushishi_jitsumusha_kiso_ratio"] - 4/7) < 0.001
    # 上乗せサ責: 1.0
    assert facts["staff_summary.saseki_uwanose_fte"] == 1.0
    # 何らかの介護資格を持つhelper: 6 (010を除く)
    assert facts["staff_summary.helper_qualified_any_count"] == 6
    print("✅ test_houmon_kaigo_staff_facts")


def test_tsusho_kaigo_staff_facts():
    """通所介護(DEMO-0004)から staff_summary 6 facts が生成される"""
    sd = load_staff_data(str(DEMO_STAFF_DIR / "DEMO-0004" / "staff.json"))
    facts = build_facts_from_staff_data(sd, service_key="tsusho_kaigo")
    expected_keys = {
        "staff_summary.kango_count",
        "staff_summary.kango_fte",
        "staff_summary.kaigo_count",
        "staff_summary.kaigo_fte",
        "staff_summary.kango_kaigo_total_fte",
        "staff_summary.kinou_kunren_qualified",
    }
    assert expected_keys.issubset(facts.keys())
    assert facts["staff_summary.kango_count"] == 2
    assert facts["staff_summary.kango_fte"] == 1.8  # 1.0 + 0.8
    assert facts["staff_summary.kaigo_count"] == 4
    assert facts["staff_summary.kaigo_fte"] == 3.6  # 1.0+1.0+1.0+0.6
    assert facts["staff_summary.kango_kaigo_total_fte"] == 5.4
    assert facts["staff_summary.kinou_kunren_qualified"] is True
    print("✅ test_tsusho_kaigo_staff_facts")


def test_houmon_kango_staff_facts():
    """訪問看護(DEMO-0007)から staff_summary 4 facts が生成される"""
    sd = load_staff_data(str(DEMO_STAFF_DIR / "DEMO-0007" / "staff.json"))
    facts = build_facts_from_staff_data(sd, service_key="houmon_kango_kaigo")
    expected_keys = {
        "staff_summary.kango_count",
        "staff_summary.kango_fte",
        "staff_summary.kango_joukin_count",
        "staff_summary.rihabilitation_count",
    }
    assert expected_keys.issubset(facts.keys())
    assert facts["staff_summary.kango_count"] == 5
    assert facts["staff_summary.kango_joukin_count"] == 3  # is_joukin True が 3名
    assert facts["staff_summary.rihabilitation_count"] == 2  # PT + OT
    print("✅ test_houmon_kango_staff_facts")


def test_kyotaku_shien_staff_facts():
    """居宅介護支援(DEMO-0006)から staff_summary 3 facts が生成される"""
    sd = load_staff_data(str(DEMO_STAFF_DIR / "DEMO-0006" / "staff.json"))
    facts = build_facts_from_staff_data(sd, service_key="kyotaku_shien")
    expected_keys = {
        "staff_summary.cm_count",
        "staff_summary.shunin_cm_count",
        "staff_summary.cm_total_fte",
    }
    assert expected_keys.issubset(facts.keys())
    assert facts["staff_summary.cm_count"] == 6  # cm 4 + shunin_cm 2
    assert facts["staff_summary.shunin_cm_count"] == 2
    assert facts["staff_summary.cm_total_fte"] == 5.8  # 1.0*5 + 0.8
    print("✅ test_kyotaku_shien_staff_facts")


def test_non_synthetic_returns_empty():
    """sample_policy != public_demo_synthetic は空dict を返す"""
    facts = build_facts_from_staff_data({"sample_policy": "real_data", "staff": []},
                                          service_key="houmon_kaigo")
    assert facts == {}, "非DEMOデータは安全側でemptyを返すべき"
    print("✅ test_non_synthetic_returns_empty")


def test_merge_requirement_facts_does_not_override_receipt_pdf():
    """receipt_pdf.* / tenant_status.* は staff_summary fact dotted_key で侵入されない"""
    base = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.6},
            "tenant_status": {"saseki_qualifications": {"status": "clear"}}}
    # 名前空間を侵犯しようとするfact
    bad = {
        "receipt_pdf.yokaigo_3plus_ratio": 0.99,
        "tenant_status.saseki_qualifications.status": "missing",
        "staff_summary.helper_total_count": 5,
    }
    merged = merge_requirement_facts(base, bad)
    assert merged["receipt_pdf"]["yokaigo_3plus_ratio"] == 0.6, "receipt_pdf上書き禁止"
    assert merged["tenant_status"]["saseki_qualifications"]["status"] == "clear", "tenant_status上書き禁止"
    assert merged["staff_summary"]["helper_total_count"] == 5
    print("✅ test_merge_requirement_facts_does_not_override_receipt_pdf")


def test_demo_staff_makes_dsl_clear_via_staff_summary():
    """staff_summary fact だけで DSL clear になる（tenant_status 欠落でもstaff_summaryで充足）"""
    base = {"receipt_pdf": {}, "tenant_status": {}}
    sd = load_staff_data(str(DEMO_STAFF_DIR / "DEMO-0005" / "staff.json"))
    staff_facts = build_facts_from_staff_data(sd, service_key="houmon_kaigo")
    facts = merge_requirement_facts(base, staff_facts)
    # 介護福祉士比率 staff_summary だけで判定
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "staff_summary.helper_kaigo_fukushishi_ratio",
         "op": ">=", "value": 0.30, "label": "staff_summary 介護福祉士比率30%以上"}
    ]}
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear", r
    print("✅ test_demo_staff_makes_dsl_clear_via_staff_summary")


def test_staff_summary_display_excludes_individual_staff():
    """build_staff_summary_display は集計値のみを返し、staff_id・display_label を含まない"""
    sd = load_staff_data(str(DEMO_STAFF_DIR / "DEMO-0005" / "staff.json"))
    staff_facts = build_facts_from_staff_data(sd, service_key="houmon_kaigo")
    display = build_staff_summary_display(staff_facts, service_key="houmon_kaigo")
    text = json.dumps(display, ensure_ascii=False)
    assert "DEMO-STAFF-001" not in text
    assert "架空職員A" not in text
    assert "staff_id" not in display
    assert "display_label" not in display
    print("✅ test_staff_summary_display_excludes_individual_staff")


def test_judge_with_staff_data_outputs_section():
    """judge_kasan.py に --staff-data を渡すと「職員データ連携」セクションが出る"""
    out_md = ROOT / "products/kasan-manager/out/_test_staff_data_section.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "houmon_kaigo",
           "--office", "DEMO-0005",
           "--tenant-status", str(DEMO_STAFF_DIR.parent / "demo_status/DEMO-0005/tenant_status.json"),
           "--staff-data", str(DEMO_STAFF_DIR / "DEMO-0005/staff.json"),
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    assert "👥 職員データ連携" in md, "職員データ連携セクションがない"
    # 集計値は含まれる
    assert "helper_total_count" in md or "helper_kaigo_fukushishi_ratio" in md
    # 個別データは含まれない（公開安全）
    assert "DEMO-STAFF-001" not in md
    assert "架空職員A" not in md
    print("✅ test_judge_with_staff_data_outputs_section")


def test_judge_without_staff_data_still_works():
    """--staff-data なしでも動作（後方互換）"""
    out_md = ROOT / "products/kasan-manager/out/_test_no_staff_data.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "houmon_kaigo",
           "--office", "DEMO-0005",
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    assert "👥 職員データ連携" not in md, "staff_dataなしで職員データ連携セクションが出ている"
    print("✅ test_judge_without_staff_data_still_works")


def test_evidence_checklist_has_next_action():
    """不足証跡チェックリストに次アクション列が出る"""
    out_md = ROOT / "products/kasan-manager/out/_test_next_action.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "houmon_kaigo",
           "--office", "DEMO-0005",
           "--tenant-status", str(DEMO_STAFF_DIR.parent / "demo_status/DEMO-0005/tenant_status.json"),
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    if "🧾 不足証跡チェックリスト" in md:
        # ヘッダ行に次アクションが出る
        assert "次アクション" in md, "次アクション列がない"
    print("✅ test_evidence_checklist_has_next_action")


if __name__ == "__main__":
    test_load_all_demo_staff_files()
    test_demo_staff_no_pii_in_files()
    test_demo_staff_synthetic_marker_present()
    test_houmon_kaigo_staff_facts()
    test_tsusho_kaigo_staff_facts()
    test_houmon_kango_staff_facts()
    test_kyotaku_shien_staff_facts()
    test_non_synthetic_returns_empty()
    test_merge_requirement_facts_does_not_override_receipt_pdf()
    test_demo_staff_makes_dsl_clear_via_staff_summary()
    test_staff_summary_display_excludes_individual_staff()
    test_judge_with_staff_data_outputs_section()
    test_judge_without_staff_data_still_works()
    test_evidence_checklist_has_next_action()
    print("\nAll staff facts tests passed.")
