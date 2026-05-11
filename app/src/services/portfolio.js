// ポートフォリオ最適化 PoC
//
// 目的: judge 結果のうち「あと一歩で取れる加算」を、収益 / 必要工数 / 優先度で
// ランキングし、限られたリソースの中で「次に取りに行くべき加算」を提案する。
//
// 入力: judgeResult（runJudge() の戻り値）+ user_summary など
// 出力: {
//   service, service_month, total_potential_yen_per_month, recommendations: [{
//     kasan_key, kasan_name, algorithm_judgement, missing_evidence,
//     revenue_per_month_yen, effort_score, priority_score,
//     rationale, action_items
//   }]
// }
//
// この PoC は深い財務モデルを目指さず、判定エンジン側に既にあるメタ
// （unit_per_day / roi_estimation.revenue_per_user_per_day / priority_hint）と
// 利用者数から「ざっくり何円取れる加算か」を見せることが第一目的。

const DEFAULT_YEN_PER_UNIT = 10.27; // 6級地・標準。実際は地域単価で前後する
const DEFAULT_DAYS_PER_MONTH = 22;  // 平均稼働日数（営業日ベース）
const EFFORT_PER_MISSING_FACT = 1;
const EFFORT_BASE = 1;

// kasan を「あと一歩で取れる」候補と見なす条件:
//   - algorithm_judgement: 'waiting' | 'unknown'（要件未充足ではあるが議論余地あり）
//   - claimed_but_requirements_unknown （請求はあるが要件未確認 → 要件整備で「取れている」状態にできる）
//   - currently_claimed / clear / not_applicable / not_clear は除外
function isCandidate(jud) {
  const status = jud?.algorithm_judgement;
  if (!status) return false;
  if (jud?.applicability === 'not_applicable') return false;
  if (jud?.applicability_reason && /対象外/.test(jud.applicability_reason)) return false;
  return ['waiting', 'unknown', 'claimed_but_requirements_unknown'].includes(status);
}

// kasan ごとの不足エビデンス件数（judge.evidence_checklist から取得）
function countMissingEvidence(kasanKey, evidenceChecklist) {
  if (!Array.isArray(evidenceChecklist)) return 0;
  return evidenceChecklist.filter((it) => it.kasan_key === kasanKey).length;
}

function listMissingEvidence(kasanKey, evidenceChecklist) {
  if (!Array.isArray(evidenceChecklist)) return [];
  return evidenceChecklist.filter((it) => it.kasan_key === kasanKey).map((it) => ({
    fact_path: it.fact_path,
    label: it.label,
    next_action: it.next_action,
    priority: it.priority || '中',
    recommended_documents: it.recommended_documents || [],
  }));
}

// 月額収益見積もり (円/月)
// - unit_per_day（単位/日） × ユーザー数 × 日数 × 円/単位
// - roi_estimation.revenue_per_user_per_day があればそれを優先
function estimateMonthlyRevenue(kasanDef, judgeResult) {
  const usersTotal =
    judgeResult?.user_summary_display?.users_total ||
    judgeResult?.cpos_metadata?.userSummary?.activeUserCount ||
    judgeResult?.user_summary?.users_total ||
    0;
  const unitPerDay =
    kasanDef?.roi_estimation?.revenue_per_user_per_day ||
    kasanDef?.unit_per_day ||
    null;
  if (!unitPerDay || !usersTotal) return null;
  // unit_type が「月あたり」なら日数は乗算しない
  const unitType = String(kasanDef.unit_type || '').toLowerCase();
  const isPerMonth = unitType.includes('月');
  const days = isPerMonth ? 1 : DEFAULT_DAYS_PER_MONTH;
  const yen = unitPerDay * usersTotal * days * DEFAULT_YEN_PER_UNIT;
  return Math.round(yen);
}

// 工数スコア（小さいほど楽）
function estimateEffort(missingItems) {
  const count = Array.isArray(missingItems) ? missingItems.length : 0;
  // 高優先度の missing は工数を多めに見積もる
  let weighted = 0;
  for (const m of missingItems || []) {
    weighted += m.priority === '高' ? 1.5 : 1.0;
  }
  return EFFORT_BASE + (weighted || count) * EFFORT_PER_MISSING_FACT;
}

// 優先度: revenue が大きく、effort が小さく、priority_hint が高いほど高い
function computePriority({ revenuePerMonth, effort, priorityHint }) {
  const baseRevenue = revenuePerMonth || 0;
  const score = baseRevenue / Math.max(1, effort);
  let multiplier = 1.0;
  if (priorityHint && /大/.test(priorityHint)) multiplier *= 1.3;
  if (priorityHint && /ボーダー|注意|要確認/.test(priorityHint)) multiplier *= 0.95;
  return Math.round(score * multiplier);
}

function buildActionItems(jud, missingItems) {
  const out = [];
  for (const m of missingItems || []) {
    out.push(m.next_action || `「${m.label || m.fact_path}」を整備する`);
  }
  if (jud?.documents_required && Array.isArray(jud.documents_required)) {
    for (const d of jud.documents_required.slice(0, 3)) out.push(`書類整備: ${d}`);
  }
  if (out.length === 0) {
    out.push('要件の根拠資料（議事録・実施記録など）を tenant_data/evidence に登録する');
  }
  return out;
}

// 設計メモ: judge.js は judgements に unit_per_day / roi_estimation / documents_required
// を直接埋め込む（service_def.master.kasans からマージ）ので、judgement そのものを
// kasanDef としても扱える。kasanDefs を明示で渡せばそちらを優先する。
export function optimizePortfolio({ judgeResult, kasanDefs = null }) {
  if (!judgeResult || typeof judgeResult !== 'object') {
    throw new Error('judgeResult is required');
  }
  const judgements = judgeResult.judgements || {};
  const evidenceChecklist = judgeResult.evidence_checklist || [];
  const defs = kasanDefs || judgeResult?.service_def?.master?.kasans || {};
  const recommendations = [];
  for (const [key, jud] of Object.entries(judgements)) {
    if (!isCandidate(jud)) continue;
    const def = defs[key] || {};
    const merged = { ...def, ...jud };
    const missingItems = listMissingEvidence(key, evidenceChecklist);
    const revenue = estimateMonthlyRevenue(merged, judgeResult);
    const effort = estimateEffort(missingItems);
    const priorityHint = merged.priority_hint || null;
    const priority = computePriority({ revenuePerMonth: revenue, effort, priorityHint });
    recommendations.push({
      kasan_key: key,
      kasan_name: jud.name || def.name || key,
      algorithm_judgement: jud.algorithm_judgement,
      applicability: jud.applicability || 'applicable',
      missing_evidence: missingItems,
      revenue_per_month_yen: revenue,
      effort_score: Number(effort.toFixed(1)),
      priority_score: priority,
      priority_hint: priorityHint,
      unit_per_day: merged.unit_per_day || null,
      unit_per_month: merged.unit_per_month || null,
      unit_type: merged.unit_type || null,
      rationale: buildRationale({ revenue, effort, priorityHint }),
      action_items: buildActionItems(merged, missingItems),
    });
  }
  recommendations.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
  const totalRevenuePotential = recommendations.reduce(
    (s, r) => s + (r.revenue_per_month_yen || 0),
    0,
  );
  return {
    service: judgeResult.service,
    service_month: judgeResult?.cpos_metadata?.serviceMonth || null,
    total_potential_yen_per_month: totalRevenuePotential,
    recommendation_count: recommendations.length,
    recommendations,
    assumptions: {
      yen_per_unit: DEFAULT_YEN_PER_UNIT,
      days_per_month: DEFAULT_DAYS_PER_MONTH,
      note: '地域単価・実稼働日数・対象利用者比率により実際の収益は前後します。あくまで意思決定の優先順位付けの参考値です。',
    },
  };
}

function buildRationale({ revenue, effort, priorityHint }) {
  const parts = [];
  if (revenue) parts.push(`概算 ${Math.round(revenue).toLocaleString('ja-JP')}円/月`);
  if (effort > 1) parts.push(`未充足要件 ${effort - 1} 件`);
  if (priorityHint) parts.push(`マスタ評価: ${priorityHint}`);
  if (parts.length === 0) parts.push('要件が一つ満たせば取得可能性が高い');
  return parts.join(' / ');
}
