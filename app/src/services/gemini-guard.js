// P0-3: Gemini 出力ガード。
//
// AI（Gemini）の候補・増収見込みを、決定的判定（result-classifier）に従属させる。
// 「請求してよい(can_bill_now)」は決定的に billable_now のものだけ許可し、
// 計算式の無い増収は必ず「未算出」に落とす。AIに確定判定を上書きさせない。

const ALLOWED_STATUS = new Set([
  'deterministic_clear',
  'claimed_evidence_risk',
  'needs_data',
  'ai_general_candidate',
  'not_recommended',
]);

function mapBucketToAiStatus(bucket) {
  switch (bucket) {
    case 'billable_now':
      return 'deterministic_clear';
    case 'claimed_evidence_risk':
      return 'claimed_evidence_risk';
    case 'almost_ready':
    case 'needs_more_data':
      return 'needs_data';
    case 'not_recommended':
      return 'not_recommended';
    default:
      return 'ai_general_candidate';
  }
}

function guardRevenue(rev) {
  const r = rev && typeof rev === 'object' ? { ...rev } : {};
  if (!Array.isArray(r.assumptions)) r.assumptions = [];
  // 計算式（対象者数・単位数・地域単価等）が無ければ金額を断定させない
  if (!r.calculation_formula || typeof r.calculation_formula !== 'string' || !r.calculation_formula.trim()) {
    r.calculation_formula = r.calculation_formula || null;
    r.confidence = 'not_calculable';
    r.amount_text = '未算出（必要データ不足）';
  }
  return r;
}

// analysis: Gemini が返した構造化JSON。meta: { classification, classificationSummary }
export function guardGeminiAnalysis(analysis, { classification = {}, classificationSummary = {} } = {}) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const deterministicClearCount = classificationSummary.billable_now || 0;

  if (Array.isArray(analysis.candidates)) {
    for (const c of analysis.candidates) {
      const cls = c && c.kasan_key ? classification[c.kasan_key] : null;

      // 1) status の正規化（'ready' など禁止値は丸める）
      if (!ALLOWED_STATUS.has(c.status)) {
        c.status = cls ? mapBucketToAiStatus(cls.user_visible_bucket) : 'ai_general_candidate';
      }

      // 2) deterministic_clear を名乗れるのは決定的に billable のときだけ
      if (c.status === 'deterministic_clear' && (!cls || cls.billable_now !== true)) {
        c.status = cls ? mapBucketToAiStatus(cls.user_visible_bucket) : 'ai_general_candidate';
      }

      // 3) can_bill_now は決定的判定に従属（指示書 §5.3）
      if (c.can_bill_now === true && (!cls || cls.billable_now !== true)) {
        c.can_bill_now = false;
        c.must_not_bill_reason =
          (cls && cls.reason_short) || '決定的判定で請求可否を確認できていません（追加データが必要）';
      }
      if (typeof c.can_bill_now !== 'boolean') c.can_bill_now = false;

      // 4) basis_level / missing_data_requests の既定値
      if (!['deterministic', 'inferred', 'general_knowledge'].includes(c.basis_level)) {
        c.basis_level = cls ? 'inferred' : 'general_knowledge';
      }
      if (!Array.isArray(c.missing_data_requests)) c.missing_data_requests = [];

      // 5) 増収見込み（計算式が無ければ未算出に固定）
      c.revenue_estimate = guardRevenue(c.revenue_estimate);

      // 6) AI一般提案は請求判断不可を明示
      if (c.status === 'ai_general_candidate') {
        c.can_bill_now = false;
        if (!c.must_not_bill_reason) c.must_not_bill_reason = 'AIの一般知識に基づく提案で、請求判断には使えません';
      }
    }
  }

  // 7) 総増収: 決定的 clear が0件なら金額を断定しない
  if (deterministicClearCount === 0) {
    analysis.estimated_total_revenue_increase =
      '未算出（請求OKと確認できた加算がありません。追加データ取得後に再算定してください）';
  }

  return analysis;
}
