"""DEMO user_summary.json bridge テスト（alpha.5.4）"""
import io
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from requirement_dsl import (
    load_user_summary, build_facts_from_user_summary, merge_requirement_facts,
    build_user_summary_display, evaluate_requirement_logic,
    _user_summary_is_safe,
)


ROOT = Path(__file__).resolve().parents[2].parent
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"
DEMO_USER_DIR = PRODUCT_ROOT / "tenant_data" / "demo_user_summary"


def test_load_all_demo_user_summaries():
    """4つのDEMO user_summary.jsonが読み込める"""
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = DEMO_USER_DIR / office / "user_summary.json"
        us = load_user_summary(str(path))
        assert us is not None, f"{office} 読込失敗"
        assert us["sample_policy"] == "public_demo_synthetic"
        assert us["office_code"] == office
        assert "users_total" in us
        assert "care_level_3_or_higher_ratio" in us
    print("✅ test_load_all_demo_user_summaries")


def test_demo_user_summary_no_pii_in_files():
    """DEMO user_summaryに実利用者名・被保険者番号・電話・住所・生年月日・PII禁止語が入っていない"""
    forbidden_str = ["SUN", "ホットステーション", "1367197775", "1371802743", "1371802982"]
    pii_keys = ["name", "kana", "address", "phone", "tel", "email", "birthday", "birth_date",
                "hihokensha_number", "insured_number", "family_member", "iryo_kikan_name",
                "byoumei", "shoubyou_name"]
    hits = []
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = DEMO_USER_DIR / office / "user_summary.json"
        text = path.read_text(encoding="utf-8")
        for kw in forbidden_str:
            if kw in text:
                hits.append((office, "禁止語", kw))
        # PII keys must not appear as JSON keys
        data = json.loads(text)
        def walk(node):
            if isinstance(node, dict):
                for k in node:
                    if k in pii_keys:
                        hits.append((office, "PII key", k))
                    walk(node[k])
            elif isinstance(node, list):
                for it in node: walk(it)
        walk(data)
    assert not hits, f"DEMO user_summary PII HIT: {hits}"
    print("✅ test_demo_user_summary_no_pii_in_files")


def test_demo_user_summary_has_synthetic_marker():
    """4つのDEMO user_summaryに「公開デモ用の架空サンプル」明記"""
    for office in ("DEMO-0004", "DEMO-0005", "DEMO-0006", "DEMO-0007"):
        path = DEMO_USER_DIR / office / "user_summary.json"
        us = json.loads(path.read_text(encoding="utf-8"))
        assert us["sample_policy"] == "public_demo_synthetic"
        notes_text = " ".join(us.get("notes", []))
        assert "架空" in notes_text, f"{office} 架空サンプル明記なし"
    print("✅ test_demo_user_summary_has_synthetic_marker")


def test_user_summary_is_safe_detects_forbidden_field():
    """raw個票・PII関連フィールドが検出される"""
    safe = {"sample_policy": "public_demo_synthetic", "users_total": 40,
            "care_level_3_or_higher_ratio": 0.5}
    assert _user_summary_is_safe(safe) is True

    unsafe_with_users = {"sample_policy": "public_demo_synthetic",
                         "users": [{"id": "x", "name": "Y"}]}
    assert _user_summary_is_safe(unsafe_with_users) is False

    unsafe_with_birthday = {"sample_policy": "public_demo_synthetic",
                             "stat": {"birthday": "1950-01-01"}}
    assert _user_summary_is_safe(unsafe_with_birthday) is False

    unsafe_with_phone = {"sample_policy": "public_demo_synthetic",
                          "contact": {"phone": "03-1234-5678"}}
    assert _user_summary_is_safe(unsafe_with_phone) is False
    print("✅ test_user_summary_is_safe_detects_forbidden_field")


def test_build_facts_from_user_summary_returns_only_aggregates():
    """user_summary factsには集計値のみ含まれ、PII raw値は含まれない"""
    us = load_user_summary(str(DEMO_USER_DIR / "DEMO-0004" / "user_summary.json"))
    facts = build_facts_from_user_summary(us, service_key="tsusho_kaigo")
    expected = {
        "user_summary.users_total",
        "user_summary.care_level_3_or_higher_count",
        "user_summary.care_level_3_or_higher_ratio",
        "user_summary.severe_user_count",
        "user_summary.severe_user_ratio",
        "user_summary.dementia_related_count",
        "user_summary.medical_dependency_count",
        "user_summary.terminal_care_related_count",
        "user_summary.discharge_support_related_count",
        "user_summary.emergency_response_related_count",
        "user_summary.target_period_start",
        "user_summary.target_period_end",
        "user_summary.data_source_type",
        "user_summary.source_status",
        "user_summary.care_level_distribution",
        "user_summary.dementia_care_level_distribution",
    }
    assert expected.issubset(facts.keys()), f"足りないキー: {expected - facts.keys()}"
    # 個票keyは絶対に含まれない
    text = json.dumps(facts, ensure_ascii=False)
    for forbidden in ("name", "address", "phone", "birthday", "hihokensha"):
        # JSON 値内で出現していないこと（key名としてもfact path内にも）
        assert f'"{forbidden}"' not in text, f"PII key '{forbidden}' が facts に含まれる"
    # 値の整合
    assert facts["user_summary.users_total"] == 40
    assert facts["user_summary.care_level_3_or_higher_count"] == 27
    assert abs(facts["user_summary.care_level_3_or_higher_ratio"] - 0.675) < 0.001
    print("✅ test_build_facts_from_user_summary_returns_only_aggregates")


def test_non_synthetic_returns_empty():
    """sample_policy != public_demo_synthetic は空dict"""
    facts = build_facts_from_user_summary({"sample_policy": "real_data", "users_total": 100},
                                            service_key="tsusho_kaigo")
    assert facts == {}, "非DEMOデータは空辞書を返すべき"
    print("✅ test_non_synthetic_returns_empty")


def test_unsafe_user_summary_returns_empty():
    """raw個票・PIIを含む user_summary は空dict（builderで防護）"""
    unsafe = {"sample_policy": "public_demo_synthetic",
              "users_total": 30,
              "users": [{"id": "USR-001", "name": "テスト"}]}  # users個票が混入
    facts = build_facts_from_user_summary(unsafe, service_key="tsusho_kaigo")
    assert facts == {}, "PII含むuser_summaryは空辞書を返すべき"
    print("✅ test_unsafe_user_summary_returns_empty")


def test_merge_requirement_facts_isolates_user_summary():
    """receipt_pdf / tenant_status は user_summary fact dotted_key で侵入されない"""
    base = {"receipt_pdf": {"yokaigo_3plus_ratio": 0.6},
            "tenant_status": {"juudosha_ratio": {"value": 0.18}}}
    bad = {
        "receipt_pdf.yokaigo_3plus_ratio": 0.99,
        "tenant_status.juudosha_ratio.value": 0.99,
        "user_summary.care_level_3_or_higher_ratio": 0.7,
    }
    merged = merge_requirement_facts(base, None, bad)
    assert merged["receipt_pdf"]["yokaigo_3plus_ratio"] == 0.6, "receipt_pdf侵入禁止"
    assert merged["tenant_status"]["juudosha_ratio"]["value"] == 0.18, "tenant_status侵入禁止"
    assert merged["user_summary"]["care_level_3_or_higher_ratio"] == 0.7
    print("✅ test_merge_requirement_facts_isolates_user_summary")


def test_user_summary_clears_dsl_via_user_summary_route():
    """user_summary fact だけで DSL clear になる（tenant_status未設定でもuser_summaryで充足）"""
    us = load_user_summary(str(DEMO_USER_DIR / "DEMO-0007" / "user_summary.json"))
    user_facts = build_facts_from_user_summary(us, service_key="houmon_kango_kaigo")
    base = {"receipt_pdf": {}, "tenant_status": {}}
    facts = merge_requirement_facts(base, None, user_facts)
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "user_summary.severe_user_ratio",
         "op": ">=", "value": 0.30, "label": "重度者30%以上(user_summary)"},
        {"type": "condition", "fact": "user_summary.terminal_care_related_count",
         "op": ">=", "value": 1, "label": "看取り期実績1件以上(user_summary)"}
    ]}
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear", r
    print("✅ test_user_summary_clears_dsl_via_user_summary_route")


def test_user_summary_does_not_force_clear_when_source_required():
    """source_status != checked の要件は user_summary でも clear にしない"""
    us = load_user_summary(str(DEMO_USER_DIR / "DEMO-0004" / "user_summary.json"))
    user_facts = build_facts_from_user_summary(us, service_key="tsusho_kaigo")
    base = {"receipt_pdf": {}, "tenant_status": {}}
    facts = merge_requirement_facts(base, None, user_facts)
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "user_summary.users_total",
         "op": ">=", "value": 1, "label": "対象期間内に利用者あり"}
    ]}
    # source_status=source_required の場合は評価せず not_evaluated_source_required
    r = evaluate_requirement_logic(logic, facts, {"source_status": "source_required"})
    assert r["status"] == "not_evaluated_source_required", r
    print("✅ test_user_summary_does_not_force_clear_when_source_required")


def test_any_route_user_summary_suppresses_blocked_sibling():
    """any配下で user_summary が clear なら、tenant_status 側の不足は不足証跡に出ない"""
    base = {"receipt_pdf": {}, "tenant_status": {}}
    user_facts = {"user_summary.severe_user_ratio": 0.30}
    facts = merge_requirement_facts(base, None, user_facts)
    logic = {"logic_status": "checked", "operator": "any", "children": [
        {"type": "condition", "fact": "tenant_status.juudosha_ratio.value",
         "op": ">=", "value": 0.20,
         "label": "tenant_status: 重度者20%以上"},
        {"type": "condition", "fact": "user_summary.severe_user_ratio",
         "op": ">=", "value": 0.20,
         "label": "利用者集計: 重度者20%以上"}
    ]}
    r = evaluate_requirement_logic(logic, facts, {"source_status": "checked"})
    assert r["status"] == "clear", r
    # tenant_status側の不足はsuppressされる
    assert "tenant_status.juudosha_ratio.value" not in r.get("missing_evidence", [])
    print("✅ test_any_route_user_summary_suppresses_blocked_sibling")


def test_user_summary_display_excludes_raw_individual():
    """build_user_summary_display は集計値のみで、個別利用者情報を含まない"""
    us = load_user_summary(str(DEMO_USER_DIR / "DEMO-0007" / "user_summary.json"))
    user_facts = build_facts_from_user_summary(us, service_key="houmon_kango_kaigo")
    display = build_user_summary_display(user_facts, service_key="houmon_kango_kaigo")
    text = json.dumps(display, ensure_ascii=False)
    for forbidden in ("name", "氏名", "address", "住所", "phone", "電話", "birthday", "生年月日",
                       "hihokensha", "被保険者番号"):
        # JSON値文字列としても、key名としても出ない
        assert forbidden not in text or forbidden == "name" and '"name"' not in text, \
            f"display に raw 個票項目 '{forbidden}' が含まれる"
    print("✅ test_user_summary_display_excludes_raw_individual")


def test_judge_with_user_summary_outputs_section():
    """judge_kasan.py に --user-summary を渡すと「利用者データ連携」セクションが出る"""
    out_md = ROOT / "products/kasan-manager/out/_test_user_summary_section.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "tsusho_kaigo",
           "--office", "DEMO-0004",
           "--user-summary", str(DEMO_USER_DIR / "DEMO-0004/user_summary.json"),
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    assert "🧑‍🤝‍🧑 利用者データ連携" in md or "利用者データ連携（DEMO alpha）" in md, \
        "利用者データ連携セクションがない"
    # 集計値は含まれる
    assert "users_total" in md or "care_level_3_or_higher_ratio" in md
    # 個別個票データは出ない（透明性表現の中での言及はOK）
    # 個票が混入したら出るはずの「実値パターン」を検査
    import re
    # 被保険者番号らしき10桁数字
    assert not re.search(r'被保険者番号[:：]\s*\d{10}', md), "被保険者番号の実値が含まれる"
    # メールアドレス
    assert not re.search(r'\b[\w.+-]+@[\w-]+\.[\w.-]+', md), "メールアドレス値が含まれる"
    # 電話番号 (日本式)
    assert not re.search(r'\b0\d{1,4}-\d{1,4}-\d{4}\b', md), "電話番号値が含まれる"
    # 生年月日（日付付き）
    assert not re.search(r'生年月日[:：]\s*\d{4}', md), "生年月日値が含まれる"
    # PII keyが値として埋め込まれていない
    for forbidden in ("hihokensha_number", "iryo_kikan_name", "byoumei", "shoubyou_name"):
        assert forbidden not in md, f"public sample に raw 個票キー '{forbidden}' が値として含まれる"
    print("✅ test_judge_with_user_summary_outputs_section")


def test_judge_without_user_summary_still_works():
    """--user-summary なしでも動作（後方互換）"""
    out_md = ROOT / "products/kasan-manager/out/_test_no_user_summary.md"
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts/judge_kasan.py"),
           "--domain", "kaigo", "--service", "tsusho_kaigo",
           "--office", "DEMO-0004",
           "--report-md", str(out_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode == 0, f"judge失敗: {result.stderr}"
    md = out_md.read_text(encoding="utf-8")
    assert "利用者データ連携" not in md, "user_summary未指定で利用者データ連携セクションが出ている"
    print("✅ test_judge_without_user_summary_still_works")


def test_alpha53_release_pack_not_modified():
    """alpha.5.3 public release pack の主要ファイルが alpha.5.4 着手後に変わっていない（位置確認のみ）"""
    pack_dir = PRODUCT_ROOT / "releases/public/v2026.05.06-alpha.5.3"
    required = ["README.md", "PRODUCT_OVERVIEW.md", "DEMO_SCRIPT.md", "SAMPLE_REPORTS_INDEX.md",
                "KNOWN_LIMITATIONS.md", "DATA_SAFETY.md", "RELEASE_CHECKLIST.md", "RELEASE_MANIFEST.json"]
    for f in required:
        assert (pack_dir / f).exists(), f"alpha.5.3 release pack ファイル {f} が消えている"
    manifest = json.loads((pack_dir / "RELEASE_MANIFEST.json").read_text(encoding="utf-8"))
    # alpha.5.3-public-demo.1 として固定されたバージョンが維持されている
    assert manifest["release_version"] == "v2026.05.06-alpha.5.3-public-demo.1"
    assert manifest["base_commit"] == "c32f313"
    print("✅ test_alpha53_release_pack_not_modified")


if __name__ == "__main__":
    test_load_all_demo_user_summaries()
    test_demo_user_summary_no_pii_in_files()
    test_demo_user_summary_has_synthetic_marker()
    test_user_summary_is_safe_detects_forbidden_field()
    test_build_facts_from_user_summary_returns_only_aggregates()
    test_non_synthetic_returns_empty()
    test_unsafe_user_summary_returns_empty()
    test_merge_requirement_facts_isolates_user_summary()
    test_user_summary_clears_dsl_via_user_summary_route()
    test_user_summary_does_not_force_clear_when_source_required()
    test_any_route_user_summary_suppresses_blocked_sibling()
    test_user_summary_display_excludes_raw_individual()
    test_judge_with_user_summary_outputs_section()
    test_judge_without_user_summary_still_works()
    test_alpha53_release_pack_not_modified()
    print("\nAll user_summary tests passed.")
