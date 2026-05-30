// 過去レビュー判断からの学習。
//
// あるユーザーが過去に同じ kasan_key に対してどう判断していたかを集計し、
// 次回判定の参考情報として「💡 過去 N 回承認 / M 回差戻し」を提示する。
//
// シンプルな実装:
//   - reviewer_uid = uid の review_decisions を全件取得（直近 N 件で打ち切り）
//   - kasan_key 別に approved / returned / awaiting_review カウント
//   - approval_rate = approved / (approved + returned) で 1.0=常に承認、0.0=常に差戻し
//
// ポートフォリオ候補や、未判定の加算カードに付与する。

import { getDb } from './firebase-admin.js';

const COLLECTION_REVIEWS = 'review_decisions';
const MAX_FETCH = 1000;

export async function summarizePastDecisionsForUser(uid, { limit = MAX_FETCH } = {}) {
  const db = getDb();
  if (!db) return { per_kasan: {}, total: 0 };
  let snap;
  try {
    snap = await db
      .collection(COLLECTION_REVIEWS)
      .where('reviewer_uid', '==', uid)
      .orderBy('decided_at', 'desc')
      .limit(limit)
      .get();
  } catch (err) {
    console.warn(`[review-learning] fetch failed: ${err.message}`);
    return { per_kasan: {}, total: 0 };
  }
  const perKasan = {};
  let total = 0;
  for (const doc of snap.docs) {
    total += 1;
    const d = doc.data();
    const key = d.kasan_key || '__overall__';
    if (!perKasan[key]) {
      perKasan[key] = {
        approved: 0,
        returned: 0,
        awaiting_review: 0,
        last_decision: null,
        last_decision_at: null,
        last_comment: null,
      };
    }
    const bucket = perKasan[key];
    if (d.decision === 'approved') bucket.approved += 1;
    else if (d.decision === 'returned') bucket.returned += 1;
    else if (d.decision === 'awaiting_review') bucket.awaiting_review += 1;
    if (!bucket.last_decision) {
      bucket.last_decision = d.decision;
      bucket.last_decision_at = d.decided_at?.toDate?.()
        ? d.decided_at.toDate().toISOString()
        : d.decided_at || null;
      bucket.last_comment = d.comment || null;
    }
  }
  // 派生情報を付与
  for (const bucket of Object.values(perKasan)) {
    const decided = bucket.approved + bucket.returned;
    bucket.approval_rate = decided > 0 ? Math.round((bucket.approved / decided) * 100) / 100 : null;
    bucket.tendency = describeTendency(bucket);
  }
  return { per_kasan: perKasan, total };
}

function describeTendency(bucket) {
  const decided = bucket.approved + bucket.returned;
  if (decided < 2) return 'sample_too_small';
  if (bucket.approved >= 3 && bucket.returned === 0) return 'consistently_approved';
  if (bucket.returned >= 3 && bucket.approved === 0) return 'consistently_returned';
  if (bucket.approved >= 2 * bucket.returned) return 'usually_approved';
  if (bucket.returned >= 2 * bucket.approved) return 'usually_returned';
  return 'mixed';
}

const TENDENCY_LABEL = {
  sample_too_small: '（履歴少）',
  consistently_approved: '通常承認',
  consistently_returned: '通常差戻し',
  usually_approved: '承認傾向',
  usually_returned: '差戻し傾向',
  mixed: '判断が分かれる',
};

export function formatTendencyLabel(tendency) {
  return TENDENCY_LABEL[tendency] || '';
}

// 与えられた portfolio / judgements に対して、kasan ごとの learning_hint を付与した
// 新オブジェクトを返す（破壊しない）。
export function attachLearningHints(target, learning) {
  if (!learning?.per_kasan) return target;
  if (Array.isArray(target?.recommendations)) {
    return {
      ...target,
      recommendations: target.recommendations.map((r) => {
        const hint = learning.per_kasan[r.kasan_key];
        return hint ? { ...r, learning_hint: hint, learning_tendency_label: formatTendencyLabel(hint.tendency) } : r;
      }),
    };
  }
  return target;
}
