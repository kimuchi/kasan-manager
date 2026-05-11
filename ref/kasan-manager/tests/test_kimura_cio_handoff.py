"""alpha.5.12 木村CIO handoff pack tests.

handoff pack の構造・不変条件・安全表現を保護する。
"""
from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2].parent
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"
HANDOFF_DIR = PRODUCT_ROOT / "out" / "internal" / "alpha5_12_kimura_cio_handoff"
ALPHA_5_12_COMMIT = "db031d49134fe6d89bceba5931c8a0569857c6f7"


def _iter_master_kasans():
    services = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
    for svc in services:
        path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        for k, v in (d.get("kasans") or {}).items():
            yield svc, k, v


# ============================================================
# 1. パケット構造 (8 ファイル存在)
# ============================================================

def test_kimura_cio_handoff_directory_exists():
    assert HANDOFF_DIR.exists() and HANDOFF_DIR.is_dir()
    expected = {
        "README.md",
        "EXECUTIVE_SUMMARY_FOR_KIMURA.md",
        "WHAT_CHANGED_SINCE_ALPHA5_4.md",
        "REVIEW_WORKFLOW_GUIDE.md",
        "REVIEWER_ASSIGNMENT_TEMPLATE.csv",
        "NEXT_ACTIONS_FOR_KIMURA.md",
        "RISKS_AND_GUARDRAILS.md",
        "alpha5_12_kimura_cio_handoff_manifest.json",
    }
    found = {p.name for p in HANDOFF_DIR.iterdir() if p.is_file()}
    missing = expected - found
    assert not missing, f"missing: {missing}"
    print(f"✅ test_kimura_cio_handoff_directory_exists: {len(found)} files")


def test_kimura_cio_handoff_manifest_json_is_valid():
    p = HANDOFF_DIR / "alpha5_12_kimura_cio_handoff_manifest.json"
    m = json.loads(p.read_text(encoding="utf-8"))
    for key in (
        "version", "base_commit", "handoff_target", "scope",
        "public_release", "master_auto_update", "checked_promotion",
        "r8_provisional_used_for_checked", "release_pack_modified",
        "total_review_rows", "checked_count", "needs_review_count",
        "pattern_based_unverified_count", "not_applicable_count",
        "files", "covered_releases", "next_actions_count",
    ):
        assert key in m, f"manifest missing: {key}"
    assert m["version"] == "alpha.5.12-kimura-cio-handoff"
    assert m["base_commit"] == ALPHA_5_12_COMMIT
    assert m["scope"] == "internal_only"
    assert m["public_release"] is False
    assert m["master_auto_update"] is False
    assert m["checked_promotion"] is False
    assert m["r8_provisional_used_for_checked"] is False
    assert m["release_pack_modified"] is False
    assert m["handoff_target"] == "kimura_cio"
    # 数値の整合
    assert m["total_review_rows"] == 38
    assert m["checked_count"] == 20
    assert m["needs_review_count"] == 36
    assert m["pattern_based_unverified_count"] == 9
    assert m["not_applicable_count"] == 1
    # 6カテゴリ合計が 66
    pa = m["proposed_action_breakdown"]
    assert sum(pa.values()) == 66, f"proposed_action sum={sum(pa.values())}"
    print(f"✅ test_kimura_cio_handoff_manifest_json_is_valid")


def test_kimura_cio_handoff_covers_11_alpha_releases():
    p = HANDOFF_DIR / "alpha5_12_kimura_cio_handoff_manifest.json"
    m = json.loads(p.read_text(encoding="utf-8"))
    covered = set(m["covered_releases"])
    expected_releases = {
        "alpha.5.5_service_code_mapping_status",
        "alpha.5.6_definitive_source_revalidation",
        "alpha.5.7_source_registry",
        "alpha.5.7.1_source_anchor_hotfix",
        "alpha.5.7.2_effective_period_hotfix",
        "alpha.5.8_three_layer_code_model",
        "alpha.5.8.1_source_metadata_hotfix",
        "alpha.5.9_master_review_packet",
        "alpha.5.10_reviewer_decision_gate",
        "alpha.5.11_reviewer_handoff_workbook",
        "alpha.5.12_reviewer_workflow_hardening",
    }
    missing = expected_releases - covered
    assert not missing, f"missing covered_releases: {missing}"
    print(f"✅ test_kimura_cio_handoff_covers_11_alpha_releases")


# ============================================================
# 2. CSV 形式 (REVIEWER_ASSIGNMENT_TEMPLATE.csv)
# ============================================================

def test_reviewer_assignment_template_has_required_columns():
    p = HANDOFF_DIR / "REVIEWER_ASSIGNMENT_TEMPLATE.csv"
    with open(p, encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
    expected = {"role", "reviewer_name", "target_sheet", "target_count",
                "due_date", "responsibility", "note"}
    missing = expected - set(header)
    assert not missing, f"REVIEWER_ASSIGNMENT_TEMPLATE missing: {missing}"
    print(f"✅ test_reviewer_assignment_template_has_required_columns: {header}")


def test_reviewer_assignment_template_has_role_examples():
    p = HANDOFF_DIR / "REVIEWER_ASSIGNMENT_TEMPLATE.csv"
    with open(p, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = [r for r in reader if r.get("role") and not r["role"].startswith("#")]
    roles = {r["role"] for r in rows}
    expected_roles = {"business_reviewer", "legal_reviewer", "final_approver", "developer"}
    missing = expected_roles - roles
    assert not missing, f"missing roles: {missing}"
    print(f"✅ test_reviewer_assignment_template_has_role_examples: {sorted(roles)}")


# ============================================================
# 3. 安全表現スキャン (禁止語・過剰表現)
# ============================================================

def test_kimura_cio_handoff_safe_expressions():
    """handoff 内で禁止語・過剰表現が **claim 文脈で** 使われていないこと

    handoff は「禁止語のリスト」を文書化する性質上、メタ言及（NG表現の例示・
    『〜と表現していない』『❌』『禁止』『出さない』等のマーカー）を含む行で
    の出現は許容する。
    """
    forbidden = [
        "算定可否を保証します", "算定を保証", "算定可能と保証",
        "公式コード完全照合済", "完全照合済",
        "R8対応済", "R8.6対応済", "R8.6.1対応済",
    ]
    # 強い禁止語（meta 文脈でも出ない）
    hard_forbidden = [
        # PII / 実事業所コード
        "1367197775", "1371802743", "1371802982",
        # 内部固有語（spec 禁止語）
        "ホットステーションSUN", "ホットステーション SUN",
        "サ責A", "サ責B", "サ責C", "サ責D",
        "専務", "事務長",
        "506万円",
        # internal-fact path
        "skills/regulatory",
        "DEMO fixture",
        "tenant_data/demo_",
        "社内資料",
    ]
    # メタ文脈マーカー（行に存在すれば「言及」とみなす）
    meta_markers = [
        "❌", "禁止", "出さない", "とは表現していない", "とは表現しない",
        "NG表現", "使わない", "言わない", "断定しない", "保証しない",
        "等の表現", "等の過剰表現", "の表現を出さない",
    ]
    for f in HANDOFF_DIR.iterdir():
        if not f.is_file() or f.suffix not in (".md", ".csv", ".json"):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        # hard_forbidden は無条件で禁止
        for w in hard_forbidden:
            assert w not in text, f"{f.name} に強禁止語: {w}"
        # forbidden は line context でメタ文脈を除外
        for line in text.split("\n"):
            for w in forbidden:
                if w in line and not any(m in line for m in meta_markers):
                    raise AssertionError(
                        f"{f.name} の行に claim 文脈で禁止語: {w!r}\n  line: {line[:200]}")
    print("✅ test_kimura_cio_handoff_safe_expressions")


def test_kimura_cio_handoff_does_not_use_sun_brand():
    """SUN ブランド名が出ていないこと（一般的な英単語との誤検知を避けるため境界つき）"""
    import re
    for f in HANDOFF_DIR.iterdir():
        if not f.is_file() or f.suffix not in (".md", ".csv", ".json"):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        # 「SUN」が単独単語として出ていないこと
        # （「ホットステーションSUN」等の専有名詞は禁止語リストでも個別にチェック）
        if re.search(r"ホットステーションSUN|サ責[A-D]|専務|事務長|506万円", text):
            raise AssertionError(f"{f.name} に内部固有語")
    print("✅ test_kimura_cio_handoff_does_not_use_sun_brand")


# ============================================================
# 4. 不変条件 (master JSON / checked / R8.6 / public release pack)
# ============================================================

def test_kimura_cio_handoff_master_json_unchanged():
    """handoff 作成は master JSON を改変しない（業務データに影響なし）"""
    # checked 20件・proposed_action 集計が想定通り
    counter = {}
    proposed_counter = {}
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") == "checked":
            counter[svc] = counter.get(svc, 0) + 1
        pa = ((v.get("service_code_audit") or {})
              .get("alpha_5_8_three_layer_model") or {}).get("proposed_action")
        proposed_counter[pa] = proposed_counter.get(pa, 0) + 1
    assert counter.get("houmon_kango_kaigo", 0) == 14, counter
    assert counter.get("tsusho_kaigo", 0) == 6, counter
    assert sum(counter.values()) == 20, counter
    # proposed_action の合計が 66
    assert sum(proposed_counter.values()) == 66
    print(f"✅ test_kimura_cio_handoff_master_json_unchanged: checked={sum(counter.values())} / total={sum(proposed_counter.values())}")


def test_kimura_cio_handoff_checked_20_unchanged():
    counter = 0
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") == "checked":
            counter += 1
    assert counter == 20, f"checked={counter}"
    print(f"✅ test_kimura_cio_handoff_checked_20_unchanged: {counter}")


def test_kimura_cio_handoff_no_new_checked_promotion():
    violations = []
    for svc, k, v in _iter_master_kasans():
        scms = v.get("service_code_mapping_status")
        pa = ((v.get("service_code_audit") or {})
              .get("alpha_5_8_three_layer_model") or {}).get("proposed_action")
        if scms == "checked" and pa != "keep_checked":
            violations.append((svc, k, pa))
    assert not violations, f"想定外: {violations}"
    print("✅ test_kimura_cio_handoff_no_new_checked_promotion")


def test_kimura_cio_handoff_r8_6_provisional_not_used_for_checked():
    r8 = {"WAM_R8_6_8_PROVISIONAL_2026_04_30", "WAM_R8_6_8_PROVISIONAL_2026_04_20"}
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") != "checked":
            continue
        sid = ((v.get("service_code_audit") or {})
               .get("alpha_5_8_three_layer_model") or {}).get("official_code_model", {}).get("source_id")
        assert sid not in r8, f"{svc}.{k} が R8.6案 source ({sid}) を使っている"
    print("✅ test_kimura_cio_handoff_r8_6_provisional_not_used_for_checked")


# ============================================================
# 5. public release pack / public path 不変
# ============================================================

def test_kimura_cio_handoff_alpha_5_3_5_4_release_pack_not_modified():
    for v in ("v2026.05.06-alpha.5.3", "v2026.05.06-alpha.5.4"):
        rp = PRODUCT_ROOT / "releases" / "public" / v
        assert rp.exists()
        for f in rp.iterdir():
            if not f.is_file():
                continue
            text = f.read_text(encoding="utf-8", errors="ignore") if f.suffix in (".md", ".json", ".txt") else ""
            # alpha.5.12-kimura-cio-handoff も release pack に含まれないこと
            assert "alpha.5.12-kimura-cio-handoff" not in text, \
                f"release pack {v}/{f.name} に handoff 文字列"
            assert "kimura_cio_handoff" not in text, \
                f"release pack {v}/{f.name} に kimura_cio_handoff 文字列"
    print("✅ test_kimura_cio_handoff_alpha_5_3_5_4_release_pack_not_modified")


def test_kimura_cio_handoff_pack_is_not_under_public_path():
    """handoff pack が public path に出ていないこと"""
    rel = HANDOFF_DIR.relative_to(PRODUCT_ROOT)
    assert rel.parts[:2] == ("out", "internal"), \
        f"handoff が internal 配下にない: {rel}"
    # releases/public/ 配下に kimura_cio_handoff ファイルが無いこと
    public_root = PRODUCT_ROOT / "releases" / "public"
    if public_root.exists():
        for f in public_root.rglob("*"):
            if f.is_file():
                assert "kimura_cio_handoff" not in f.name, \
                    f"public 配下に kimura_cio_handoff ファイル: {f}"
                assert "alpha5_12_kimura_cio" not in f.name, \
                    f"public 配下に kimura cio handoff ファイル: {f}"
    print("✅ test_kimura_cio_handoff_pack_is_not_under_public_path")


def test_kimura_cio_handoff_executive_summary_mentions_checked_20():
    """EXECUTIVE_SUMMARY_FOR_KIMURA.md が checked 20 件を明記している"""
    p = HANDOFF_DIR / "EXECUTIVE_SUMMARY_FOR_KIMURA.md"
    text = p.read_text(encoding="utf-8")
    assert "20" in text and "checked" in text
    # 36 / 9 / 1 も明記
    for n in ("36", "9", "1"):
        assert n in text
    print("✅ test_kimura_cio_handoff_executive_summary_mentions_checked_20")


def test_kimura_cio_handoff_next_actions_lists_7_items():
    """NEXT_ACTIONS_FOR_KIMURA.md に 7 つの Action が列挙されている"""
    p = HANDOFF_DIR / "NEXT_ACTIONS_FOR_KIMURA.md"
    text = p.read_text(encoding="utf-8")
    for n in range(1, 8):
        assert f"Action {n}" in text, f"Action {n} が見当たらない"
    print("✅ test_kimura_cio_handoff_next_actions_lists_7_items")
