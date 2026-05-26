"""DSL evaluator単体テスト（alpha.5）"""
import io
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from requirement_dsl import (
    evaluate_requirement_logic, evaluate_node, get_fact, build_facts_from_evidence,
)


def _logic(operator, children, logic_status="checked"):
    return {"logic_status": logic_status, "operator": operator, "children": children}


def _cond(fact, op, value, label="cond"):
    return {"type": "condition", "fact": fact, "op": op, "value": value, "label": label}


def test_all_conditions_clear():
    facts = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.6, "total_users_estimated": 5}}
    logic = _logic("all", [
        _cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "要介護3以上30%以上"),
        _cond("receipt_pdf.total_users_estimated", ">=", 1, "1名以上"),
    ])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear", r
    assert "要介護3以上30%以上" in r["satisfied_route"]
    print("✅ test_all_conditions_clear")


def test_any_one_route_clear():
    facts = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.2}, "tenant_status": {"看取り期実績": True}}
    logic = _logic("any", [
        _cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "Aルート: 要介護3以上30%"),
        _cond("tenant_status.看取り期実績", "bool_true", None, "Bルート: 看取り期実績あり"),
    ])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear"
    assert any("Bルート" in s for s in r["satisfied_route"])
    print("✅ test_any_one_route_clear")


def test_nested_all_any():
    facts = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.5, "extraction_confidence": "high"},
             "tenant_status": {"届出": True}}
    logic = _logic("all", [
        _cond("tenant_status.届出", "bool_true", None, "届出済"),
        {"operator": "any", "children": [
            _cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.4, "ratio>=40%"),
            _cond("receipt_pdf.extraction_confidence", "==", "high", "high信頼度"),
        ]},
    ])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear"
    print("✅ test_nested_all_any")


def test_blocked_by_missing_evidence():
    facts = {"receipt_pdf": {}}
    logic = _logic("all", [_cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "ratio")])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "blocked_by_missing_evidence"
    assert "receipt_pdf.yokaigo_3plus_ratio" in r["missing_evidence"]
    print("✅ test_blocked_by_missing_evidence")


def test_source_required_safety_valve():
    facts = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.6}}
    logic = _logic("all", [_cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "ratio")])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "source_required"})
    assert r["status"] == "not_evaluated_source_required"
    print("✅ test_source_required_safety_valve")


def test_logic_unchecked_safety_valve():
    facts = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.6}}
    logic = _logic("all", [_cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "ratio")],
                   logic_status="draft")
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "not_evaluated_logic_unchecked"
    print("✅ test_logic_unchecked_safety_valve")


def test_not_applicable_safety_valve():
    facts = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.9}}
    logic = _logic("all", [_cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "ratio")])
    r = evaluate_requirement_logic(logic, facts, {
        "source_status": "checked",
        "applicability": "not_applicable",
        "applicability_reason": "訪問看護では算定対象外",
    })
    assert r["status"] == "not_applicable"
    assert "対象外" in r["notes"][0]
    print("✅ test_not_applicable_safety_valve")


def test_pdf_undetected_not_treated_as_unbilled():
    """PDF未検出を未算定扱いしない: factsに current_kasan_counts.X が無い場合、
    DSL は blocked_by_missing_evidence を返し、not_clear にしない"""
    facts = {"receipt_pdf": {"current_kasan_counts": {}}}
    logic = _logic("all", [_cond("receipt_pdf.current_kasan_counts.X", ">=", 1, "X検出")])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    # X はfactsに存在しない -> blocked_by_missing_evidence
    assert r["status"] == "blocked_by_missing_evidence", r
    print("✅ test_pdf_undetected_not_treated_as_unbilled")


def test_pattern_unverified_warning():
    """alpha.5.1: mapping非依存fact (yokaigo_3plus_ratio) は warning 付きで評価可"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                             "yokaigo_3plus_ratio": 0.6}}
    logic = _logic("all", [_cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "ratio")])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear"
    assert any("pattern_based_unverified" in n for n in r["notes"])
    print("✅ test_pattern_unverified_warning (mapping非依存fact)")


def test_pattern_unverified_blocks_mapping_dependent():
    """alpha.5.1: mapping依存fact (current_kasan_counts) は pattern_based_unverified 時に clearにしない"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                             "current_kasan_counts": {"X": 5}}}
    logic = _logic("all", [_cond("receipt_pdf.current_kasan_counts.X", ">=", 1, "X検出")])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "blocked_by_unverified_mapping", r
    assert r.get("mapping_held_conditions"), "mapping_held_conditions空"
    print("✅ test_pattern_unverified_blocks_mapping_dependent")


def test_explicit_depends_on_service_code_mapping_true():
    """depends_on_service_code_mapping=true 明示 → mapping未確認時にclearしない"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                             "yokaigo_3plus_ratio": 0.6}}  # mapping非依存パスだが明示でmapping依存にする
    logic = _logic("all", [
        {"type": "condition", "fact": "receipt_pdf.yokaigo_3plus_ratio",
         "op": ">=", "value": 0.3, "label": "明示mapping依存",
         "depends_on_service_code_mapping": True}
    ])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "blocked_by_unverified_mapping", r
    print("✅ test_explicit_depends_on_service_code_mapping_true")


def test_explicit_depends_on_service_code_mapping_false():
    """depends_on_service_code_mapping=false 明示 → mapping未確認でも評価可"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                             "current_kasan_counts": {"X": 5}}}
    # 通常はcurrent_kasan_countsはmapping依存と推定されるが、明示でfalseにする
    logic = _logic("all", [
        {"type": "condition", "fact": "receipt_pdf.current_kasan_counts.X",
         "op": ">=", "value": 1, "label": "明示mapping非依存",
         "depends_on_service_code_mapping": False}
    ])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear", r
    print("✅ test_explicit_depends_on_service_code_mapping_false")


def test_mapping_held_status_in_aggregate():
    """all内に mapping保留 + clear が混在 → partially_clear"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                             "yokaigo_3plus_ratio": 0.6,
                             "current_kasan_counts": {"X": 5}}}
    logic = _logic("all", [
        _cond("receipt_pdf.yokaigo_3plus_ratio", ">=", 0.3, "mapping非依存clear"),
        _cond("receipt_pdf.current_kasan_counts.X", ">=", 1, "mapping依存保留"),
    ])
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "partially_clear", r
    assert r["satisfied_route"], "satisfied_routeあり期待"
    assert r["mapping_held_conditions"], "mapping保留あり期待"
    print("✅ test_mapping_held_status_in_aggregate")


def test_logic_absent_returns_unknown():
    r = evaluate_requirement_logic(None, {}, {"source_status": "checked"})
    assert r["status"] == "unknown"
    assert r["logic_status"] == "absent"
    print("✅ test_logic_absent_returns_unknown")


def test_build_facts_from_evidence():
    evidence = {
        "evidence": [{
            "yokaigo_3plus_ratio": 0.5,
            "current_kasan_counts": {"x": 3},
            "service_code_mapping_status": "pattern_based_unverified",
        }]
    }
    tenant_status = {"requirement_status": {"届出": {"status": "clear"}}}
    facts = build_facts_from_evidence(evidence, tenant_status)
    assert facts["receipt_pdf"]["yokaigo_3plus_ratio"] == 0.5
    assert facts["tenant_status"]["届出"]["status"] == "clear"
    print("✅ test_build_facts_from_evidence")


if __name__ == "__main__":
    test_all_conditions_clear()
    test_any_one_route_clear()
    test_nested_all_any()
    test_blocked_by_missing_evidence()
    test_source_required_safety_valve()
    test_logic_unchecked_safety_valve()
    test_not_applicable_safety_valve()
    test_pdf_undetected_not_treated_as_unbilled()
    test_pattern_unverified_warning()
    test_pattern_unverified_blocks_mapping_dependent()
    test_explicit_depends_on_service_code_mapping_true()
    test_explicit_depends_on_service_code_mapping_false()
    test_mapping_held_status_in_aggregate()
    test_logic_absent_returns_unknown()
    test_build_facts_from_evidence()
    print("\nAll DSL tests passed.")
