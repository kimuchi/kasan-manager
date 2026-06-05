// PR-4: 再判定の差分エンジン。
// 前回と今回の result-classifier 分類を比較し、「判定が固まった/変わった加算」を返す。
// 「良くなった/悪くなった」ではなく、未確定(needs_more_data)から確定側へ動いたか（settled）を重視する。

export const BUCKET_LABEL = {
  billable_now: '請求OK',
  claimed_evidence_risk: '算定中だが証跡未確認',
  almost_ready: 'あと一歩',
  needs_more_data: '追加データ必要',
  not_recommended: '非推奨/対象外',
  not_applicable: '当サービス対象外',
  ai_general_candidate: 'AI一般提案',
};

// prev / next: { kasan_key: classification } のマップ。judgements: 加算名引き当て用。
export function computeClassificationDiff(prev = {}, next = {}, judgements = {}) {
  const changes = [];
  for (const [k, nc] of Object.entries(next || {})) {
    const pc = (prev || {})[k];
    if (!pc) continue; // 前回に無い＝初回扱い（差分にしない）
    if (pc.user_visible_bucket === nc.user_visible_bucket) continue;
    changes.push({
      kasan_key: k,
      name: judgements[k]?.name || k,
      from_bucket: pc.user_visible_bucket,
      to_bucket: nc.user_visible_bucket,
      from_label: BUCKET_LABEL[pc.user_visible_bucket] || pc.user_visible_bucket,
      to_label: BUCKET_LABEL[nc.user_visible_bucket] || nc.user_visible_bucket,
      reason: nc.reason_short || '',
      // 未確定(追加データ必要)から確定側へ動いた＝判定が固まった（実務上の価値）
      settled:
        pc.user_visible_bucket === 'needs_more_data' && nc.user_visible_bucket !== 'needs_more_data',
    });
  }
  // settled を上に、その後 kasan_key 順
  changes.sort((a, b) => (b.settled ? 1 : 0) - (a.settled ? 1 : 0) || a.kasan_key.localeCompare(b.kasan_key));
  return changes;
}

// 差分を Markdown 行に整形（レポート/レスポンス用）
export function renderDiffLines(changes = []) {
  if (!changes.length) return ['（判定が変わった加算はありません）'];
  return changes.map((c) => {
    const tag = c.settled ? '🔒 判定確定' : '↻ 変化';
    const reason = c.reason ? `　理由：${c.reason}` : '';
    return `- ${tag} ${c.name}：${c.from_label} → ${c.to_label}${reason}`;
  });
}
