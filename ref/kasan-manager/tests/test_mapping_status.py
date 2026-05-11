"""service_code_mapping_status per-kasan テスト（alpha.5.5）"""
import io
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from import_receipt_pdf import (
    load_per_kasan_mapping_status, summarize_mapping_status_breakdown,
    SERVICE_CODE_MAPPING_STATUS, load_source_registry,
    resolve_current_source_for_date, get_definitive_sources_for_period,
)
from requirement_dsl import evaluate_requirement_logic


ROOT = Path(__file__).resolve().parents[2].parent
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"


def test_load_per_kasan_mapping_houmon_kango_kaigo():
    """houmon_kango_kaigo の per-kasan mapping_status が読める（alpha.5.6 で14件 checked）"""
    m = load_per_kasan_mapping_status("houmon_kango_kaigo")
    assert m, "houmon_kango_kaigo mapping 読込失敗"
    # alpha.5.5 維持 8加算 + alpha.5.6 昇格 5加算 + 新規 1加算 = 14加算 checked
    expected_checked = [
        # alpha.5.5 keep_checked (確定版でも整合)
        "tokubetsu_kanri_kasan_I", "tokubetsu_kanri_kasan_II",
        "kango_taisei_kyouka_kasan_I", "kango_taisei_kyouka_kasan_II",
        "service_taisei_kyouka_kasan_I", "service_taisei_kyouka_kasan_II",
        "taiin_kyoudou_shidou_kasan", "kango_kaigo_renkei_kyouka_kasan",
        # alpha.5.6 promoted (案版誤りで保留されていた・確定版で社内マスタと整合判明)
        "kinkyu_houmon_kango_kasan_I", "kinkyu_houmon_kango_kasan_II",
        "terminal_care_kasan", "shokai_kasan_I", "shokai_kasan_II",
        # alpha.5.6 newly_checked
        "koukuu_renkei_kyouka_kasan",
    ]
    for k in expected_checked:
        assert k in m, f"{k} がマッピング辞書にない"
        assert m[k]["status"] == "checked", f"{k}: status={m[k]['status']} 想定 checked"
    # not_applicable 1加算
    assert m["ninchi_senmon_care_kasan"]["status"] == "not_applicable"
    # alpha.5.6 で残った pattern_based_unverified
    expected_unverified = [
        "kagakuteki_kaigo_suishin_kasan",  # not_found_in_definitive_source
        "shougu_kaizen_kasan_2026_06",     # out_of_definitive_scope (R8.6改定対象)
        "fukusu_mei_houmon_kango_kasan_I_under30",  # structural_mismatch
        "fukusu_mei_houmon_kango_kasan_I_over30",
        "fukusu_mei_houmon_kango_kasan_II_under30",
        "fukusu_mei_houmon_kango_kasan_II_over30",
        "chouji_kan_houmon_kango_kasan",
    ]
    for k in expected_unverified:
        assert m[k]["status"] == "pattern_based_unverified", f"{k} は unverified 想定"
    print("✅ test_load_per_kasan_mapping_houmon_kango_kaigo")


def test_load_per_kasan_mapping_other_services():
    """alpha.5.7: 他3サービス mapping_status の状態
    - tsusho_kaigo: 6 exact_match → checked, 残り pattern_based_unverified
    - houmon_kaigo: 全件 pattern_based_unverified（社内コード体系不整合）
    - kyotaku_shien: 全件 pattern_based_unverified（社内コード体系不整合）
    """
    # tsusho_kaigo: 6件 exact_match → checked
    m = load_per_kasan_mapping_status("tsusho_kaigo")
    checked_count = sum(1 for v in m.values() if v["status"] == "checked")
    assert checked_count == 6, f"tsusho_kaigo checked数={checked_count} 想定 6"
    # houmon_kaigo: 全件 pattern_based_unverified
    m = load_per_kasan_mapping_status("houmon_kaigo")
    for k, v in m.items():
        assert v["status"] == "pattern_based_unverified", \
            f"houmon_kaigo/{k}: status={v['status']} 想定 pattern_based_unverified"
    # kyotaku_shien: 全件 pattern_based_unverified
    m = load_per_kasan_mapping_status("kyotaku_shien")
    for k, v in m.items():
        assert v["status"] == "pattern_based_unverified", \
            f"kyotaku_shien/{k}: status={v['status']} 想定 pattern_based_unverified"
    print("✅ test_load_per_kasan_mapping_other_services")


def test_summarize_mapping_status_breakdown():
    """サマリ集計が正しい（alpha.5.6 で14件 checked）"""
    m = load_per_kasan_mapping_status("houmon_kango_kaigo")
    s = summarize_mapping_status_breakdown(m)
    assert s["checked"] == 14, f"checked数想定外（alpha.5.6で14件想定）: {s}"
    assert s["not_applicable"] == 1, f"not_applicable数想定外: {s}"
    assert s["pattern_based_unverified"] == 7, f"pattern数想定外（alpha.5.6で7件想定）: {s}"
    print("✅ test_summarize_mapping_status_breakdown")


def test_dsl_with_kasan_checked_status_clears_mapping_warning():
    """item_meta.service_code_mapping_status=checked なら mapping_unverified を解除"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                              "current_kasan_counts": {"X": 1}}}
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "receipt_pdf.current_kasan_counts.X",
         "op": ">=", "value": 1,
         "depends_on_service_code_mapping": True,
         "label": "PDF mapping依存fact"}
    ]}
    # service-level pattern_based_unverified だが、kasan-level は checked
    item_meta = {"source_status": "checked", "service_code_mapping_status": "checked"}
    r = evaluate_requirement_logic(logic, facts, item_meta)
    # mapping_unverified=False なので clear になる
    assert r["status"] == "clear", r
    # notes に「checked」記載が含まれる
    assert any("checked" in n for n in r.get("notes", [])), f"checked記載なし: {r['notes']}"
    print("✅ test_dsl_with_kasan_checked_status_clears_mapping_warning")


def test_dsl_with_kasan_pattern_unverified_blocks_mapping_dependent():
    """item_meta.service_code_mapping_status=pattern_based_unverified なら mapping依存factを保留"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                              "current_kasan_counts": {"X": 1}}}
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "receipt_pdf.current_kasan_counts.X",
         "op": ">=", "value": 1,
         "depends_on_service_code_mapping": True,
         "label": "PDF mapping依存fact"}
    ]}
    item_meta = {"source_status": "checked",
                 "service_code_mapping_status": "pattern_based_unverified"}
    r = evaluate_requirement_logic(logic, facts, item_meta)
    # mapping_unverified=True で blocked_by_unverified_mapping
    assert r["status"] == "blocked_by_unverified_mapping", r
    print("✅ test_dsl_with_kasan_pattern_unverified_blocks_mapping_dependent")


def test_dsl_kasan_not_applicable_via_applicability():
    """applicability=not_applicable は mapping_status と独立に not_applicable"""
    facts = {"receipt_pdf": {}}
    logic = {"logic_status": "checked", "operator": "all", "children": []}
    item_meta = {"source_status": "checked",
                 "applicability": "not_applicable",
                 "applicability_reason": "test",
                 "service_code_mapping_status": "not_applicable"}
    r = evaluate_requirement_logic(logic, facts, item_meta)
    assert r["status"] == "not_applicable", r
    print("✅ test_dsl_kasan_not_applicable_via_applicability")


def test_dsl_source_required_not_force_clear():
    """service_code_mapping_status=checked でも source_status != checked は clear しない"""
    facts = {"receipt_pdf": {"service_code_mapping_status": "pattern_based_unverified",
                              "current_kasan_counts": {"X": 5}}}
    logic = {"logic_status": "checked", "operator": "all", "children": [
        {"type": "condition", "fact": "receipt_pdf.current_kasan_counts.X",
         "op": ">=", "value": 1, "label": "X存在"}
    ]}
    # source_status=source_required は最優先で評価せず
    item_meta = {"source_status": "source_required",
                 "service_code_mapping_status": "checked"}
    r = evaluate_requirement_logic(logic, facts, item_meta)
    assert r["status"] == "not_evaluated_source_required", r
    print("✅ test_dsl_source_required_not_force_clear")


def test_judge_kasan_includes_mapping_status_in_report():
    """judge_kasan.py が レポートに mapping カラムを含む"""
    out_md = ROOT / "products/kasan-manager/out/_test_mapping_status_section.md"
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
    # DSL評価セクション内に mapping カラムヘッダ
    assert "| 加算 | PDF検出 | 要件評価 | mapping |" in md, "mapping カラムがヘッダにない"
    # サービスコード照合監査セクション
    assert "サービスコード照合監査" in md, "監査セクションがない"
    print("✅ test_judge_kasan_includes_mapping_status_in_report")


def test_alpha54_release_pack_not_modified():
    """alpha.5.4 public release pack の主要ファイルが alpha.5.5 着手後に変わっていない（位置確認のみ）"""
    pack_dir = PRODUCT_ROOT / "releases/public/v2026.05.06-alpha.5.4"
    required = ["README.md", "PRODUCT_OVERVIEW.md", "DEMO_SCRIPT.md", "SAMPLE_REPORTS_INDEX.md",
                "KNOWN_LIMITATIONS.md", "DATA_SAFETY.md", "RELEASE_CHECKLIST.md", "RELEASE_MANIFEST.json"]
    for f in required:
        assert (pack_dir / f).exists(), f"alpha.5.4 release pack ファイル {f} が消えている"
    manifest = json.loads((pack_dir / "RELEASE_MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["release_version"] == "v2026.05.06-alpha.5.4-public-demo.1"
    assert manifest["base_commit"] == "c756d90"
    print("✅ test_alpha54_release_pack_not_modified")


def test_audit_metadata_in_master():
    """houmon_kango_kaigo マスタに alpha.5.6 / alpha.5.7 service_code_mapping_audit が記録されている"""
    path = PRODUCT_ROOT / "regulatory_master/kaigo/houmon_kango_kaigo.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    audit = d["_meta"].get("service_code_mapping_audit") or {}
    # alpha.5.7 / alpha.5.7.1 / alpha.5.7.2 / alpha.5.8 / alpha.5.8.1 で audit_version を更新
    assert audit.get("audit_version") in (
        "alpha.5.6", "alpha.5.7", "alpha.5.7.1", "alpha.5.7.2", "alpha.5.8", "alpha.5.8.1"
    ), f"audit_version={audit.get('audit_version')}"
    assert audit.get("checked_count") == 14, f"checked_count={audit.get('checked_count')}"
    assert audit.get("not_applicable_count") == 1
    # alpha.5.6: definitive_source の存在確認
    defin = audit.get("definitive_source") or {}
    assert defin.get("source_kind") == "definitive", f"source_kind={defin.get('source_kind')}"
    assert defin.get("source_url"), "definitive source URL 記録なし"
    assert "2024/0506103517756" in defin.get("source_url", ""), "確定版URLでない"
    # alpha.5.5 provisional source の記録も残っている
    prov = audit.get("alpha_5_5_provisional_source_used") or {}
    assert prov.get("source_kind") == "provisional"
    # alpha.5.7 / alpha.5.7.1: R7.4 reconfirm の記録（5.7.1 で source_id が確定版へ訂正）
    if audit.get("audit_version") in ("alpha.5.7", "alpha.5.7.1"):
        r7_reconfirm = audit.get("alpha_5_7_r7_4_reconfirm") or {}
        # alpha.5.7.1 訂正後は WAM_R7_4_DEFINITIVE_2025_03_28
        # alpha.5.7 時点では WAM_R7_4_DEFINITIVE_2025_02_01 だった
        assert r7_reconfirm.get("source_id") in (
            "WAM_R7_4_DEFINITIVE_2025_02_01",
            "WAM_R7_4_DEFINITIVE_2025_03_28",
        ), f"unexpected source_id: {r7_reconfirm.get('source_id')}"
    print("✅ test_audit_metadata_in_master")


def test_alpha_5_5_revalidation_summary_in_master():
    """alpha.5.5 → alpha.5.6 の再検証サマリが記録されている"""
    path = PRODUCT_ROOT / "regulatory_master/kaigo/houmon_kango_kaigo.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    summary = d["_meta"]["service_code_mapping_audit"].get("alpha_5_5_revalidation_summary") or {}
    assert summary.get("kept_checked") == 8
    assert summary.get("promoted_from_pattern_unverified") == 5
    assert summary.get("newly_checked_in_alpha_5_6") == 1
    print("✅ test_alpha_5_5_revalidation_summary_in_master")


def test_provisional_source_not_used_for_definitive_check():
    """source_kind が draft/provisional の場合、checked に昇格しない（規則のみ確認）"""
    # 確定版で confirmed されている item は keep_checked
    m = load_per_kasan_mapping_status("houmon_kango_kaigo")
    audit = m["tokubetsu_kanri_kasan_I"]["audit"]
    # service_code_audit.source_kind は definitive
    assert audit.get("source_kind") == "definitive", f"source_kind={audit.get('source_kind')}"
    print("✅ test_provisional_source_not_used_for_definitive_check")


def test_source_registry_exists():
    """alpha.5.7.1: source registry JSON が R7.4 確定版 source を持つ"""
    path = PRODUCT_ROOT / "regulatory_master/sources/kaigo_service_code_sources.json"
    assert path.exists(), "source registry が見つからない"
    d = json.loads(path.read_text(encoding="utf-8"))
    sources = d.get("sources", {})
    # R6.4 案版
    assert "WAM_R6_4_PROVISIONAL_2024_03_18" in sources
    assert sources["WAM_R6_4_PROVISIONAL_2024_03_18"]["source_kind"] == "provisional"
    # R6.6/8 確定版
    assert "WAM_R6_6_8_DEFINITIVE_2024_05_07" in sources
    assert sources["WAM_R6_6_8_DEFINITIVE_2024_05_07"]["source_kind"] == "definitive"
    assert sources["WAM_R6_6_8_DEFINITIVE_2024_05_07"]["revision_status"] == "historical_definitive"
    # alpha.5.7.1: 2025-02-01 は provisional に降格
    assert "WAM_R7_4_PROVISIONAL_2025_02_01" in sources, \
        "alpha.5.7.1: 2025-02-01 版が provisional として登録されているべき"
    assert sources["WAM_R7_4_PROVISIONAL_2025_02_01"]["source_kind"] == "provisional"
    assert sources["WAM_R7_4_PROVISIONAL_2025_02_01"]["revision_status"] == "provisional_historical"
    # alpha.5.7.1: 2025-03-28 確定版 R7.4 (alpha.5.7.2 で historical_definitive へ降格)
    assert "WAM_R7_4_DEFINITIVE_2025_03_28" in sources, \
        "alpha.5.7.1: 2025-03-28 確定版 (R7.4) が登録されているべき"
    assert sources["WAM_R7_4_DEFINITIVE_2025_03_28"]["source_kind"] == "definitive"
    # alpha.5.7.2 で current_definitive → historical_definitive へ降格
    assert sources["WAM_R7_4_DEFINITIVE_2025_03_28"]["revision_status"] in (
        "current_definitive", "historical_definitive"
    )
    # R7.8 確定版 (alpha.5.7.2 で current_definitive へ昇格)
    assert "WAM_R7_8_DEFINITIVE_2025_03_28" in sources
    assert sources["WAM_R7_8_DEFINITIVE_2025_03_28"]["source_kind"] == "definitive"
    # R8.6 案 (実URL付き)
    assert "WAM_R8_6_8_PROVISIONAL_2026_04_20" in sources
    assert sources["WAM_R8_6_8_PROVISIONAL_2026_04_20"]["source_kind"] == "provisional"
    assert sources["WAM_R8_6_8_PROVISIONAL_2026_04_20"]["revision_status"] == "provisional_future"
    assert sources["WAM_R8_6_8_PROVISIONAL_2026_04_20"]["source_url"], "R8.6 case URL 必須"
    print("✅ test_source_registry_exists")


def test_old_source_id_not_definitive():
    """alpha.5.7.1: 旧 source_id WAM_R7_4_DEFINITIVE_2025_02_01 が definitive として残っていないこと"""
    path = PRODUCT_ROOT / "regulatory_master/sources/kaigo_service_code_sources.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    sources = d.get("sources", {})
    # 旧 ID は registry から消えているか、provisional に置き換わっている
    if "WAM_R7_4_DEFINITIVE_2025_02_01" in sources:
        assert sources["WAM_R7_4_DEFINITIVE_2025_02_01"]["source_kind"] != "definitive", \
            "旧 ID が definitive のまま残っている"
    # 全マスタ・全加算で、source_id が 2025-02-01 を definitive 扱いで使っていないこと
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            audit = v.get("service_code_audit") or {}
            sid = audit.get("source_id")
            assert sid != "WAM_R7_4_DEFINITIVE_2025_02_01", \
                f"{svc}/{k}: 旧 source_id (2025-02-01定義) が残っている"
    print("✅ test_old_source_id_not_definitive")


def test_parent_page_provisional_marker_demoted():
    """alpha.5.7.1: 親ページに「（その2）」案表記がある source は provisional"""
    path = PRODUCT_ROOT / "regulatory_master/sources/kaigo_service_code_sources.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    s = d["sources"]["WAM_R7_4_PROVISIONAL_2025_02_01"]
    # PDF本文には「案」表示がないが、親ページが「（その2）」（案・予備版）のため provisional
    assert s["source_kind"] == "provisional"
    assert "その2" in s.get("parent_page_title", "") or "その２" in s.get("parent_page_title", "")
    # source_kind 判定ルールが registry に明記されている
    rules = d["_meta"].get("source_kind_determination_rules", [])
    assert any("親WAM NET detailページ" in r or "親ページ" in r for r in rules), \
        "親ページ判定ルールが未明記"
    print("✅ test_parent_page_provisional_marker_demoted")


def test_provisional_future_does_not_promote_to_checked():
    """provisional_future (R8.6案) は checked 昇格に使われない"""
    path = PRODUCT_ROOT / "regulatory_master/sources/kaigo_service_code_sources.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    s = d["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_20"]
    assert s["source_kind"] == "provisional"
    assert s["revision_status"] == "provisional_future"
    # 全マスタの service_code_audit に WAM_R8_6_8 source_id が使われていないこと（または使われていても checked にしていないこと）
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            audit = v.get("service_code_audit") or {}
            sid = audit.get("source_id")
            if sid == "WAM_R8_6_8_PROVISIONAL_2026_04_20":
                assert v.get("service_code_mapping_status") != "checked", \
                    f"{svc}/{k}: R8.6案を根拠に checked 化されている"
    print("✅ test_provisional_future_does_not_promote_to_checked")


def test_alpha_5_8_three_layer_schema_exists():
    """alpha.5.8: 三層モデル schema ファイルが存在し主要要素を含む"""
    schema_path = PRODUCT_ROOT / "regulatory_master/sources/code_model_schema.json"
    assert schema_path.exists(), "code_model_schema.json が見つからない"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert "official_code_model_schema" in schema
    assert "receipt_detection_model_schema" in schema
    assert "internal_legacy_model_schema" in schema
    assert "overall_mapping_status_enum" in schema
    assert "checked" in schema["overall_mapping_status_enum"]
    assert "needs_review" in schema["overall_mapping_status_enum"]
    assert "provisional_future" in schema["overall_mapping_status_enum"]
    print("✅ test_alpha_5_8_three_layer_schema_exists")


def test_alpha_5_8_three_layer_in_master():
    """alpha.5.8: 各加算に三層モデルフィールドが書き込まれている"""
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            audit = v.get("service_code_audit") or {}
            three = audit.get("alpha_5_8_three_layer_model") or {}
            assert "official_code_model" in three, f"{svc}/{k}: official_code_model未記載"
            assert "receipt_detection_model" in three, f"{svc}/{k}: receipt_detection_model未記載"
            assert "internal_legacy_model" in three, f"{svc}/{k}: internal_legacy_model未記載"
            assert "overall_mapping_status" in three
            # overall_mapping_status と新設フィールドが整合
            assert v.get("overall_mapping_status") == three["overall_mapping_status"]
    print("✅ test_alpha_5_8_three_layer_in_master")


def test_alpha_5_8_checked_20_maintained():
    """alpha.5.8: checked 20件が維持されている"""
    # houmon_kango_kaigo 14件
    m = load_per_kasan_mapping_status("houmon_kango_kaigo")
    assert sum(1 for v in m.values() if v["status"] == "checked") == 14
    # tsusho_kaigo 6件
    m = load_per_kasan_mapping_status("tsusho_kaigo")
    assert sum(1 for v in m.values() if v["status"] == "checked") == 6
    print("✅ test_alpha_5_8_checked_20_maintained")


def test_alpha_5_8_legacy_detection_does_not_promote_to_checked():
    """alpha.5.8: receipt_detection_status=legacy_detection_only なら overall は checked にならない"""
    for svc in ("houmon_kaigo", "kyotaku_shien"):
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            audit = v.get("service_code_audit") or {}
            three = audit.get("alpha_5_8_three_layer_model") or {}
            recv = three.get("receipt_detection_model", {})
            if recv.get("receipt_detection_status") == "legacy_detection_only":
                assert three.get("overall_mapping_status") != "checked", \
                    f"{svc}/{k}: legacy_detection_only なのに checked"
    print("✅ test_alpha_5_8_legacy_detection_does_not_promote_to_checked")


def test_alpha_5_8_r8_6_2026_04_30_provisional_future():
    """alpha.5.8: R8.6（その3・2026-04-30）が provisional_future として登録"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_30"]
    assert s["source_kind"] == "provisional"
    assert s["revision_status"] == "provisional_future"
    assert "その3" in s.get("parent_page_title", "")
    print("✅ test_alpha_5_8_r8_6_2026_04_30_provisional_future")


def test_alpha_5_8_proposed_action_covers_45_unresolved():
    """alpha.5.8: 未解決45件が proposed_action で分類されている"""
    counts = {}
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            audit = v.get("service_code_audit") or {}
            three = audit.get("alpha_5_8_three_layer_model") or {}
            pa = three.get("proposed_action")
            counts[pa] = counts.get(pa, 0) + 1
    # checked 20 + needs_review 等の分類が網羅
    assert counts.get("keep_checked", 0) == 20, f"keep_checked={counts.get('keep_checked')}"
    assert counts.get("not_applicable_confirmed", 0) == 1
    # needs_master_review が houmon_kaigo / kyotaku_shien で多数
    assert counts.get("needs_master_review", 0) >= 20
    print(f"✅ test_alpha_5_8_proposed_action_covers_45_unresolved: {counts}")


# ============================================================
# alpha.5.8.1 audit metadata consistency hotfix tests
# ============================================================

ALPHA_5_8_1_SERVICES = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")


def _alpha_5_8_1_iter_kasans():
    """4サービス全 kasan を (service, kasan_key, kasan_def) で順次返す。"""
    for svc in ALPHA_5_8_1_SERVICES:
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            yield svc, k, v


def test_alpha_5_8_1_proposed_action_sums_to_66():
    """alpha.5.8.1: proposed_action の合計は exactly 66"""
    counts = {}
    total = 0
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        total += 1
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        assert pa, f"{svc}.{k} に proposed_action が無い"
        counts[pa] = counts.get(pa, 0) + 1
    assert total == 66, f"total={total}"
    assert sum(counts.values()) == 66, f"proposed_action sum={sum(counts.values())}"
    print(f"✅ test_alpha_5_8_1_proposed_action_sums_to_66: total=66 / {counts}")


def test_alpha_5_8_1_overall_mapping_status_sums_to_66():
    """alpha.5.8.1: overall_mapping_status の合計は exactly 66"""
    counts = {}
    total = 0
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        total += 1
        ov = v.get("overall_mapping_status")
        assert ov, f"{svc}.{k} に overall_mapping_status が無い"
        counts[ov] = counts.get(ov, 0) + 1
    assert total == 66
    assert sum(counts.values()) == 66
    print(f"✅ test_alpha_5_8_1_overall_mapping_status_sums_to_66: {counts}")


def test_alpha_5_8_1_every_kasan_has_exactly_one_proposed_action():
    """alpha.5.8.1: 全 kasan が exactly 1 つの proposed_action を持つ（複数値を持たない）"""
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        three = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {})
        pa = three.get("proposed_action")
        # 必ず存在、文字列、空でない
        assert isinstance(pa, str) and pa, f"{svc}.{k} proposed_action invalid: {pa!r}"
        # legal な値のみ
        assert pa in {
            "keep_checked", "needs_master_review", "needs_legal_review",
            "keep_pattern_based_unverified", "future_candidate_only",
            "not_applicable_confirmed",
        }, f"{svc}.{k} proposed_action={pa!r}"
    print("✅ test_alpha_5_8_1_every_kasan_has_exactly_one_proposed_action")


def test_alpha_5_8_1_every_kasan_has_exactly_one_overall_mapping_status():
    """alpha.5.8.1: 全 kasan が exactly 1 つの overall_mapping_status を持つ"""
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        ov = v.get("overall_mapping_status")
        assert isinstance(ov, str) and ov, f"{svc}.{k} overall_mapping_status invalid: {ov!r}"
        assert ov in {
            "checked", "checked_official_but_detection_unverified",
            "pattern_based_unverified", "needs_review",
            "not_applicable", "provisional_future",
        }, f"{svc}.{k} overall_mapping_status={ov!r}"
    print("✅ test_alpha_5_8_1_every_kasan_has_exactly_one_overall_mapping_status")


def test_alpha_5_8_1_needs_master_review_count_equals_28():
    """alpha.5.8.1: needs_master_review が機械集計で exactly 28 件"""
    count = 0
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if pa == "needs_master_review":
            count += 1
    assert count == 28, f"needs_master_review={count} 想定28"
    print(f"✅ test_alpha_5_8_1_needs_master_review_count_equals_28: {count}")


def test_alpha_5_8_1_needs_master_review_service_breakdown_matches_global():
    """alpha.5.8.1: service別 needs_master_review の和が global に一致"""
    per_service = {svc: 0 for svc in ALPHA_5_8_1_SERVICES}
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if pa == "needs_master_review":
            per_service[svc] += 1
    global_count = sum(per_service.values())
    assert global_count == 28, f"global needs_master_review={global_count}"
    # alpha.5.8.1で確定した内訳: 訪看1・通所4・訪介7・居宅16
    assert per_service["houmon_kango_kaigo"] == 1, per_service
    assert per_service["tsusho_kaigo"] == 4, per_service
    assert per_service["houmon_kaigo"] == 7, per_service
    assert per_service["kyotaku_shien"] == 16, per_service
    print(f"✅ test_alpha_5_8_1_needs_master_review_service_breakdown_matches_global: {per_service}")


def test_alpha_5_8_1_needs_legal_review_breakdown():
    """alpha.5.8.1: needs_legal_review は houmon_kango_kaigo に 5 件のみ"""
    per_service = {svc: 0 for svc in ALPHA_5_8_1_SERVICES}
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if pa == "needs_legal_review":
            per_service[svc] += 1
    assert per_service["houmon_kango_kaigo"] == 5, per_service
    assert per_service["tsusho_kaigo"] == 0
    assert per_service["houmon_kaigo"] == 0
    assert per_service["kyotaku_shien"] == 0
    print(f"✅ test_alpha_5_8_1_needs_legal_review_breakdown: {per_service}")


def test_alpha_5_8_1_keep_checked_total_is_20():
    """alpha.5.8.1: keep_checked の合計は 20（service別: 訪看14・通所6）"""
    per_service = {svc: 0 for svc in ALPHA_5_8_1_SERVICES}
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if pa == "keep_checked":
            per_service[svc] += 1
    assert sum(per_service.values()) == 20
    assert per_service["houmon_kango_kaigo"] == 14
    assert per_service["tsusho_kaigo"] == 6
    assert per_service["houmon_kaigo"] == 0
    assert per_service["kyotaku_shien"] == 0
    print(f"✅ test_alpha_5_8_1_keep_checked_total_is_20: {per_service}")


def test_alpha_5_8_1_future_candidate_only_breakdown():
    """alpha.5.8.1: future_candidate_only は訪問介護・居宅介護支援の R8.6処遇改善のみ 2件"""
    items = []
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if pa == "future_candidate_only":
            items.append((svc, k))
    assert len(items) == 2, items
    services = {svc for svc, k in items}
    assert services == {"houmon_kaigo", "kyotaku_shien"}, services
    print(f"✅ test_alpha_5_8_1_future_candidate_only_breakdown: {items}")


def test_alpha_5_8_1_keep_pattern_based_unverified_count_is_10():
    """alpha.5.8.1: keep_pattern_based_unverified は exactly 10件"""
    count = 0
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if pa == "keep_pattern_based_unverified":
            count += 1
    assert count == 10, f"keep_pattern_based_unverified={count}"
    print(f"✅ test_alpha_5_8_1_keep_pattern_based_unverified_count_is_10: {count}")


def test_alpha_5_8_1_r8_6_2026_04_30_source_url_not_null():
    """alpha.5.8.1: WAM_R8_6_8_PROVISIONAL_2026_04_30 の source_url は null ではない"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_30"]
    assert s["source_url"], f"source_url is null: {s.get('source_url')!r}"
    assert s["source_url"].startswith("https://www.wam.go.jp/"), f"unexpected URL: {s['source_url']}"
    assert "20260416_004.pdf" in s["source_url"], "PDF filename mismatch"
    print(f"✅ test_alpha_5_8_1_r8_6_2026_04_30_source_url_not_null: {s['source_url']}")


def test_alpha_5_8_1_r8_6_2026_04_30_source_kind_provisional():
    """alpha.5.8.1: WAM_R8_6_8_PROVISIONAL_2026_04_30 は provisional のまま"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_30"]
    assert s["source_kind"] == "provisional", f"source_kind={s['source_kind']}"
    assert s["revision_status"] == "provisional_future", f"revision_status={s['revision_status']}"
    print("✅ test_alpha_5_8_1_r8_6_2026_04_30_source_kind_provisional")


def test_alpha_5_8_1_r8_6_2026_04_30_checked_promotion_not_allowed():
    """alpha.5.8.1: checked_promotion_allowed=false が明示化されている"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_30"]
    assert s.get("checked_promotion_allowed") is False, \
        f"checked_promotion_allowed={s.get('checked_promotion_allowed')!r}"
    assert s.get("audit_note") == "r8_6_8_provisional_future_not_used_for_checked"
    print("✅ test_alpha_5_8_1_r8_6_2026_04_30_checked_promotion_not_allowed")


def test_alpha_5_8_1_r8_6_2026_04_30_content_verified():
    """alpha.5.8.1: PDF実体検証済 (案表記あり)"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_30"]
    assert s.get("content_verified") is True, f"content_verified={s.get('content_verified')!r}"
    assert s.get("pdf_filename") == "20260416_004.pdf"
    cv = s.get("content_verification_keywords") or {}
    assert cv.get("案_in_first_page") is True, f"案 not verified in first page"
    assert s.get("relation_to_2026_04_20") == "same_pdf_under_new_parent_page"
    print("✅ test_alpha_5_8_1_r8_6_2026_04_30_content_verified")


def test_alpha_5_8_1_r8_6_not_returned_by_resolve_for_2026_06():
    """alpha.5.8.1: resolve_current_source_for_date は 2026-06-01 で None を返す（R8.6案を current にしない）"""
    for svc in ALPHA_5_8_1_SERVICES:
        s = resolve_current_source_for_date(svc, "2026-06-01")
        assert s is None, f"{svc}: 2026-06-01 で source 返却 (検出={s.get('source_id') if s else None})"
        s2 = resolve_current_source_for_date(svc, "2026-09-01")
        assert s2 is None, f"{svc}: 2026-09-01 で source 返却"
    print("✅ test_alpha_5_8_1_r8_6_not_returned_by_resolve_for_2026_06")


def test_alpha_5_8_1_future_candidate_items_are_not_checked():
    """alpha.5.8.1: future_candidate_only の kasan が overall_mapping_status=checked になっていない"""
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        ov = v.get("overall_mapping_status")
        if pa == "future_candidate_only":
            assert ov != "checked", f"{svc}.{k} future_candidate_only なのに overall=checked"
            scms = v.get("service_code_mapping_status")
            assert scms != "checked", f"{svc}.{k} future_candidate_only なのに service_code_mapping_status=checked"
    print("✅ test_alpha_5_8_1_future_candidate_items_are_not_checked")


def test_alpha_5_8_1_audit_version_in_master():
    """alpha.5.8.1: 4 master JSON の _meta.service_code_mapping_audit.audit_version が alpha.5.8.1"""
    for svc in ALPHA_5_8_1_SERVICES:
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        d = json.loads(m_path.read_text(encoding="utf-8"))
        audit = d.get("_meta", {}).get("service_code_mapping_audit") or {}
        assert audit.get("audit_version") == "alpha.5.8.1", \
            f"{svc} audit_version={audit.get('audit_version')}"
        # alpha.5.8.1 hotfix block の存在
        assert "alpha_5_8_1_audit_metadata_hotfix" in audit, \
            f"{svc} に alpha_5_8_1_audit_metadata_hotfix block がない"
    print("✅ test_alpha_5_8_1_audit_version_in_master")


def test_alpha_5_8_1_registry_version_bumped():
    """alpha.5.8.1: source registry _meta.registry_version が alpha.5.8.1"""
    registry = load_source_registry()
    assert registry["_meta"]["registry_version"] == "alpha.5.8.1", \
        f"registry_version={registry['_meta']['registry_version']}"
    assert "alpha_5_8_1_hotfix" in registry["_meta"]
    print("✅ test_alpha_5_8_1_registry_version_bumped")


def test_alpha_5_8_1_schema_version_bumped():
    """alpha.5.8.1: code_model_schema.json _meta.schema_version が alpha.5.8.1"""
    schema_path = PRODUCT_ROOT / "regulatory_master/sources/code_model_schema.json"
    sd = json.loads(schema_path.read_text(encoding="utf-8"))
    assert sd["_meta"]["schema_version"] == "alpha.5.8.1", \
        f"schema_version={sd['_meta']['schema_version']}"
    invariants = sd.get("alpha_5_8_1_invariants", {}).get("rules", [])
    assert len(invariants) >= 6, f"invariants count={len(invariants)}"
    print("✅ test_alpha_5_8_1_schema_version_bumped")


# ============================================================
# alpha.5.8.1 lightweight source metadata hotfix tests
# (crosswalk + keep_pattern_based_unverified 7+3 split)
# ============================================================


def test_alpha_5_8_1_crosswalk_proposed_action_to_overall():
    """alpha.5.8.1 crosswalk: proposed_action と overall_mapping_status の対応関係を確定値で固定"""
    from collections import Counter
    cross = Counter()
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        ov = v["overall_mapping_status"]
        pa = v["service_code_audit"]["alpha_5_8_three_layer_model"]["proposed_action"]
        cross[(pa, ov)] += 1
    expected = {
        ("keep_checked", "checked"): 20,
        ("not_applicable_confirmed", "not_applicable"): 1,
        ("needs_master_review", "needs_review"): 28,
        ("needs_legal_review", "needs_review"): 5,
        ("future_candidate_only", "pattern_based_unverified"): 2,
        ("keep_pattern_based_unverified", "pattern_based_unverified"): 7,
        ("keep_pattern_based_unverified", "needs_review"): 3,
    }
    for key, expected_count in expected.items():
        actual = cross.get(key, 0)
        assert actual == expected_count, \
            f"crosswalk mismatch: {key} expected={expected_count} actual={actual}"
    # 余計な組合せが無いこと
    assert set(cross.keys()) == set(expected.keys()), \
        f"unexpected crosswalk keys: {set(cross.keys()) - set(expected.keys())}"
    # 合計 66
    assert sum(cross.values()) == 66
    print(f"✅ test_alpha_5_8_1_crosswalk_proposed_action_to_overall: {dict(cross)}")


def test_alpha_5_8_1_keep_pattern_based_unverified_overall_split():
    """alpha.5.8.1: keep_pattern_based_unverified 10件のうち 7件 ov=pattern_based_unverified, 3件 ov=needs_review"""
    from collections import Counter
    ov_counter = Counter()
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        pa = v["service_code_audit"]["alpha_5_8_three_layer_model"]["proposed_action"]
        if pa == "keep_pattern_based_unverified":
            ov_counter[v["overall_mapping_status"]] += 1
    assert ov_counter.get("pattern_based_unverified", 0) == 7, \
        f"pattern_based_unverified={ov_counter.get('pattern_based_unverified')}"
    assert ov_counter.get("needs_review", 0) == 3, \
        f"needs_review={ov_counter.get('needs_review')}"
    assert sum(ov_counter.values()) == 10
    print(f"✅ test_alpha_5_8_1_keep_pattern_based_unverified_overall_split: {dict(ov_counter)}")


def test_alpha_5_8_1_divergent_kasans_have_audit_note():
    """alpha.5.8.1: keep_pattern_based_unverified ∧ ov=needs_review の3件に divergence_note が記録されている"""
    expected_kasans = {
        ("houmon_kango_kaigo", "shougu_kaizen_kasan_2026_06"),
        ("tsusho_kaigo", "adl_iji"),
        ("tsusho_kaigo", "ninchi_kasan"),
    }
    found = set()
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        tl = v["service_code_audit"]["alpha_5_8_three_layer_model"]
        pa = tl.get("proposed_action")
        ov = v.get("overall_mapping_status")
        if pa == "keep_pattern_based_unverified" and ov == "needs_review":
            found.add((svc, k))
            note = tl.get("alpha_5_8_1_proposed_overall_divergence_note")
            assert note, f"{svc}.{k} divergent だが note なし"
            assert note.get("overall_mapping_status") == "needs_review"
            assert note.get("proposed_action") == "keep_pattern_based_unverified"
            assert note.get("reason"), f"{svc}.{k} reason 空"
            assert note.get("overall_status_basis"), f"{svc}.{k} overall_status_basis 空"
            assert note.get("proposed_action_basis"), f"{svc}.{k} proposed_action_basis 空"
    assert found == expected_kasans, f"想定divergent={expected_kasans}, 実際={found}"
    print(f"✅ test_alpha_5_8_1_divergent_kasans_have_audit_note: {len(found)}件")


def test_alpha_5_8_1_non_divergent_kasans_have_no_divergence_note():
    """alpha.5.8.1: divergent でない kasan には divergence_note を付けない（誤情報防止）"""
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        tl = v["service_code_audit"]["alpha_5_8_three_layer_model"]
        pa = tl.get("proposed_action")
        ov = v.get("overall_mapping_status")
        is_divergent = (pa == "keep_pattern_based_unverified" and ov == "needs_review")
        has_note = "alpha_5_8_1_proposed_overall_divergence_note" in tl
        if not is_divergent:
            assert not has_note, f"{svc}.{k} non-divergent なのに divergence_note 付与"
    print("✅ test_alpha_5_8_1_non_divergent_kasans_have_no_divergence_note")


def test_alpha_5_8_1_source_metadata_hotfix_report_exists():
    """alpha.5.8.1: source_metadata_hotfix_report が存在し crosswalk セクションを含む"""
    rpt = PRODUCT_ROOT / "out/internal/alpha5_8_1_source_metadata_hotfix_report.md"
    assert rpt.exists(), f"hotfix report が見つからない: {rpt}"
    text = rpt.read_text(encoding="utf-8")
    # crosswalk セクション
    assert "crosswalk" in text.lower() or "クロスウォーク" in text or "対応関係" in text
    # 確定集計値が記載されている
    assert "keep_checked" in text and "20" in text
    assert "needs_master_review" in text and "28" in text
    assert "needs_legal_review" in text and "5" in text
    assert "keep_pattern_based_unverified" in text and "10" in text
    assert "future_candidate_only" in text and "2" in text
    assert "not_applicable_confirmed" in text and "1" in text
    # 7+3 split が記載されている
    assert "7" in text and "3" in text
    # checked 20件維持確認
    assert "20件" in text
    print("✅ test_alpha_5_8_1_source_metadata_hotfix_report_exists")


def test_alpha_5_8_1_release_pack_v53_unchanged():
    """alpha.5.8.1: alpha.5.3 公開リリースパックが変更されていない（git tracked content の path 確認のみ）"""
    pack = PRODUCT_ROOT / "releases/public/v2026.05.06-alpha.5.3"
    assert pack.exists(), f"alpha.5.3 release pack 不在: {pack}"
    manifest = pack / "RELEASE_MANIFEST.json"
    assert manifest.exists(), "RELEASE_MANIFEST.json 不在"
    # MANIFEST 内に alpha.5.8 / alpha.5.8.1 文字列が紛れ込んでいないこと
    text = manifest.read_text(encoding="utf-8")
    assert "alpha.5.8" not in text, f"alpha.5.3 MANIFEST に alpha.5.8 文字列が紛れた: {text[:200]}"
    print("✅ test_alpha_5_8_1_release_pack_v53_unchanged")


def test_alpha_5_8_1_release_pack_v54_unchanged():
    """alpha.5.8.1: alpha.5.4 公開リリースパックが変更されていない"""
    pack = PRODUCT_ROOT / "releases/public/v2026.05.06-alpha.5.4"
    assert pack.exists(), f"alpha.5.4 release pack 不在: {pack}"
    manifest = pack / "RELEASE_MANIFEST.json"
    assert manifest.exists()
    text = manifest.read_text(encoding="utf-8")
    assert "alpha.5.8" not in text, f"alpha.5.4 MANIFEST に alpha.5.8 文字列が紛れた"
    print("✅ test_alpha_5_8_1_release_pack_v54_unchanged")


def test_alpha_5_8_1_proposed_action_overall_no_invalid_combo():
    """alpha.5.8.1: 想定外の (proposed_action, overall_mapping_status) 組合せが存在しない"""
    valid_combos = {
        ("keep_checked", "checked"),
        ("not_applicable_confirmed", "not_applicable"),
        ("needs_master_review", "needs_review"),
        ("needs_legal_review", "needs_review"),
        ("future_candidate_only", "pattern_based_unverified"),
        ("keep_pattern_based_unverified", "pattern_based_unverified"),
        ("keep_pattern_based_unverified", "needs_review"),
    }
    for svc, k, v in _alpha_5_8_1_iter_kasans():
        ov = v["overall_mapping_status"]
        pa = v["service_code_audit"]["alpha_5_8_three_layer_model"]["proposed_action"]
        assert (pa, ov) in valid_combos, \
            f"{svc}.{k} 想定外combo: ({pa}, {ov})"
    print("✅ test_alpha_5_8_1_proposed_action_overall_no_invalid_combo")


def test_alpha_5_7_2_r7_4_is_historical_definitive():
    """alpha.5.7.2: R7.4 が historical_definitive に降格"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R7_4_DEFINITIVE_2025_03_28"]
    assert s["source_kind"] == "definitive"
    assert s["revision_status"] == "historical_definitive", \
        f"R7.4 revision_status={s['revision_status']} 想定 historical_definitive"
    assert s["effective_to"] == "2025-07-31"
    print("✅ test_alpha_5_7_2_r7_4_is_historical_definitive")


def test_alpha_5_7_2_r7_8_is_current_definitive():
    """alpha.5.7.2: R7.8 が current_definitive に昇格"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R7_8_DEFINITIVE_2025_03_28"]
    assert s["source_kind"] == "definitive"
    assert s["revision_status"] == "current_definitive", \
        f"R7.8 revision_status={s['revision_status']} 想定 current_definitive"
    assert s["effective_from"] == "2025-08-01"
    assert s["effective_to"] == "2026-05-31"
    # diff_from_r7_4 が記録されている
    diff = s.get("diff_from_r7_4_definitive") or {}
    assert "no_diff" in diff.get("houmon_kango_kaigo_kasan_lines", "")
    assert "no_diff" in diff.get("tsusho_kaigo_kasan_lines", "")
    print("✅ test_alpha_5_7_2_r7_8_is_current_definitive")


def test_resolve_current_source_for_date_r7_4_period():
    """2025-06-01 → R7.4 期間"""
    s = resolve_current_source_for_date("houmon_kango_kaigo", "2025-06-01")
    assert s is not None
    # R7.4 は historical_definitive、R7.8 は 2025-08 から有効なので、2025-06 では R7.4 のみ該当
    assert s["source_id"] == "WAM_R7_4_DEFINITIVE_2025_03_28", \
        f"2025-06-01 の current source は R7.4 のはず: got {s['source_id']}"
    print("✅ test_resolve_current_source_for_date_r7_4_period")


def test_resolve_current_source_for_date_r7_8_period():
    """2026-05-09 → R7.8 期間"""
    s = resolve_current_source_for_date("houmon_kango_kaigo", "2026-05-09")
    assert s is not None
    assert s["source_id"] == "WAM_R7_8_DEFINITIVE_2025_03_28", \
        f"2026-05-09 の current source は R7.8 のはず: got {s['source_id']}"
    assert s["revision_status"] == "current_definitive"
    print("✅ test_resolve_current_source_for_date_r7_8_period")


def test_resolve_current_source_for_date_r8_6_period_no_definitive():
    """2026-06-01 → R8.6 案は provisional のため None を返す"""
    s = resolve_current_source_for_date("houmon_kango_kaigo", "2026-06-01")
    # R8.6 案は provisional のため definitive として返されない
    # （R7.8 effective_to=2026-05-31 までなので 2026-06-01 は外れる）
    assert s is None or s.get("source_kind") == "definitive", \
        "provisional な source が返されている"
    if s is None:
        print("✅ test_resolve_current_source_for_date_r8_6_period_no_definitive (None returned as expected)")
    else:
        print(f"✅ test_resolve_current_source_for_date_r8_6_period_no_definitive (definitive returned: {s['source_id']})")


def test_r8_6_provisional_not_used_for_checked_promotion():
    """R8.6.1案は checked 昇格に使われない"""
    registry = load_source_registry()
    s = registry["sources"]["WAM_R8_6_8_PROVISIONAL_2026_04_20"]
    assert s["source_kind"] == "provisional"
    assert s["revision_status"] == "provisional_future"
    # 全マスタで WAM_R8_6_8 を source_id として参照する加算が checked 化されていない
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        m_path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        master = json.loads(m_path.read_text(encoding="utf-8"))
        for k, v in master.get("kasans", {}).items():
            audit = v.get("service_code_audit") or {}
            sid = audit.get("source_id")
            if sid == "WAM_R8_6_8_PROVISIONAL_2026_04_20":
                assert v.get("service_code_mapping_status") != "checked"
    print("✅ test_r8_6_provisional_not_used_for_checked_promotion")


def test_alpha_5_7_2_checked_20_reconfirmed_on_r7_8():
    """alpha.5.7.2: checked 20件が R7.8 で再確認されている"""
    # 訪問看護 14
    m = load_per_kasan_mapping_status("houmon_kango_kaigo")
    expected_houmon = [
        "tokubetsu_kanri_kasan_I", "tokubetsu_kanri_kasan_II",
        "kango_taisei_kyouka_kasan_I", "kango_taisei_kyouka_kasan_II",
        "service_taisei_kyouka_kasan_I", "service_taisei_kyouka_kasan_II",
        "taiin_kyoudou_shidou_kasan", "kango_kaigo_renkei_kyouka_kasan",
        "kinkyu_houmon_kango_kasan_I", "kinkyu_houmon_kango_kasan_II",
        "terminal_care_kasan", "shokai_kasan_I", "shokai_kasan_II",
        "koukuu_renkei_kyouka_kasan",
    ]
    for k in expected_houmon:
        audit = m[k]["audit"]
        rec = audit.get("alpha_5_7_2_r7_8_current_definitive_reconfirmed") or {}
        assert rec.get("source_id") == "WAM_R7_8_DEFINITIVE_2025_03_28", \
            f"houmon_kango/{k}: R7.8 reconfirm 未記録"
        assert rec.get("revision_status") == "current_definitive"
        assert "no_diff" in rec.get("diff_from_r7_4", "")
    # 通所介護 6
    m = load_per_kasan_mapping_status("tsusho_kaigo")
    checked_count = 0
    for k, v in m.items():
        if v["status"] == "checked":
            audit = v["audit"]
            rec = audit.get("alpha_5_7_2_r7_8_current_definitive_reconfirmed") or {}
            assert rec.get("source_id") == "WAM_R7_8_DEFINITIVE_2025_03_28"
            checked_count += 1
    assert checked_count == 6, f"tsusho_kaigo checked={checked_count} 想定6"
    print("✅ test_alpha_5_7_2_checked_20_reconfirmed_on_r7_8")


def test_alpha_5_7_1_source_anchor_correction_recorded():
    """alpha.5.7.1: 訂正済み加算に alpha_5_7_1_source_anchor_corrected_to_r7_4_definitive が記録"""
    # tsusho_kaigo の checked 加算で訂正記録を確認
    m_path = PRODUCT_ROOT / "regulatory_master/kaigo/tsusho_kaigo.json"
    master = json.loads(m_path.read_text(encoding="utf-8"))
    corrected_count = 0
    for k, v in master.get("kasans", {}).items():
        audit = v.get("service_code_audit") or {}
        if audit.get("source_id") == "WAM_R7_4_DEFINITIVE_2025_03_28":
            corr = audit.get("alpha_5_7_1_source_anchor_corrected_to_r7_4_definitive")
            if corr:
                corrected_count += 1
                assert corr.get("diff_from_previous_pdf") == "no_diff (PDF contents identical for 訪問看護21 + 通所介護29 加算行)" or "no_diff" in corr.get("diff_from_previous_pdf", "")
    assert corrected_count >= 13, f"tsusho_kaigo 訂正記録が十分でない: {corrected_count}"
    print("✅ test_alpha_5_7_1_source_anchor_correction_recorded")


def test_houmon_kango_kaigo_14_checked_maintained():
    """alpha.5.7: alpha.5.6 の訪問看護 14 checked が維持されている"""
    m = load_per_kasan_mapping_status("houmon_kango_kaigo")
    expected_checked = [
        "tokubetsu_kanri_kasan_I", "tokubetsu_kanri_kasan_II",
        "kango_taisei_kyouka_kasan_I", "kango_taisei_kyouka_kasan_II",
        "service_taisei_kyouka_kasan_I", "service_taisei_kyouka_kasan_II",
        "taiin_kyoudou_shidou_kasan", "kango_kaigo_renkei_kyouka_kasan",
        "kinkyu_houmon_kango_kasan_I", "kinkyu_houmon_kango_kasan_II",
        "terminal_care_kasan", "shokai_kasan_I", "shokai_kasan_II",
        "koukuu_renkei_kyouka_kasan",
    ]
    for k in expected_checked:
        assert m[k]["status"] == "checked", f"{k}: {m[k]['status']} （alpha.5.7で維持されるべき）"
    # R7.4 reconfirm が記録されている
    audit = m["tokubetsu_kanri_kasan_I"]["audit"]
    assert audit.get("alpha_5_7_r7_4_reconfirm"), "R7.4 reconfirm 未記録"
    print("✅ test_houmon_kango_kaigo_14_checked_maintained")


def test_tsusho_kaigo_6_checked_alpha_5_7():
    """alpha.5.7: tsusho_kaigo で6加算が exact_match → checked"""
    m = load_per_kasan_mapping_status("tsusho_kaigo")
    expected_checked = [
        "kobetsu_kinou_I_i", "kobetsu_kinou_I_ro", "kobetsu_kinou_II_life",
        "nyuyoku_I", "kagakuteki_kaigo", "eiyou_assessment",
    ]
    checked_in_master = [k for k, v in m.items() if v["status"] == "checked"]
    assert len(checked_in_master) == 6, f"checked数={len(checked_in_master)} 想定6"
    for k in expected_checked:
        if k in checked_in_master:
            audit = m[k]["audit"]
            # alpha.5.7.1 hotfix で source_id が 2025-03-28 確定版に訂正
            assert audit.get("source_id") == "WAM_R7_4_DEFINITIVE_2025_03_28", \
                f"{k}: source_id={audit.get('source_id')}（alpha.5.7.1 で確定版に訂正済み想定）"
            assert audit.get("match_type") == "exact_match"
    print("✅ test_tsusho_kaigo_6_checked_alpha_5_7")


def test_houmon_kaigo_no_checked_alpha_5_7():
    """alpha.5.7: houmon_kaigo は社内コード体系不整合のため全件 pattern_unverified"""
    m = load_per_kasan_mapping_status("houmon_kaigo")
    checked_count = sum(1 for v in m.values() if v["status"] == "checked")
    assert checked_count == 0, f"houmon_kaigo checked={checked_count} 想定0"
    # audit に code_mismatch または not_found が記録されている
    has_mismatch = any(v["audit"].get("match_type") in ("code_mismatch", "not_found")
                       for v in m.values())
    assert has_mismatch, "code_mismatch/not_found 記録なし"
    print("✅ test_houmon_kaigo_no_checked_alpha_5_7")


def test_kyotaku_shien_no_checked_alpha_5_7():
    """alpha.5.7: kyotaku_shien も社内コード体系不整合のため全件 pattern_unverified"""
    m = load_per_kasan_mapping_status("kyotaku_shien")
    checked_count = sum(1 for v in m.values() if v["status"] == "checked")
    assert checked_count == 0, f"kyotaku_shien checked={checked_count} 想定0"
    print("✅ test_kyotaku_shien_no_checked_alpha_5_7")


def test_alpha_5_6_audit_report_exists():
    """alpha.5.6 audit report が out/internal/ に存在する"""
    audit_report = PRODUCT_ROOT / "out/internal/alpha5_6_mapping_audit_report.md"
    assert audit_report.exists(), "alpha.5.6 audit report ファイルが見つからない"
    text = audit_report.read_text(encoding="utf-8")
    # 主要キーワードの存在を確認
    assert "definitive" in text
    assert "provisional" in text
    assert "alpha.5.5" in text
    assert "alpha.5.6" in text
    assert "緊急時訪問看護加算" in text or "緊急時" in text
    assert "ターミナルケア加算" in text
    print("✅ test_alpha_5_6_audit_report_exists")


if __name__ == "__main__":
    test_load_per_kasan_mapping_houmon_kango_kaigo()
    test_load_per_kasan_mapping_other_services()
    test_summarize_mapping_status_breakdown()
    test_dsl_with_kasan_checked_status_clears_mapping_warning()
    test_dsl_with_kasan_pattern_unverified_blocks_mapping_dependent()
    test_dsl_kasan_not_applicable_via_applicability()
    test_dsl_source_required_not_force_clear()
    test_judge_kasan_includes_mapping_status_in_report()
    test_alpha54_release_pack_not_modified()
    test_audit_metadata_in_master()
    # alpha.5.6 で追加
    test_alpha_5_5_revalidation_summary_in_master()
    test_provisional_source_not_used_for_definitive_check()
    test_alpha_5_6_audit_report_exists()
    # alpha.5.7 で追加
    test_source_registry_exists()
    test_provisional_future_does_not_promote_to_checked()
    test_houmon_kango_kaigo_14_checked_maintained()
    test_tsusho_kaigo_6_checked_alpha_5_7()
    test_houmon_kaigo_no_checked_alpha_5_7()
    test_kyotaku_shien_no_checked_alpha_5_7()
    # alpha.5.7.1 で追加
    test_old_source_id_not_definitive()
    test_parent_page_provisional_marker_demoted()
    test_alpha_5_7_1_source_anchor_correction_recorded()
    # alpha.5.7.2 で追加
    test_alpha_5_7_2_r7_4_is_historical_definitive()
    test_alpha_5_7_2_r7_8_is_current_definitive()
    test_resolve_current_source_for_date_r7_4_period()
    test_resolve_current_source_for_date_r7_8_period()
    test_resolve_current_source_for_date_r8_6_period_no_definitive()
    test_r8_6_provisional_not_used_for_checked_promotion()
    test_alpha_5_7_2_checked_20_reconfirmed_on_r7_8()
    # alpha.5.8 で追加
    test_alpha_5_8_three_layer_schema_exists()
    test_alpha_5_8_three_layer_in_master()
    test_alpha_5_8_checked_20_maintained()
    test_alpha_5_8_legacy_detection_does_not_promote_to_checked()
    test_alpha_5_8_r8_6_2026_04_30_provisional_future()
    test_alpha_5_8_proposed_action_covers_45_unresolved()
    print("\nAll mapping_status tests passed.")
