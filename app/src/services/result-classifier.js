// P0-1: 判定結果の安全な正規化層。
//
// judge.js / dsl.js が返す内部ステータス（clear / waiting / currently_claimed /
// claimed_but_requirements_unknown / blocked_by_missing_evidence / not_evaluated_* / ...）は
// 表現が細かく、UI・AI・Markdown に直接渡すと「算定中」と「証跡確認済」が混ざりやすい。
//
// このモジュールは judgeResult を受け取り、各加算に「実務向けの安全な分類」を付与する。
// 最重要ルール: billable_now（請求してよい）は、公式根拠確認済みの要件がすべて満たされている
// ときだけ true。少しでも未確認・不足・保留があれば false にする。

// 内部DSLステータス → 実務向け requirement_state
function toRequirementState(dsl) {
  const s = dsl?.status;
  switch (s) {
    case 'clear':
      return 'verified_clear';
    case 'not_clear':
      return 'verified_not_clear';
    case 'partially_clear':
    case 'blocked_by_missing_evidence':
      return 'missing_evidence';
    case 'blocked_by_unverified_mapping':
      return 'mapping_held';
    case 'not_evaluated_source_required':
      return 'source_unchecked';
    case 'not_evaluated_logic_unchecked':
      return 'logic_unchecked';
    case 'not_applicable':
      return 'not_applicable';
    default:
      // unknown / logic 未登録など
      if (dsl?.logic_status === 'absent') return 'logic_unchecked';
      return 'missing_evidence';
  }
}

const REQUIREMENT_REASON = {
  verified_clear: '公式根拠確認済みの要件をすべて満たしています',
  verified_not_clear: '確認済みの要件を満たしていません（対象外の可能性）',
  missing_evidence: '判定に必要な証跡・データが不足しています',
  mapping_held: 'サービスコード照合が未完了のため保留しています',
  source_unchecked: '要件の公式根拠が未確認です',
  logic_unchecked: '要件判定ロジックが未確認です',
  not_applicable: 'このサービスでは算定対象外です',
};

// 1加算分の安全分類を作る
export function classifyKasan(kasanKey, judgement = {}, dsl = {}) {
  const algo = judgement.algorithm_judgement;
  const pdfDetected = Boolean(judgement.pdf_detected);
  const requirementState = toRequirementState(dsl);

  // 請求検出状態（PDF/CPOS等で算定中として検出されたか）
  let claimState = 'not_detected';
  if (pdfDetected || algo === 'currently_claimed' || algo === 'claimed_but_requirements_unknown') {
    claimState = 'claimed_detected';
  }

  // billable_now: 厳格条件。要件が verified_clear かつ算定可能状態のときだけ true。
  const billableNow =
    requirementState === 'verified_clear' && (algo === 'clear' || algo === 'currently_claimed');

  // 実務バケット
  let bucket;
  if (requirementState === 'not_applicable') {
    bucket = 'not_applicable';
  } else if (billableNow) {
    bucket = 'billable_now';
  } else if (claimState === 'claimed_detected') {
    // 算定中として検出されているが要件確認が取れていない＝最重要の注意対象
    bucket = 'claimed_evidence_risk';
  } else if (requirementState === 'verified_not_clear') {
    bucket = 'not_recommended';
  } else if (requirementState === 'missing_evidence' && (dsl?.progress?.gaps || []).length > 0) {
    // 数値要件まで「あと一歩」（達成度が算出できている）
    bucket = 'almost_ready';
  } else {
    // missing_evidence(数値gap無し) / mapping_held / source_unchecked / logic_unchecked
    bucket = 'needs_more_data';
  }

  // 信頼度
  let confidence;
  if (bucket === 'billable_now' || bucket === 'not_recommended') confidence = 'high';
  else if (bucket === 'claimed_evidence_risk' || bucket === 'almost_ready') confidence = 'medium';
  else confidence = 'low';

  // 次に必要なデータ（fact_path 一覧。詳細な提案は data-request.js で別途構築）
  const nextRequiredData = Array.from(
    new Set([...(dsl?.missing_evidence || []), ...(dsl?.mapping_held_conditions || [])]),
  );

  let reasonShort;
  if (bucket === 'claimed_evidence_risk') {
    reasonShort = '算定中として検出されましたが、要件充足の証跡が未確認です';
  } else if (bucket === 'almost_ready') {
    const g = (dsl.progress.gaps || [])[0];
    reasonShort = g
      ? `${g.label || g.fact}が基準に未達（達成度の確認で取得可否が固まります）`
      : '数値要件まであと一歩です';
  } else {
    reasonShort = REQUIREMENT_REASON[requirementState] || '追加確認が必要です';
  }

  return {
    kasan_key: kasanKey,
    claim_state: claimState,
    requirement_state: requirementState,
    user_visible_bucket: bucket,
    billable_now: billableNow,
    confidence,
    reason_short: reasonShort,
    next_required_data: nextRequiredData,
  };
}

const BUCKETS = [
  'billable_now',
  'claimed_evidence_risk',
  'almost_ready',
  'needs_more_data',
  'not_recommended',
  'not_applicable',
  'ai_general_candidate',
];

// judgeResult に classification / classification_summary を付与して返す（破壊的・呼び出し元で再代入も可）。
export function attachResultClassification(judgeResult) {
  if (!judgeResult || typeof judgeResult !== 'object') return judgeResult;
  const judgements = judgeResult.judgements || {};
  const dslResults = judgeResult.dsl_results || {};
  const classification = {};
  const summary = Object.fromEntries(BUCKETS.map((b) => [b, 0]));

  for (const [kasanKey, j] of Object.entries(judgements)) {
    const c = classifyKasan(kasanKey, j, dslResults[kasanKey] || {});
    classification[kasanKey] = c;
    summary[c.user_visible_bucket] = (summary[c.user_visible_bucket] || 0) + 1;
  }

  judgeResult.classification = classification;
  judgeResult.classification_summary = summary;
  return judgeResult;
}

export const USER_VISIBLE_BUCKETS = BUCKETS;
