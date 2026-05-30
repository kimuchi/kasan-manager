// 過去レビュー判断からの「学習ヒント」（CPOS reviews 由来）。
//
// 旧 review-learning.js（Firestore）の純ロジックを移植。データ源は CPOS app-data の
// reviews（[{ createdBy, data:{ kasanKey, decision } }, ...]）。

export function formatTendencyLabel(t) {
  switch (t) {
    case 'consistently_approved':
      return '通常承認';
    case 'consistently_returned':
      return '通常差戻し';
    case 'usually_approved':
      return '承認傾向';
    case 'usually_returned':
      return '差戻し傾向';
    case 'mixed':
      return '判断が分かれる';
    default:
      return '';
  }
}

function describeTendency({ approved = 0, returned = 0 }) {
  const total = approved + returned;
  if (!total) return 'mixed';
  const rate = approved / total;
  if (approved >= 5 && returned === 0) return 'consistently_approved';
  if (returned >= 5 && approved === 0) return 'consistently_returned';
  if (rate >= 0.7) return 'usually_approved';
  if (rate <= 0.3) return 'usually_returned';
  return 'mixed';
}

// CPOS reviews 一覧 → 自分（uid）の kasan_key 別集計。
export function summarizeReviewsForUser(reviews, uid) {
  const per = {};
  let total = 0;
  for (const r of reviews || []) {
    if (uid && r.createdBy !== uid) continue;
    const k = r.data?.kasanKey;
    const decision = r.data?.decision;
    if (!k || !decision) continue;
    per[k] = per[k] || { approved: 0, returned: 0, awaiting_review: 0 };
    if (per[k][decision] != null) per[k][decision] += 1;
    total += 1;
  }
  for (const k of Object.keys(per)) per[k].tendency = describeTendency(per[k]);
  return { per_kasan: per, total };
}

// portfolio.recommendations に学習ヒントを付与（純関数）。
export function attachLearningHints(portfolio, learning) {
  if (!portfolio?.recommendations || !learning?.per_kasan) return portfolio;
  return {
    ...portfolio,
    recommendations: portfolio.recommendations.map((r) => {
      const h = learning.per_kasan[r.kasan_key];
      if (!h) return r;
      return { ...r, learning_hint: h, learning_tendency_label: formatTendencyLabel(h.tendency) };
    }),
  };
}
