"""DEMO tenant_status fact builder テスト（alpha.5.2）"""
import io
import json
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from requirement_dsl import (
    load_demo_tenant_status, merge_demo_tenant_facts,
    evaluate_requirement_logic, get_fact,
)


PRODUCT_ROOT = Path(__file__).resolve().parents[1]


def test_load_all_demo_tenant_statuses():
    """4つのDEMO tenant_statusが読み込める"""
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = PRODUCT_ROOT / "tenant_data" / "demo_status" / office / "tenant_status.json"
        ts = load_demo_tenant_status(str(path))
        assert ts is not None, f"{office} 読込失敗"
        assert ts["sample_policy"] == "public_demo_synthetic"
        assert ts["office_code"] == office
        assert "facts" in ts and ts["facts"]
    print("✅ test_load_all_demo_tenant_statuses")


def test_merge_demo_tenant_facts_does_not_override_receipt_pdf():
    """receipt_pdf.* は tenant_statusで上書きされない"""
    base = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.6}, "tenant_status": {}}
    demo = {"facts": {
        "receipt_pdf.yokaigo_3plus_ratio": 0.99,  # 上書き試行
        "tenant_status.X.status": "clear",
    }}
    merged = merge_demo_tenant_facts(base, demo)
    assert merged["receipt_pdf"]["yokaigo_3plus_ratio"] == 0.6, "receipt_pdf上書き禁止"
    assert merged["tenant_status"]["X"]["status"] == "clear"
    print("✅ test_merge_demo_tenant_facts_does_not_override_receipt_pdf")


def test_demo_facts_make_dsl_clear():
    """DEMO factsで条件clearになる"""
    base = {"receipt_pdf": {}, "tenant_status": {}}
    demo = {"facts": {"tenant_status.届出.status": "clear"}}
    facts = merge_demo_tenant_facts(base, demo)
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "tenant_status.届出.status",
         "op": "==", "value": "clear", "label": "届出済"}
    ]}
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear", r
    print("✅ test_demo_facts_make_dsl_clear")


def test_demo_missing_value_treated_as_blocked():
    """DEMO factsで 'missing' 値は blocked_by_missing_evidence になる"""
    base = {"receipt_pdf": {}, "tenant_status": {}}
    demo = {"facts": {"tenant_status.議事録.status": "missing"}}
    facts = merge_demo_tenant_facts(base, demo)
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "tenant_status.議事録.status",
         "op": "==", "value": "clear", "label": "議事録あり"}
    ]}
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "blocked_by_missing_evidence", r
    assert "tenant_status.議事録.status" in r["missing_evidence"]
    print("✅ test_demo_missing_value_treated_as_blocked")


def test_demo_any_route_clear():
    """ANY条件でDEMO 1ルートclearなら satisfied_route表示"""
    base = {"receipt_pdf": {}, "tenant_status": {}}
    demo = {"facts": {
        "tenant_status.A.value": 0.20,  # ルートA: 20%以上で達成
        "tenant_status.B.value": 0,     # ルートB: 0なので未達成
    }}
    facts = merge_demo_tenant_facts(base, demo)
    logic = {"logic_status": "checked", "operator": "any", "children": [
        {"type": "condition", "fact": "tenant_status.A.value",
         "op": ">=", "value": 0.20, "label": "Aルート: 20%以上"},
        {"type": "condition", "fact": "tenant_status.B.value",
         "op": ">=", "value": 1, "label": "Bルート: 1件以上"},
    ]}
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear"
    assert any("Aルート" in s for s in r["satisfied_route"])
    print("✅ test_demo_any_route_clear")


def test_demo_tenant_status_no_pii_in_files():
    """4つのDEMO tenant_statusに禁止語・PIIが入っていない"""
    forbidden = ["SUN", "ホットステーション", "1367197775", "1371802743", "1371802982",
                 "専務", "事務長", "サ責A", "サ責B", "サ責C", "サ責D",
                 "藤田", "浅野", "新居", "小幡", "茂木", "増田", "506万円"]
    hits = []
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = PRODUCT_ROOT / "tenant_data" / "demo_status" / office / "tenant_status.json"
        text = path.read_text(encoding="utf-8")
        for kw in forbidden:
            if kw in text:
                hits.append((office, kw))
    assert not hits, f"DEMO tenant_status PII HIT: {hits}"
    print("✅ test_demo_tenant_status_no_pii_in_files")


def test_demo_tenant_status_has_demo_marker():
    """4つのDEMO tenant_statusに「公開デモ用の架空サンプル」明記"""
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = PRODUCT_ROOT / "tenant_data" / "demo_status" / office / "tenant_status.json"
        ts = json.loads(path.read_text(encoding="utf-8"))
        assert ts["sample_policy"] == "public_demo_synthetic"
        notes_text = " ".join(ts.get("notes", []))
        assert "架空" in notes_text, f"{office} 架空サンプル明記なし"
    print("✅ test_demo_tenant_status_has_demo_marker")


if __name__ == "__main__":
    test_load_all_demo_tenant_statuses()
    test_merge_demo_tenant_facts_does_not_override_receipt_pdf()
    test_demo_facts_make_dsl_clear()
    test_demo_missing_value_treated_as_blocked()
    test_demo_any_route_clear()
    test_demo_tenant_status_no_pii_in_files()
    test_demo_tenant_status_has_demo_marker()
    print("\nAll tenant_status fact tests passed.")
