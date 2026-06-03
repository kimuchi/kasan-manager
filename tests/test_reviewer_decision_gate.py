"""alpha.5.10 reviewer decision gate tests.

generate_alpha5_10_reviewer_decision_gate.py の分類ロジックと不変条件
を保護する。本テストは master JSON を改変しないことも検証する。
"""
from __future__ import annotations

import csv
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ROOT = ROOT
GATE_DIR = PRODUCT_ROOT / "out" / "internal" / "alpha5_10_reviewer_decision_gate"
ALPHA_5_9_PACKET = PRODUCT_ROOT / "out" / "internal" / "alpha5_9_master_review_packet"
ALPHA_5_9_COMMIT = "d0c911db9b28f561f0e40859a4c40e863982d7f6"

GATE_SCRIPT = PRODUCT_ROOT / "scripts" / "generate_alpha5_10_reviewer_decision_gate.py"
ALPHA_5_9_TEMPLATE = ALPHA_5_9_PACKET / "reviewer_decision_template.csv"


# ============================================================
# Helpers
# ============================================================

REVIEWER_DECISION_COLUMNS = [
    "service", "kasan_key", "reviewer_decision",
    "reason", "required_evidence",
    "reviewer_name", "reviewed_at", "final_approved_by",
    "implementation_allowed",
]


def _run_gate(input_csv: Path, out_dir: Path):
    result = subprocess.run(
        [sys.executable, str(GATE_SCRIPT),
         "--input", str(input_csv), "--output", str(out_dir),
         "--alpha59-packet-dir", str(ALPHA_5_9_PACKET)],
        cwd=PRODUCT_ROOT, capture_output=True, text=True
    )
    return result


def _read_data_rows(csv_path: Path) -> list[dict]:
    if not csv_path.exists():
        return []
    with open(csv_path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [r for r in reader if r.get("service") and not r.get("service", "").startswith("#")]


def _read_manifest(out_dir: Path) -> dict:
    p = out_dir / "alpha5_10_reviewer_decision_gate_manifest.json"
    return json.loads(p.read_text(encoding="utf-8"))


def _make_template_with_overrides(overrides: dict[tuple[str, str], dict]) -> Path:
    """alpha.5.9 template をベースに、(service, kasan_key) → field-overrides で書き換えた一時CSVを作る。
    返り値: 一時ファイルのパス（呼び出し側で cleanup 不要・テスト終了で破棄）"""
    base_rows = _read_data_rows(ALPHA_5_9_TEMPLATE)
    out_rows = []
    for row in base_rows:
        key = (row["service"], row["kasan_key"])
        if key in overrides:
            updated = dict(row)
            updated.update(overrides[key])
            out_rows.append(updated)
        else:
            out_rows.append(row)
    tmp = Path(tempfile.mkstemp(suffix=".csv", prefix="alpha510_test_")[1])
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=REVIEWER_DECISION_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in out_rows:
            w.writerow(r)
    return tmp


def _run_gate_with_overrides(overrides: dict, tmp_dir: Path) -> dict:
    """overrides を適用したCSVでゲート実行 → manifest を返す"""
    tmp_input = _make_template_with_overrides(overrides)
    res = _run_gate(tmp_input, tmp_dir)
    assert res.returncode == 0, f"gate failed: {res.stderr}"
    return _read_manifest(tmp_dir)


# ============================================================
# 1. パケット構造
# ============================================================

def test_alpha_5_10_decision_gate_directory_exists():
    assert GATE_DIR.exists() and GATE_DIR.is_dir(), f"gate dir 不在: {GATE_DIR}"
    expected = {
        "README.md",
        "decision_validation_report.md",
        "approved_changes_preview.csv",
        "approved_changes_preview.json",
        "blocked_or_incomplete_decisions.csv",
        "pending_decisions.csv",
        "legal_review_required.csv",
        "alpha5_10_reviewer_decision_gate_manifest.json",
    }
    found = {p.name for p in GATE_DIR.iterdir() if p.is_file()}
    missing = expected - found
    assert not missing, f"missing: {missing}"
    print("✅ test_alpha_5_10_decision_gate_directory_exists")


def test_alpha_5_10_manifest_json_is_valid():
    m = _read_manifest(GATE_DIR)
    for key in (
        "version", "base_commit", "input_packet_version", "input_template_path",
        "total_review_rows", "approved_count", "blocked_count",
        "pending_count", "legal_review_required_count",
        "future_candidate_count", "divergent_count",
        "public_release", "checked_promotion", "master_auto_update",
        "r8_provisional_used_for_checked", "release_pack_modified",
    ):
        assert key in m, f"manifest missing: {key}"
    assert m["version"] == "alpha.5.10"
    assert m["public_release"] is False
    assert m["checked_promotion"] is False
    assert m["master_auto_update"] is False
    assert m["r8_provisional_used_for_checked"] is False
    assert m["release_pack_modified"] is False
    print("✅ test_alpha_5_10_manifest_json_is_valid")


def test_alpha_5_10_manifest_base_commit_equals_alpha_5_9():
    m = _read_manifest(GATE_DIR)
    assert m["base_commit"] == ALPHA_5_9_COMMIT, \
        f"base_commit={m['base_commit']} expected={ALPHA_5_9_COMMIT}"
    assert m["input_packet_version"] == "alpha.5.9"
    print("✅ test_alpha_5_10_manifest_base_commit_equals_alpha_5_9")


# ============================================================
# 2. 空欄テンプレート挙動
# ============================================================

def test_alpha_5_10_blank_template_results_in_zero_approved_and_38_pending():
    """alpha.5.9 の空欄テンプレートそのままなら 0 approved / 38 pending"""
    m = _read_manifest(GATE_DIR)
    assert m["total_review_rows"] == 38
    assert m["approved_count"] == 0
    assert m["pending_count"] == 38
    assert m["blocked_count"] == 0
    assert m["legal_review_required_count"] == 0
    print(f"✅ test_alpha_5_10_blank_template_results_in_zero_approved_and_38_pending: {m['approved_count']}/{m['pending_count']}")


# ============================================================
# 3. invalid / required-fields の blocked 判定
# ============================================================

def test_alpha_5_10_invalid_reviewer_decision_is_blocked(tmp_path):
    overrides = {
        ("tsusho_kaigo", "chujudosha_care_taisei"): {
            "reviewer_decision": "definitely_invalid_choice",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    assert m["blocked_count"] >= 1
    blocked = _read_data_rows(tmp_path / "blocked_or_incomplete_decisions.csv")
    found = [r for r in blocked if r["kasan_key"] == "chujudosha_care_taisei"]
    assert found, f"chujudosha が blocked に入っていない"
    assert "invalid_reviewer_decision" in found[0]["blocked_reason"]
    print("✅ test_alpha_5_10_invalid_reviewer_decision_is_blocked")


def test_alpha_5_10_implementation_allowed_yes_requires_final_approved_by(tmp_path):
    overrides = {
        ("tsusho_kaigo", "chujudosha_care_taisei"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "公式コードに合わせる",
            "required_evidence": "WAM NET R7.8 確定版",
            "reviewer_name": "業務担当A",
            "reviewed_at": "2026-05-15",
            "final_approved_by": "",  # missing!
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    blocked = _read_data_rows(tmp_path / "blocked_or_incomplete_decisions.csv")
    found = [r for r in blocked if r["kasan_key"] == "chujudosha_care_taisei"]
    assert found, "missing field でブロックされていない"
    assert "missing_required_fields" in found[0]["blocked_reason"]
    assert "final_approved_by" in found[0]["missing_fields"]
    print("✅ test_alpha_5_10_implementation_allowed_yes_requires_final_approved_by")


def test_alpha_5_10_implementation_allowed_yes_requires_reason(tmp_path):
    overrides = {
        ("tsusho_kaigo", "chujudosha_care_taisei"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "",   # missing
            "required_evidence": "evidence",
            "reviewer_name": "name",
            "reviewed_at": "2026-05-15",
            "final_approved_by": "approver",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    blocked = _read_data_rows(tmp_path / "blocked_or_incomplete_decisions.csv")
    found = [r for r in blocked if r["kasan_key"] == "chujudosha_care_taisei"]
    assert found
    assert "reason" in found[0]["missing_fields"]
    print("✅ test_alpha_5_10_implementation_allowed_yes_requires_reason")


def test_alpha_5_10_implementation_allowed_yes_requires_required_evidence(tmp_path):
    overrides = {
        ("tsusho_kaigo", "chujudosha_care_taisei"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "reason text",
            "required_evidence": "",  # missing
            "reviewer_name": "name",
            "reviewed_at": "2026-05-15",
            "final_approved_by": "approver",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    blocked = _read_data_rows(tmp_path / "blocked_or_incomplete_decisions.csv")
    found = [r for r in blocked if r["kasan_key"] == "chujudosha_care_taisei"]
    assert found
    assert "required_evidence" in found[0]["missing_fields"]
    print("✅ test_alpha_5_10_implementation_allowed_yes_requires_required_evidence")


# ============================================================
# 4. 重複行
# ============================================================

def test_alpha_5_10_duplicate_service_kasan_key_rows_are_blocked(tmp_path):
    """元 CSV に重複行を追加した一時CSVを作って実行"""
    base_rows = _read_data_rows(ALPHA_5_9_TEMPLATE)
    # 同じ key を 2 回出現させる
    dup_target = next((r for r in base_rows if r["kasan_key"] == "chujudosha_care_taisei"), None)
    assert dup_target, "fixture 不在"
    rows = list(base_rows) + [dict(dup_target,
                                    reviewer_decision="add_receipt_alias",
                                    reason="dup",
                                    required_evidence="dup",
                                    reviewer_name="dup",
                                    reviewed_at="2026-05-15",
                                    final_approved_by="dup",
                                    implementation_allowed="yes")]
    tmp_input = tmp_path / "dup_input.csv"
    with open(tmp_input, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=REVIEWER_DECISION_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    out_dir = tmp_path / "out"
    res = _run_gate(tmp_input, out_dir)
    assert res.returncode == 0, res.stderr
    blocked = _read_data_rows(out_dir / "blocked_or_incomplete_decisions.csv")
    dup_blocked = [r for r in blocked if "duplicate" in r["blocked_reason"]]
    assert dup_blocked, f"重複が blocked に入っていない: {blocked}"
    print(f"✅ test_alpha_5_10_duplicate_service_kasan_key_rows_are_blocked: {len(dup_blocked)} duplicate(s)")


# ============================================================
# 5. future_candidate_only
# ============================================================

def test_alpha_5_10_future_candidate_only_rows_cannot_become_approved(tmp_path):
    # future_candidate kasan に approve_official_code_addition を入れる → blocked
    overrides = {
        ("houmon_kaigo", "shougu_kaizen_kasan"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "本来やるべきでない",
            "required_evidence": "X",
            "reviewer_name": "X",
            "reviewed_at": "2026-05-15",
            "final_approved_by": "X",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    approved = _read_data_rows(tmp_path / "approved_changes_preview.csv")
    blocked = _read_data_rows(tmp_path / "blocked_or_incomplete_decisions.csv")
    # future_candidate kasan が approved に存在しないこと
    assert not any(r["kasan_key"] == "shougu_kaizen_kasan" for r in approved), \
        "future_candidate が approved に入った"
    found = [r for r in blocked if r["kasan_key"] == "shougu_kaizen_kasan"]
    assert found, "future_candidate の不正decision が blocked になっていない"
    assert "future_candidate" in found[0]["blocked_reason"]
    print("✅ test_alpha_5_10_future_candidate_only_rows_cannot_become_approved")


def test_alpha_5_10_future_candidate_only_with_defer_goes_to_pending(tmp_path):
    overrides = {
        ("houmon_kaigo", "shougu_kaizen_kasan"): {
            "reviewer_decision": "defer_until_r8_definitive",
            "reason": "R8.6.1 確定版待ち",
            "required_evidence": "(R8.6.1 確定版PDFが出るまで)",
            "reviewer_name": "業務担当A",
            "reviewed_at": "2026-05-15",
            "final_approved_by": "最終判断者",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    pending = _read_data_rows(tmp_path / "pending_decisions.csv")
    found = [r for r in pending if r["kasan_key"] == "shougu_kaizen_kasan"]
    assert found, "defer_until_r8_definitive が pending に入っていない"
    assert "deferred_until_r8_definitive" in found[0]["pending_reason"]
    # approved には入らない
    approved = _read_data_rows(tmp_path / "approved_changes_preview.csv")
    assert not any(r["kasan_key"] == "shougu_kaizen_kasan" for r in approved)
    print("✅ test_alpha_5_10_future_candidate_only_with_defer_goes_to_pending")


# ============================================================
# 6. needs_legal_review
# ============================================================

def test_alpha_5_10_needs_legal_review_rows_go_to_legal_review_required(tmp_path):
    """needs_legal_review kasan に approve を入れても legal_review_required に行く"""
    overrides = {
        ("houmon_kango_kaigo", "fukusu_mei_houmon_kango_kasan_I_under30"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "X",
            "required_evidence": "X",
            "reviewer_name": "X",
            "reviewed_at": "2026-05-15",
            "final_approved_by": "X",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    legal = _read_data_rows(tmp_path / "legal_review_required.csv")
    found = [r for r in legal if r["kasan_key"] == "fukusu_mei_houmon_kango_kasan_I_under30"]
    assert found, "needs_legal_review が legal_review_required に入っていない"
    # approved には入らない
    approved = _read_data_rows(tmp_path / "approved_changes_preview.csv")
    assert not any(r["kasan_key"] == "fukusu_mei_houmon_kango_kasan_I_under30" for r in approved)
    print("✅ test_alpha_5_10_needs_legal_review_rows_go_to_legal_review_required")


# ============================================================
# 7. approved preview の許可decision のみ
# ============================================================

def test_alpha_5_10_approved_preview_only_contains_allowed_decisions(tmp_path):
    """approved には approve_official_code_addition / add_receipt_alias / correct_internal_legacy_code のみ"""
    # 各decisionを試す
    overrides = {
        # 3 modifying decisions on needs_master_review kasans → approved
        ("tsusho_kaigo", "chujudosha_care_taisei"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "公式コードに合わせる",
            "required_evidence": "R7.8 PDF",
            "reviewer_name": "A", "reviewed_at": "2026-05-15", "final_approved_by": "B",
            "implementation_allowed": "yes",
        },
        ("tsusho_kaigo", "nyuyoku_II"): {
            "reviewer_decision": "add_receipt_alias",
            "reason": "alias追加", "required_evidence": "X",
            "reviewer_name": "A", "reviewed_at": "2026-05-15", "final_approved_by": "B",
            "implementation_allowed": "yes",
        },
        ("tsusho_kaigo", "koukuu_kinou_I"): {
            "reviewer_decision": "correct_internal_legacy_code",
            "reason": "社内コード訂正", "required_evidence": "PDF回帰必須",
            "reviewer_name": "A", "reviewed_at": "2026-05-15", "final_approved_by": "B",
            "implementation_allowed": "yes",
        },
        # 5 non-modifying decisions → not approved
        ("tsusho_kaigo", "eiyou_kaizen"): {
            "reviewer_decision": "keep_legacy_detection_only",
            "reason": "現状維持", "required_evidence": "X",
            "reviewer_name": "A", "reviewed_at": "2026-05-15", "final_approved_by": "B",
            "implementation_allowed": "yes",
        },
        ("houmon_kaigo", "shokai_kasan"): {
            "reviewer_decision": "mark_structural_mismatch",
            "reason": "構造不一致記録", "required_evidence": "X",
            "reviewer_name": "A", "reviewed_at": "2026-05-15", "final_approved_by": "B",
            "implementation_allowed": "yes",
        },
        ("houmon_kaigo", "seikatsu_kinou_renkei_I"): {
            "reviewer_decision": "escalate_legal_review",
            "reason": "法令確認依頼", "required_evidence": "X",
            "reviewer_name": "A", "reviewed_at": "2026-05-15", "final_approved_by": "B",
            "implementation_allowed": "yes",
        },
    }
    m = _run_gate_with_overrides(overrides, tmp_path)
    approved = _read_data_rows(tmp_path / "approved_changes_preview.csv")
    legal = _read_data_rows(tmp_path / "legal_review_required.csv")
    pending = _read_data_rows(tmp_path / "pending_decisions.csv")

    # 3つの mod decision は approved に
    approved_keys = {r["kasan_key"] for r in approved}
    assert "chujudosha_care_taisei" in approved_keys
    assert "nyuyoku_II" in approved_keys
    assert "koukuu_kinou_I" in approved_keys
    # それ以外は approved に入らない
    for k in ("eiyou_kaizen", "shokai_kasan", "seikatsu_kinou_renkei_I"):
        assert k not in approved_keys, f"non-mod decision {k} が approved に混入"

    # 各 approved 行の reviewer_decision は MODIFYING_DECISIONS のみ
    valid_mod = {"approve_official_code_addition", "add_receipt_alias", "correct_internal_legacy_code"}
    for r in approved:
        assert r["reviewer_decision"] in valid_mod, \
            f"approved に非mod decision: {r['reviewer_decision']}"

    # escalate_legal_review は legal_review_required に
    legal_keys = {r["kasan_key"] for r in legal}
    assert "seikatsu_kinou_renkei_I" in legal_keys

    # keep_legacy_detection_only / mark_structural_mismatch は pending (記録のみ)
    pending_keys = {r["kasan_key"] for r in pending}
    assert "eiyou_kaizen" in pending_keys
    assert "shokai_kasan" in pending_keys

    print(f"✅ test_alpha_5_10_approved_preview_only_contains_allowed_decisions: approved={len(approved)}")


# ============================================================
# 8. master JSON 不変・checked 維持・R8.6 不使用
# ============================================================

def _iter_master_kasans():
    services = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
    for svc in services:
        path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        for k, v in (d.get("kasans") or {}).items():
            yield svc, k, v


def test_alpha_5_10_master_json_is_not_modified(tmp_path):
    """ゲート実行前後で master JSON のハッシュが変わっていないこと"""
    import hashlib
    services = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
    before = {}
    for svc in services:
        p = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        before[svc] = hashlib.md5(p.read_bytes()).hexdigest()
    # ゲート実行 (書き換え可能性のあるパスを通す)
    overrides = {
        ("tsusho_kaigo", "chujudosha_care_taisei"): {
            "reviewer_decision": "approve_official_code_addition",
            "reason": "R", "required_evidence": "E",
            "reviewer_name": "N", "reviewed_at": "2026-05-15", "final_approved_by": "F",
            "implementation_allowed": "yes",
        },
    }
    _run_gate_with_overrides(overrides, tmp_path)
    after = {}
    for svc in services:
        p = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        after[svc] = hashlib.md5(p.read_bytes()).hexdigest()
    assert before == after, f"master JSON が改変された: \nbefore={before}\nafter={after}"
    print("✅ test_alpha_5_10_master_json_is_not_modified")


def test_alpha_5_10_checked_20_unchanged():
    counter = {}
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") == "checked":
            counter[svc] = counter.get(svc, 0) + 1
    assert counter.get("houmon_kango_kaigo", 0) == 14, counter
    assert counter.get("tsusho_kaigo", 0) == 6, counter
    assert sum(counter.values()) == 20, counter
    print(f"✅ test_alpha_5_10_checked_20_unchanged: {counter}")


def test_alpha_5_10_no_new_checked_promotion():
    """checked かつ proposed_action != keep_checked が無いこと"""
    violations = []
    for svc, k, v in _iter_master_kasans():
        scms = v.get("service_code_mapping_status")
        pa = ((v.get("service_code_audit") or {})
              .get("alpha_5_8_three_layer_model") or {}).get("proposed_action")
        if scms == "checked" and pa != "keep_checked":
            violations.append((svc, k, pa))
    assert not violations, f"想定外の checked: {violations}"
    print("✅ test_alpha_5_10_no_new_checked_promotion")


def test_alpha_5_10_r8_6_provisional_not_used_for_checked():
    r8 = {"WAM_R8_6_8_PROVISIONAL_2026_04_30", "WAM_R8_6_8_PROVISIONAL_2026_04_20"}
    for svc, k, v in _iter_master_kasans():
        if v.get("service_code_mapping_status") != "checked":
            continue
        sid = ((v.get("service_code_audit") or {})
               .get("alpha_5_8_three_layer_model") or {}).get("official_code_model", {}).get("source_id")
        assert sid not in r8, f"checked加算 {svc}.{k} が R8.6案 source ({sid}) を使っている"
    print("✅ test_alpha_5_10_r8_6_provisional_not_used_for_checked")


# ============================================================
# 9. 公開リリースパック未変更（path-based）
# ============================================================

def test_alpha_5_10_alpha_5_3_5_4_release_pack_not_modified():
    for v in ("v2026.05.06-alpha.5.3", "v2026.05.06-alpha.5.4"):
        rp = PRODUCT_ROOT / "releases" / "public" / v
        assert rp.exists(), f"release pack 不在: {v}"
        for f in rp.iterdir():
            if not f.is_file():
                continue
            text = f.read_text(encoding="utf-8", errors="ignore") if f.suffix in (".md", ".json", ".txt") else ""
            assert "alpha.5.10" not in text, f"release pack {v}/{f.name} に alpha.5.10 文字列が混入"
    print("✅ test_alpha_5_10_alpha_5_3_5_4_release_pack_not_modified")


def test_alpha_5_10_alpha_5_9_packet_not_destroyed():
    """alpha.5.9 packet ファイルが本ゲートによって削除・改変されていない"""
    expected = {
        "README.md", "master_review_summary.md",
        "needs_master_review_matrix.csv", "needs_legal_review_matrix.csv",
        "divergent_mapping_review.md", "future_candidate_review.md",
        "reviewer_decision_template.csv", "alpha5_9_master_review_packet_manifest.json",
    }
    found = {p.name for p in ALPHA_5_9_PACKET.iterdir() if p.is_file()}
    missing = expected - found
    assert not missing, f"alpha.5.9 packet 破壊: {missing}"
    print("✅ test_alpha_5_10_alpha_5_9_packet_not_destroyed")


# ============================================================
# 10. safe expressions in gate output
# ============================================================

def test_alpha_5_10_gate_output_safe_expressions():
    forbidden = [
        "算定可否を保証", "算定を保証", "算定可能と保証",
        "公式コード完全照合済", "完全照合済",
        "R8対応済", "R8.6対応済", "R8.6.1対応済",
    ]
    for f in GATE_DIR.iterdir():
        if not f.is_file():
            continue
        if f.suffix not in (".md", ".csv", ".json"):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        for w in forbidden:
            assert w not in text, f"{f.name} に禁止語: {w}"
    print("✅ test_alpha_5_10_gate_output_safe_expressions")
