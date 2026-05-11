"""alpha.5.13 review workload reducer tests.

initial batch / safe defaults / deferred items の整合性と不変条件を保護する。
"""
from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2].parent
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"
REDUCER_DIR = PRODUCT_ROOT / "out" / "internal" / "alpha5_13_review_workload_reducer"
ALPHA_5_12_HANDOFF_COMMIT = "228897a415aa8b2ff9a0d0a0b96723901a995266"
GENERATOR = PRODUCT_ROOT / "scripts" / "generate_alpha5_13_review_workload_reducer.py"


def _read_data_rows(csv_path: Path) -> list[dict]:
    if not csv_path.exists():
        return []
    with open(csv_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [r for r in reader if r.get("service") and not r.get("service", "").startswith("#")]


def _read_manifest() -> dict:
    p = REDUCER_DIR / "alpha5_13_review_workload_reducer_manifest.json"
    return json.loads(p.read_text(encoding="utf-8"))


def _iter_master_kasans():
    services = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
    for svc in services:
        path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        for k, v in (d.get("kasans") or {}).items():
            yield svc, k, v


# ============================================================
# 1. パケット構造
# ============================================================

def test_alpha_5_13_output_directory_exists():
    assert REDUCER_DIR.exists() and REDUCER_DIR.is_dir()
    expected = {
        "README.md",
        "CIO_30MIN_DECISION_BRIEF.md",
        "REVIEW_PRIORITY_MATRIX.csv",
        "FIRST_REVIEW_BATCH.csv",
        "REVIEW_WORKLOAD_BY_ROLE.md",
        "SAFE_DEFAULT_DECISIONS.md",
        "DEFERRED_ITEMS.md",
        "alpha5_13_review_workload_reducer_manifest.json",
    }
    found = {p.name for p in REDUCER_DIR.iterdir() if p.is_file()}
    missing = expected - found
    assert not missing, f"missing: {missing}"
    print(f"✅ test_alpha_5_13_output_directory_exists: {len(found)} files")


def test_alpha_5_13_manifest_json_is_valid():
    m = _read_manifest()
    for key in (
        "version", "base_commit", "total_review_rows",
        "first_batch_max_rows", "first_batch_actual_rows",
        "cio_expected_time_minutes",
        "public_release", "master_auto_update", "checked_promotion",
        "r8_provisional_used_for_checked", "release_pack_modified",
        "deferred_legal_required", "deferred_wait_r8_definitive",
        "deferred_divergent", "deferred_low_priority",
        "deferred_per_service_cap_exceeded",
    ):
        assert key in m, f"manifest missing: {key}"
    assert m["version"] == "alpha.5.13"
    assert m["public_release"] is False
    assert m["master_auto_update"] is False
    assert m["checked_promotion"] is False
    assert m["r8_provisional_used_for_checked"] is False
    assert m["release_pack_modified"] is False
    print("✅ test_alpha_5_13_manifest_json_is_valid")


def test_alpha_5_13_base_commit_equals_kimura_handoff_commit():
    m = _read_manifest()
    assert m["base_commit"] == ALPHA_5_12_HANDOFF_COMMIT
    print("✅ test_alpha_5_13_base_commit_equals_kimura_handoff_commit")


# ============================================================
# 2. CIO brief
# ============================================================

def test_alpha_5_13_cio_brief_exists():
    p = REDUCER_DIR / "CIO_30MIN_DECISION_BRIEF.md"
    assert p.exists()
    text = p.read_text(encoding="utf-8")
    # 30 分というキーワードが入っていること
    assert "30 分" in text or "30分" in text
    # 4 つの決裁項目という言葉が含まれること
    assert ("4" in text or "４") and ("決裁" in text or "決定" in text)
    print("✅ test_alpha_5_13_cio_brief_exists")


def test_alpha_5_13_cio_expected_time_is_30min_or_less():
    m = _read_manifest()
    assert m["cio_expected_time_minutes"] <= 30, f"CIO 時間={m['cio_expected_time_minutes']}"
    print(f"✅ test_alpha_5_13_cio_expected_time_is_30min_or_less: {m['cio_expected_time_minutes']}")


# ============================================================
# 3. priority matrix / first batch
# ============================================================

def test_alpha_5_13_priority_matrix_has_38_rows():
    rows = _read_data_rows(REDUCER_DIR / "REVIEW_PRIORITY_MATRIX.csv")
    assert len(rows) == 38, f"priority matrix rows={len(rows)}"
    print(f"✅ test_alpha_5_13_priority_matrix_has_38_rows")


def test_alpha_5_13_first_review_batch_has_5_to_10_rows():
    rows = _read_data_rows(REDUCER_DIR / "FIRST_REVIEW_BATCH.csv")
    assert 5 <= len(rows) <= 10, f"first batch rows={len(rows)} 想定 5〜10"
    print(f"✅ test_alpha_5_13_first_review_batch_has_5_to_10_rows: {len(rows)}")


def test_alpha_5_13_first_batch_contains_no_needs_legal_review():
    """needs_legal_review 5 件は初回バッチに含まれない"""
    rows = _read_data_rows(REDUCER_DIR / "FIRST_REVIEW_BATCH.csv")
    for r in rows:
        assert r["review_bucket"] != "needs_legal_review", \
            f"{r['kasan_key']} が legal_review として first_batch に混入"
    print("✅ test_alpha_5_13_first_batch_contains_no_needs_legal_review")


def test_alpha_5_13_first_batch_contains_no_future_candidate_only():
    rows = _read_data_rows(REDUCER_DIR / "FIRST_REVIEW_BATCH.csv")
    for r in rows:
        assert r["review_bucket"] != "future_candidate_only", \
            f"{r['kasan_key']} が future_candidate として first_batch に混入"
    print("✅ test_alpha_5_13_first_batch_contains_no_future_candidate_only")


def test_alpha_5_13_first_batch_contains_no_high_risk_item():
    """correct_internal_legacy_code (高リスク) は初回バッチに含まれない"""
    rows = _read_data_rows(REDUCER_DIR / "FIRST_REVIEW_BATCH.csv")
    for r in rows:
        assert r["risk_level"] != "high", \
            f"{r['kasan_key']} が high_risk として first_batch に混入"
        assert r["recommended_initial_decision"] != "correct_internal_legacy_code", \
            f"{r['kasan_key']} の decision が correct_internal_legacy_code"
    print("✅ test_alpha_5_13_first_batch_contains_no_high_risk_item")


def test_alpha_5_13_first_batch_contains_no_divergent():
    """divergent 3 件は初回バッチに含まれない (原則)"""
    rows = _read_data_rows(REDUCER_DIR / "FIRST_REVIEW_BATCH.csv")
    for r in rows:
        assert r["review_bucket"] != "divergent", \
            f"{r['kasan_key']} が divergent として first_batch に混入"
    print("✅ test_alpha_5_13_first_batch_contains_no_divergent")


# ============================================================
# 4. safe defaults
# ============================================================

def test_alpha_5_13_safe_defaults_include_defer_until_r8_definitive():
    p = REDUCER_DIR / "SAFE_DEFAULT_DECISIONS.md"
    text = p.read_text(encoding="utf-8")
    assert "defer_until_r8_definitive" in text
    assert "future_candidate_only" in text
    print("✅ test_alpha_5_13_safe_defaults_include_defer_until_r8_definitive")


def test_alpha_5_13_safe_defaults_include_escalate_legal_review():
    p = REDUCER_DIR / "SAFE_DEFAULT_DECISIONS.md"
    text = p.read_text(encoding="utf-8")
    assert "escalate_legal_review" in text
    assert "needs_legal_review" in text
    print("✅ test_alpha_5_13_safe_defaults_include_escalate_legal_review")


# ============================================================
# 5. implementation_allowed=yes が自動付与されていないこと
# ============================================================

def test_alpha_5_13_no_item_has_implementation_allowed_yes():
    """priority matrix / first batch のどの行にも implementation_allowed=yes が含まれない"""
    for csv_name in ("REVIEW_PRIORITY_MATRIX.csv", "FIRST_REVIEW_BATCH.csv"):
        p = REDUCER_DIR / csv_name
        with open(p, encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            header = next(reader)
        # implementation_allowed という列名自体が無いこと
        assert "implementation_allowed" not in header, \
            f"{csv_name} に implementation_allowed 列が存在する"
    # CIO_30MIN_DECISION_BRIEF と SAFE_DEFAULT_DECISIONS にも
    # "implementation_allowed=yes" という claim が無いこと
    for md_name in ("CIO_30MIN_DECISION_BRIEF.md", "SAFE_DEFAULT_DECISIONS.md", "DEFERRED_ITEMS.md"):
        p = REDUCER_DIR / md_name
        text = p.read_text(encoding="utf-8")
        # "implementation_allowed=yes は本パケットでは付けない" のような meta 言及は許容
        # 各行で "implementation_allowed=yes" が単独で claim 文脈にないか
        for line in text.split("\n"):
            if "implementation_allowed=yes" in line:
                # meta marker でなければ NG
                meta_markers = ["自動で付けない", "自動付与しない", "付与されていない",
                                 "**6 必須フィールド全揃い**", "リスク認識した上で",
                                 "確認した上で", "事前に必須"]
                if not any(m in line for m in meta_markers):
                    raise AssertionError(
                        f"{md_name} の行に claim 文脈で implementation_allowed=yes\n  line: {line[:200]}")
    print("✅ test_alpha_5_13_no_item_has_implementation_allowed_yes")


# ============================================================
# 6. 不変条件
# ============================================================

def test_alpha_5_13_master_json_is_not_modified():
    """alpha.5.13 generator は master JSON を改変しない"""
    import hashlib
    services = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
    before = {svc: hashlib.md5((PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json").read_bytes()).hexdigest()
              for svc in services}
    res = subprocess.run([sys.executable, str(GENERATOR)],
                          cwd=PRODUCT_ROOT, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    after = {svc: hashlib.md5((PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json").read_bytes()).hexdigest()
             for svc in services}
    assert before == after, "master JSON が改変された"
    print("✅ test_alpha_5_13_master_json_is_not_modified")


def test_alpha_5_13_checked_20_unchanged():
    counter = {}
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") == "checked":
            counter[svc] = counter.get(svc, 0) + 1
    assert counter.get("houmon_kango_kaigo", 0) == 14, counter
    assert counter.get("tsusho_kaigo", 0) == 6, counter
    assert sum(counter.values()) == 20, counter
    print(f"✅ test_alpha_5_13_checked_20_unchanged: {sum(counter.values())}")


def test_alpha_5_13_public_release_pack_is_not_modified():
    for v in ("v2026.05.06-alpha.5.3", "v2026.05.06-alpha.5.4"):
        rp = PRODUCT_ROOT / "releases" / "public" / v
        assert rp.exists()
        for f in rp.iterdir():
            if not f.is_file():
                continue
            text = f.read_text(encoding="utf-8", errors="ignore") if f.suffix in (".md", ".json", ".txt") else ""
            assert "alpha.5.13" not in text, f"release pack {v}/{f.name} に alpha.5.13 文字列"
    print("✅ test_alpha_5_13_public_release_pack_is_not_modified")


def test_alpha_5_13_r8_6_provisional_not_used_for_checked():
    r8 = {"WAM_R8_6_8_PROVISIONAL_2026_04_30", "WAM_R8_6_8_PROVISIONAL_2026_04_20"}
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") != "checked":
            continue
        sid = ((v.get("service_code_audit") or {})
               .get("alpha_5_8_three_layer_model") or {}).get("official_code_model", {}).get("source_id")
        assert sid not in r8, f"{svc}.{k} が R8.6案 source を使っている"
    print("✅ test_alpha_5_13_r8_6_provisional_not_used_for_checked")


def test_alpha_5_13_output_is_under_out_internal_only():
    rel = REDUCER_DIR.relative_to(PRODUCT_ROOT)
    assert rel.parts[:2] == ("out", "internal"), \
        f"alpha.5.13 packet が internal 配下にない: {rel}"
    # public 配下に alpha.5.13 ファイルがないこと
    public_root = PRODUCT_ROOT / "releases" / "public"
    if public_root.exists():
        for f in public_root.rglob("*"):
            if f.is_file():
                assert "alpha5_13" not in f.name and "alpha.5.13" not in f.name, \
                    f"public 配下に alpha.5.13 ファイル: {f}"
    print("✅ test_alpha_5_13_output_is_under_out_internal_only")


# ============================================================
# 7. 上流 packet 不変
# ============================================================

def test_alpha_5_13_upstream_packets_not_destroyed():
    """alpha.5.9 / 5.10 / 5.11 / 5.12 / 5.12 handoff のファイルが破壊されていない"""
    paths_and_expected = [
        (PRODUCT_ROOT / "out" / "internal" / "alpha5_9_master_review_packet", {
            "README.md", "master_review_summary.md",
            "needs_master_review_matrix.csv", "needs_legal_review_matrix.csv",
            "divergent_mapping_review.md", "future_candidate_review.md",
            "reviewer_decision_template.csv",
            "alpha5_9_master_review_packet_manifest.json",
        }),
        (PRODUCT_ROOT / "out" / "internal" / "alpha5_10_reviewer_decision_gate", {
            "README.md", "decision_validation_report.md",
            "approved_changes_preview.csv", "approved_changes_preview.json",
            "blocked_or_incomplete_decisions.csv", "pending_decisions.csv",
            "legal_review_required.csv",
            "alpha5_10_reviewer_decision_gate_manifest.json",
        }),
        (PRODUCT_ROOT / "out" / "internal" / "alpha5_11_reviewer_handoff_workbook", {
            "README.md", "reviewer_handoff_guide.md",
            "alpha5_11_reviewer_decision_workbook.xlsx",
            "reviewer_decision_export_template.csv",
            "workbook_export_instructions.md",
            "alpha5_11_reviewer_handoff_manifest.json",
        }),
        (PRODUCT_ROOT / "out" / "internal" / "alpha5_12_reviewer_workflow_hardening", {
            "README.md", "alpha5_12_reviewer_decision_workbook.xlsx",
            "sample_reviewed_decisions.csv",
            "sample_reviewed_decision_validation_report.md",
            "sample_approved_changes_preview.csv",
            "sample_blocked_or_incomplete_decisions.csv",
            "sample_pending_decisions.csv",
            "sample_legal_review_required.csv",
            "legal_clearance_rules.md",
            "alpha5_12_reviewer_workflow_hardening_manifest.json",
        }),
        (PRODUCT_ROOT / "out" / "internal" / "alpha5_12_kimura_cio_handoff", {
            "README.md", "EXECUTIVE_SUMMARY_FOR_KIMURA.md",
            "WHAT_CHANGED_SINCE_ALPHA5_4.md", "REVIEW_WORKFLOW_GUIDE.md",
            "REVIEWER_ASSIGNMENT_TEMPLATE.csv", "NEXT_ACTIONS_FOR_KIMURA.md",
            "RISKS_AND_GUARDRAILS.md",
            "alpha5_12_kimura_cio_handoff_manifest.json",
        }),
    ]
    for path, expected in paths_and_expected:
        assert path.exists(), f"upstream packet 不在: {path.name}"
        found = {p.name for p in path.iterdir() if p.is_file()}
        missing = expected - found
        assert not missing, f"{path.name} 破壊: missing {missing}"
    print("✅ test_alpha_5_13_upstream_packets_not_destroyed")


# ============================================================
# 8. 安全表現スキャン
# ============================================================

def test_alpha_5_13_safe_expressions():
    """禁止語・過剰表現が claim 文脈で出ていないこと"""
    hard_forbidden = [
        "1367197775", "1371802743", "1371802982",
        "ホットステーションSUN",
        "サ責A", "サ責B", "サ責C", "サ責D",
        "専務", "事務長", "506万円",
        "skills/regulatory",
        "DEMO fixture",
        "tenant_data/demo_",
        "社内資料",
    ]
    soft_forbidden = [
        "算定可否を保証します", "算定を保証", "算定可能と保証",
        "公式コード完全照合済", "完全照合済",
        "R8対応済", "R8.6対応済", "R8.6.1対応済",
    ]
    meta_markers = [
        "❌", "禁止", "出さない", "とは表現していない", "とは表現しない",
        "NG表現", "使わない", "言わない", "断定しない", "保証しない",
        "等の表現", "等の過剰表現", "の表現を出さない",
        "出していません", "使っていない",
    ]
    for f in REDUCER_DIR.iterdir():
        if not f.is_file() or f.suffix not in (".md", ".csv", ".json"):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        for w in hard_forbidden:
            assert w not in text, f"{f.name} に強禁止語: {w}"
        for line in text.split("\n"):
            for w in soft_forbidden:
                if w in line and not any(m in line for m in meta_markers):
                    raise AssertionError(
                        f"{f.name} の行に claim 文脈で禁止語: {w!r}\n  line: {line[:200]}")
    print("✅ test_alpha_5_13_safe_expressions")
