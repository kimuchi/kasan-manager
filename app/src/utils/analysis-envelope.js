// 加算分析レスポンスの共通エンベロープ。
// /api/judge / /api/analyze/from-cpos / /api/cpos/facility/analyze で同じキーで返す。
//
// - analysis_id: 1 回の解析実行を識別する UUID。今後 Firestore/GCS 永続化や
//   review_decision を紐付けるためのキーとして使う。
// - source_type: 'cpos_analysis_source' | 'cpos_kasan_export' | 'manual_pdf' | 'manual_inputs' | 'local_engine'
// - mapping_warnings: cpos_addon_mapping から漏れた addOnKey や
//   dataCompleteness=missing/partial 由来の警告を集約。
// - review_status: 'draft' | 'awaiting_review' | 'approved' | 'returned'
//   現状は常に 'draft'。reviewer UI は P2 で実装。

import { randomUUID } from 'node:crypto';

export function buildAnalysisEnvelope({ sourceType, cposMetadata = null, extraWarnings = [] } = {}) {
  const warnings = [];
  if (cposMetadata) {
    if (Array.isArray(cposMetadata.warnings)) warnings.push(...cposMetadata.warnings);
    if (Array.isArray(cposMetadata.claimSummaryWarnings)) warnings.push(...cposMetadata.claimSummaryWarnings);
    if (Array.isArray(cposMetadata.staffSummaryWarnings)) warnings.push(...cposMetadata.staffSummaryWarnings);
    if (Array.isArray(cposMetadata.provisionSummaryWarnings)) warnings.push(...cposMetadata.provisionSummaryWarnings);
  }
  for (const w of extraWarnings) warnings.push(w);
  // 重複排除
  const dedup = [];
  const seen = new Set();
  for (const w of warnings) {
    const s = String(w);
    if (!seen.has(s)) {
      seen.add(s);
      dedup.push(s);
    }
  }
  return {
    analysis_id: randomUUID(),
    source_type: sourceType,
    review_status: 'draft',
    mapping_warnings: dedup,
  };
}
