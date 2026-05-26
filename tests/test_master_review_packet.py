"""alpha.5.9 master review packet tests.

generate_alpha5_9_master_review_packet.py が出力するパケットの完全性を
保護する。本テストは master JSON を改変しないことも検証する。
"""
from __future__ import annotations

import csv
import io
import json
import sys
import subprocess
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ROOT = ROOT
PACKET_DIR = PRODUCT_ROOT / "out" / "internal" / "alpha5_9_master_review_packet"
ALPHA_5_8_1_COMMIT = "2f5245e9b2cba759e1aec7d0c47e6041ae512e81"


def _csv_data_rows(path: Path) -> list[dict]:
    """CSV から '#' で始まる note 行と空行を除外したデータ行を返す。"""
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [r for r in reader if r.get("service") and not r.get("service", "").startswith("#")]


# ============================================================
# 1. パケット構造
# ============================================================

def test_alpha_5_9_master_review_packet_directory_exists():
    assert PACKET_DIR.exists() and PACKET_DIR.is_dir(), f"packet dir 不在: {PACKET_DIR}"
    expected = {
        "README.md",
        "master_review_summary.md",
        "needs_master_review_matrix.csv",
        "needs_legal_review_matrix.csv",
        "divergent_mapping_review.md",
        "future_candidate_review.md",
        "reviewer_decision_template.csv",
        "alpha5_9_master_review_packet_manifest.json",
    }
    found = {p.name for p in PACKET_DIR.iterdir() if p.is_file()}
    missing = expected - found
    assert not missing, f"missing files: {missing}"
    print("✅ test_alpha_5_9_master_review_packet_directory_exists")


def test_alpha_5_9_manifest_json_is_valid():
    manifest_path = PACKET_DIR / "alpha5_9_master_review_packet_manifest.json"
    m = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Required top-level fields
    for key in (
        "version", "base_commit", "generated_at", "total_kasan_count",
        "checked_count", "needs_master_review_count", "needs_legal_review_count",
        "future_candidate_only_count", "divergent_count",
        "public_release", "checked_promotion", "master_auto_update",
        "r8_provisional_used_for_checked", "release_pack_modified",
    ):
        assert key in m, f"manifest missing key: {key}"
    assert m["version"] == "alpha.5.9"
    assert m["public_release"] is False
    assert m["checked_promotion"] is False
    assert m["master_auto_update"] is False
    assert m["r8_provisional_used_for_checked"] is False
    assert m["release_pack_modified"] is False
    print("✅ test_alpha_5_9_manifest_json_is_valid")


def test_alpha_5_9_manifest_base_commit_equals_alpha_5_8_1():
    manifest_path = PACKET_DIR / "alpha5_9_master_review_packet_manifest.json"
    m = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert m["base_commit"] == ALPHA_5_8_1_COMMIT, \
        f"base_commit={m['base_commit']} expected={ALPHA_5_8_1_COMMIT}"
    print("✅ test_alpha_5_9_manifest_base_commit_equals_alpha_5_8_1")


# ============================================================
# 2. CSV 件数
# ============================================================

def test_alpha_5_9_needs_master_review_matrix_has_28_rows():
    rows = _csv_data_rows(PACKET_DIR / "needs_master_review_matrix.csv")
    assert len(rows) == 28, f"needs_master_review rows={len(rows)} expected=28"
    print(f"✅ test_alpha_5_9_needs_master_review_matrix_has_28_rows: {len(rows)}")


def test_alpha_5_9_needs_legal_review_matrix_has_5_rows():
    rows = _csv_data_rows(PACKET_DIR / "needs_legal_review_matrix.csv")
    assert len(rows) == 5, f"needs_legal_review rows={len(rows)} expected=5"
    print(f"✅ test_alpha_5_9_needs_legal_review_matrix_has_5_rows: {len(rows)}")


# ============================================================
# 3. divergent / future_candidate 説明 markdown
# ============================================================

def test_alpha_5_9_divergent_mapping_review_contains_3_items():
    text = (PACKET_DIR / "divergent_mapping_review.md").read_text(encoding="utf-8")
    expected_keys = [
        "shougu_kaizen_kasan_2026_06",
        "adl_iji",
        "ninchi_kasan",
    ]
    for key in expected_keys:
        assert key in text, f"divergent_mapping_review.md に {key} が含まれていない"
    # 3件であることの宣言
    assert "3件" in text or "3 件" in text
    print("✅ test_alpha_5_9_divergent_mapping_review_contains_3_items")


def test_alpha_5_9_future_candidate_review_contains_2_items():
    text = (PACKET_DIR / "future_candidate_review.md").read_text(encoding="utf-8")
    # 2件の future_candidate_only 加算
    expected_keys = ["shougu_kaizen_kasan", "shougu_kaizen_kasan_2026_06"]
    for key in expected_keys:
        assert key in text, f"future_candidate_review.md に {key} が含まれていない"
    # R8.6 案であることの明示
    assert "案" in text
    assert "checked" in text
    assert "WAM_R8_6_8_PROVISIONAL_2026_04_30" in text
    print("✅ test_alpha_5_9_future_candidate_review_contains_2_items")


# ============================================================
# 4. CSV 列構造
# ============================================================

def test_alpha_5_9_reviewer_decision_template_has_required_columns():
    path = PACKET_DIR / "reviewer_decision_template.csv"
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
    expected = {
        "service", "kasan_key", "reviewer_decision",
        "reason", "required_evidence",
        "reviewer_name", "reviewed_at", "final_approved_by",
        "implementation_allowed",
    }
    missing = expected - set(header)
    assert not missing, f"reviewer_decision_template missing columns: {missing}"
    print(f"✅ test_alpha_5_9_reviewer_decision_template_has_required_columns: {header}")


def test_alpha_5_9_csv_rows_have_required_columns():
    """各 CSV 行に service / kasan_key / proposed_action(or _decision) / recommended_next_step が含まれる"""
    nm_rows = _csv_data_rows(PACKET_DIR / "needs_master_review_matrix.csv")
    for r in nm_rows:
        assert r.get("service"), f"needs_master row missing service: {r}"
        assert r.get("kasan_key"), f"missing kasan_key"
        assert r.get("proposed_action") == "needs_master_review", \
            f"想定外proposed_action: {r.get('proposed_action')}"
        assert r.get("recommended_next_step"), f"recommended_next_step 空: {r.get('kasan_key')}"
    nl_rows = _csv_data_rows(PACKET_DIR / "needs_legal_review_matrix.csv")
    for r in nl_rows:
        assert r.get("service"), f"needs_legal row missing service"
        assert r.get("kasan_key"), f"missing kasan_key"
        assert r.get("recommended_next_step"), f"recommended_next_step 空"
    print(f"✅ test_alpha_5_9_csv_rows_have_required_columns")


def test_alpha_5_9_every_needs_master_item_has_proposed_review_question():
    rows = _csv_data_rows(PACKET_DIR / "needs_master_review_matrix.csv")
    for r in rows:
        q = r.get("proposed_review_question") or ""
        assert len(q) > 30, f"{r['service']}.{r['kasan_key']} proposed_review_question が短い: {q!r}"
    print(f"✅ test_alpha_5_9_every_needs_master_item_has_proposed_review_question")


def test_alpha_5_9_every_needs_legal_item_has_legal_question():
    rows = _csv_data_rows(PACKET_DIR / "needs_legal_review_matrix.csv")
    for r in rows:
        q = r.get("legal_question") or ""
        assert len(q) > 30, f"{r['service']}.{r['kasan_key']} legal_question が短い: {q!r}"
    print(f"✅ test_alpha_5_9_every_needs_legal_item_has_legal_question")


# ============================================================
# 5. 不変条件: checked / 自動修正なし / R8.6
# ============================================================

def _iter_master_kasans():
    services = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
    for svc in services:
        path = PRODUCT_ROOT / f"regulatory_master/kaigo/{svc}.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        for k, v in (d.get("kasans") or {}).items():
            yield svc, k, v


def test_alpha_5_9_checked_20_unchanged():
    """alpha.5.9 packet生成後も checked 20件 (訪看14 + 通所6) を維持"""
    counter = {}
    for svc, k, v in _iter_master_kasans():
        scms = v.get("service_code_mapping_status")
        if scms == "checked":
            counter[svc] = counter.get(svc, 0) + 1
    assert counter.get("houmon_kango_kaigo", 0) == 14, counter
    assert counter.get("tsusho_kaigo", 0) == 6, counter
    assert sum(counter.values()) == 20, counter
    print(f"✅ test_alpha_5_9_checked_20_unchanged: {counter}")


def test_alpha_5_9_no_new_checked_promotion():
    """alpha.5.9 で新規 checked 昇格が発生していない（proposed_action=keep_checked のものだけが checked）"""
    # checked かつ proposed_action != keep_checked が無いこと
    violations = []
    for svc, k, v in _iter_master_kasans():
        scms = v.get("service_code_mapping_status")
        pa = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("proposed_action")
        if scms == "checked" and pa != "keep_checked":
            violations.append((svc, k, pa))
    assert not violations, f"想定外の checked 昇格: {violations}"
    print(f"✅ test_alpha_5_9_no_new_checked_promotion")


def test_alpha_5_9_r8_6_provisional_not_used_for_checked():
    """R8.6 案 source は checked 加算のいずれの official_source_id にも使われていない"""
    r8_source_ids = {"WAM_R8_6_8_PROVISIONAL_2026_04_30", "WAM_R8_6_8_PROVISIONAL_2026_04_20"}
    for svc, k, v in _iter_master_kasans():
        scms = v.get("service_code_mapping_status")
        if scms != "checked":
            continue
        official = (v.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model", {}).get("official_code_model", {})
        sid = official.get("source_id")
        assert sid not in r8_source_ids, \
            f"checked加算 {svc}.{k} が R8.6案 source ({sid}) を使っている"
    print("✅ test_alpha_5_9_r8_6_provisional_not_used_for_checked")


# ============================================================
# 6. 公開リリースパック未変更 (path-based check)
# ============================================================

def test_alpha_5_9_no_public_release_pack_files_modified_by_packet_dir():
    """alpha.5.9 packet は out/internal 配下にのみ書き出される（public/ release/ には書かない）"""
    # PACKET_DIR が internal 配下であること
    rel = PACKET_DIR.relative_to(PRODUCT_ROOT)
    assert rel.parts[:2] == ("out", "internal"), \
        f"packet が internal 配下にない: {rel}"
    # release pack ディレクトリに alpha.5.9 関連ファイルが無いこと
    for v in ("v2026.05.06-alpha.5.3", "v2026.05.06-alpha.5.4"):
        rp = PRODUCT_ROOT / "releases" / "public" / v
        if not rp.exists():
            continue
        for f in rp.iterdir():
            if not f.is_file():
                continue
            text = f.read_text(encoding="utf-8", errors="ignore") if f.suffix in (".md", ".json", ".txt") else ""
            assert "alpha.5.9" not in text, f"release pack {v}/{f.name} に alpha.5.9 文字列が混入"
    print("✅ test_alpha_5_9_no_public_release_pack_files_modified_by_packet_dir")


# ============================================================
# 7. 安全表現スキャン (packet 内)
# ============================================================

def test_alpha_5_9_packet_safe_expressions():
    """packet 内に「算定可否を保証」「公式コード完全照合済み」「R8対応済み」表現がないこと"""
    forbidden = [
        "算定可否を保証", "算定を保証", "算定可能と保証",
        "公式コード完全照合済", "完全照合済",
        "R8対応済", "R8.6対応済", "R8.6.1対応済",
    ]
    for f in PACKET_DIR.iterdir():
        if not f.is_file():
            continue
        if f.suffix not in (".md", ".csv", ".json"):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        for w in forbidden:
            assert w not in text, f"{f.name} に禁止語: {w}"
    print("✅ test_alpha_5_9_packet_safe_expressions")


# ============================================================
# 8. idempotency
# ============================================================

def test_alpha_5_9_generator_is_idempotent():
    """generator を 2 回実行しても同一出力（md5一致）"""
    import hashlib
    def md5_dir():
        h = {}
        for f in sorted(PACKET_DIR.iterdir()):
            if f.is_file():
                h[f.name] = hashlib.md5(f.read_bytes()).hexdigest()
        return h
    before = md5_dir()
    # generator を再実行
    script = PRODUCT_ROOT / "scripts" / "generate_alpha5_9_master_review_packet.py"
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=PRODUCT_ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, f"generator 失敗: {result.stderr}"
    after = md5_dir()
    assert before == after, f"非idempotent: \nbefore={before}\nafter={after}"
    print(f"✅ test_alpha_5_9_generator_is_idempotent ({len(before)} files)")
