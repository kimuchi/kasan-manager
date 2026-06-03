// ポートフォリオ最適化 PoC
//
// 目的: judge 結果のうち「あと一歩で取れる加算」を、収益 / 必要工数 / 優先度で
// ランキングし、限られたリソースの中で「次に取りに行くべき加算」を提案する。
//
// 入力: judgeResult（runJudge() の戻り値）+ 任意で region_grade
// 出力: {
//   service, service_month, total_potential_yen_per_month, recommendations: [...],
//   assumptions: { yen_per_unit, days_per_month, region_grade, ... }
// }
//
// 計算ロジック:
//   yen_per_unit  = regional-pricing.yenPerUnit(service, region_grade)
//   users_count   = target-user-filter.evalTargetUserCount(kasan_key, user_summary)
//   revenue       = unit_per_day × users_count × days_per_month × yen_per_unit
//   interaction   = interaction-hints.buildInteractionHint(...) で処遇改善連動も提示

import { yenPerUnit, normalizeGrade, describeGrade } from './regional-pricing.js';
import { evalTargetUserCount } from './target-user-filter.js';
import { buildInteractionHint } from './interaction-hints.js';

const DEFAULT_DAYS_PER_MONTH = 22; // 平均稼働日数（営業日ベース）
const EFFORT_PER_MISSING_FACT = 1;
const EFFORT_BASE = 1;

function isCandidate(jud) {
  const status = jud?.algorithm_judgement;
  if (!status) return false;
  if (jud?.applicability === 'not_applicable') return false;
  if (jud?.applicability_reason && /対象外/.test(jud.applicability_reason)) return false;
  return ['waiting', 'unknown', 'claimed_but_requirements_unknown'].includes(status);
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

function getUserSummaryBlock(judgeResult) {
  return (
    judgeResult?.user_summary_display ||
    judgeResult?.user_summary ||
    judgeResult?.cpos_metadata?.userSummary ||
    {}
  );
}

// 月額収益見積もり (円/月)
// kasanDef は judgements[key] と service_def.master.kasans[key] のマージ済オブジェクト
function estimateMonthlyRevenue({ kasanKey, kasanDef, judgeResult, yenPerUnitValue }) {
  const userSummary = getUserSummaryBlock(judgeResult);
  const targetCount = evalTargetUserCount(kasanKey, userSummary);

  const unitPerDay =
    kasanDef?.roi_estimation?.revenue_per_user_per_day || kasanDef?.unit_per_day || null;
  const unitPerMonth = kasanDef?.unit_per_month || null;
  if (!targetCount.count) return { yen: null, target_count: targetCount, days_per_month: null };

  // 月単位の加算なら日数を 1 として扱う
  const isPerMonth = Boolean(unitPerMonth) || /月/.test(String(kasanDef.unit_type || ''));
  if (isPerMonth && unitPerMonth) {
    const yen = unitPerMonth * targetCount.count * yenPerUnitValue;
    return {
      yen: Math.round(yen),
      target_count: targetCount,
      days_per_month: 1,
      unit_used: { kind: 'per_month', value: unitPerMonth },
    };
  }
  if (!unitPerDay) return { yen: null, target_count: targetCount, days_per_month: null };
  const yen = unitPerDay * targetCount.count * DEFAULT_DAYS_PER_MONTH * yenPerUnitValue;
  return {
    yen: Math.round(yen),
    target_count: targetCount,
    days_per_month: DEFAULT_DAYS_PER_MONTH,
    unit_used: { kind: 'per_day', value: unitPerDay },
  };
}

function estimateEffort(missingItems) {
  if (!Array.isArray(missingItems) || missingItems.length === 0) return EFFORT_BASE;
  let weighted = 0;
  for (const m of missingItems) {
    weighted += m.priority === '高' ? 1.5 : 1.0;
  }
  return EFFORT_BASE + weighted * EFFORT_PER_MISSING_FACT;
}

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

function buildRationale({ revenue, effort, priorityHint, targetCount }) {
  const parts = [];
  if (revenue) parts.push(`概算 ${Math.round(revenue).toLocaleString('ja-JP')}円/月`);
  if (targetCount && targetCount.count > 0) {
    parts.push(`対象 ${targetCount.count} 名（${targetCount.rationale || targetCount.source}）`);
  }
  if (effort > 1) parts.push(`未充足要件 ${Math.round((effort - 1) * 10) / 10} 件相当`);
  if (priorityHint) parts.push(`マスタ評価: ${priorityHint}`);
  if (parts.length === 0) parts.push('要件が一つ満たせば取得可能性が高い');
  return parts.join(' / ');
}

export function optimizePortfolio({ judgeResult, kasanDefs = null, regionGrade = null }) {
  if (!judgeResult || typeof judgeResult !== 'object') {
    throw new Error('judgeResult is required');
  }
  const judgements = judgeResult.judgements || {};
  const evidenceChecklist = judgeResult.evidence_checklist || [];
  const defs = kasanDefs || judgeResult?.service_def?.master?.kasans || {};
  const grade = normalizeGrade(regionGrade || judgeResult.region_grade);
  const gradeInfo = describeGrade(grade);
  const service = judgeResult.service;
  const yenPerUnitValue = yenPerUnit(service, grade);

  const recommendations = [];
  for (const [key, jud] of Object.entries(judgements)) {
    if (!isCandidate(jud)) continue;
    const def = defs[key] || {};
    const merged = { ...def, ...jud };
    const missingItems = listMissingEvidence(key, evidenceChecklist);
    const { yen: revenue, target_count: targetCount, days_per_month: daysUsed, unit_used: unitUsed } =
      estimateMonthlyRevenue({
        kasanKey: key,
        kasanDef: merged,
        judgeResult,
        yenPerUnitValue,
      });
    const effort = estimateEffort(missingItems);
    const priorityHint = merged.priority_hint || null;
    const priority = computePriority({ revenuePerMonth: revenue, effort, priorityHint });
    const interactionHint = buildInteractionHint({
      kasanKey: key,
      baseRevenuePerMonth: revenue,
      judgeResult,
    });

    recommendations.push({
      kasan_key: key,
      kasan_name: jud.name || def.name || key,
      algorithm_judgement: jud.algorithm_judgement,
      applicability: jud.applicability || 'applicable',
      missing_evidence: missingItems,
      revenue_per_month_yen: revenue,
      revenue_with_chain_yen:
        revenue && interactionHint?.bonus_yen_per_month
          ? revenue + interactionHint.bonus_yen_per_month
          : revenue,
      target_user_count: targetCount?.count ?? null,
      target_user_source: targetCount?.source ?? null,
      target_user_rationale: targetCount?.rationale ?? null,
      days_per_month: daysUsed,
      unit_used: unitUsed || null,
      effort_score: Number(effort.toFixed(1)),
      priority_score: priority,
      priority_hint: priorityHint,
      unit_per_day: merged.unit_per_day || null,
      unit_per_month: merged.unit_per_month || null,
      unit_type: merged.unit_type || null,
      rationale: buildRationale({ revenue, effort, priorityHint, targetCount }),
      action_items: buildActionItems(merged, missingItems),
      interaction_hint: interactionHint,
    });
  }
  recommendations.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
  const totalRevenuePotential = recommendations.reduce(
    (s, r) => s + (r.revenue_per_month_yen || 0),
    0,
  );
  const totalWithChain = recommendations.reduce(
    (s, r) => s + (r.revenue_with_chain_yen || r.revenue_per_month_yen || 0),
    0,
  );
  return {
    service,
    service_month: judgeResult?.cpos_metadata?.serviceMonth || null,
    region_grade: grade,
    region_grade_label: gradeInfo?.label || 'その他',
    yen_per_unit: yenPerUnitValue,
    total_potential_yen_per_month: totalRevenuePotential,
    total_with_chain_yen_per_month: totalWithChain,
    recommendation_count: recommendations.length,
    recommendations,
    assumptions: {
      yen_per_unit: yenPerUnitValue,
      region_grade: grade,
      region_grade_label: gradeInfo?.label || 'その他',
      days_per_month: DEFAULT_DAYS_PER_MONTH,
      note: '対象者数は user_summary の構造化フィールドまたは推定比率から計算しています。地域単価は service × 級地で算定。実運用での回収額は事業所固有の利用率・地域単価で前後します。',
    },
  };
}
