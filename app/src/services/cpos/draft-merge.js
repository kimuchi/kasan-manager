// 解析ドラフトの純合算ロジック（保存先非依存）。
// 旧 drafts.js から「少しずつ取込んだ匿名集計の合算」と「draft → analysis_source 互換バンドル化」を切り出し。
// CPOS app-data に保存する draft.data に対して動く。

import { mergeUserSummaries, mergeStaffSummaries } from '../../../public/local/aggregate.js';
import { summarizeForStorage } from '../anonymize.js';

// 2 つの claimEvidence をマージ（current_kasan_counts を加算し単一エントリに集約）
export function mergeClaimEvidence(a, b) {
  const entries = [...(a?.evidence || []), ...(b?.evidence || [])];
  if (!entries.length) return a || b || null;
  const counts = {};
  const codes = new Set();
  let totalPages = 0;
  for (const e of entries) {
    for (const [k, v] of Object.entries(e.current_kasan_counts || {})) {
      counts[k] = (counts[k] || 0) + Number(v || 0);
    }
    for (const c of e.detected_service_codes || []) codes.add(c);
    totalPages += Number(e.total_pages || e.total_users_estimated || 0);
  }
  const base = entries[0];
  return {
    _meta: a?._meta || b?._meta || { schema: 'evidence', schema_version: '1.2' },
    evidence: [
      {
        ...base,
        current_kasan_counts: counts,
        detected_service_codes: [...codes].sort(),
        total_pages: totalPages,
        merged_entry_count: entries.length,
      },
    ],
  };
}

// 既存 draft.data に新しい匿名バンドルを合算した「新しい draft.data」を返す（純関数）。
export function mergeDraftData(curData = {}, bundle = {}) {
  const safe = summarizeForStorage(bundle);
  const userSummary = mergeUserSummaries([curData.userSummary, safe.userSummary].filter(Boolean));
  const staffSummary = mergeStaffSummaries([curData.staffSummary, safe.staffSummary].filter(Boolean));
  const claimEvidence = mergeClaimEvidence(curData.claimEvidence, safe.claimEvidence);

  const fileTypeCounts = { ...(curData.fileTypeCounts || {}) };
  for (const [k, v] of Object.entries(safe.fileTypeCounts || {})) {
    fileTypeCounts[k] = (fileTypeCounts[k] || 0) + Number(v || 0);
  }
  const warnings = Array.from(new Set([...(curData.warnings || []), ...(safe.warnings || [])])).slice(0, 50);

  return {
    label: curData.label || '作業中の解析',
    serviceKey: curData.serviceKey || safe.serviceKey || null,
    serviceMonth:
      curData.serviceMonth || (safe.serviceMonth && /^\d{4}-\d{2}$/.test(safe.serviceMonth) ? safe.serviceMonth : null),
    facilityId: curData.facilityId || safe.facilityId || null,
    userSummary: userSummary || null,
    staffSummary: staffSummary || null,
    claimEvidence: claimEvidence || null,
    fileTypeCounts,
    warnings,
    contributedCount: (curData.contributedCount || 0) + 1,
    // PR-4: 再判定差分のため、前回分類・追加提出元を合算後も保持する
    last_classification: curData.last_classification || null,
    last_analysis_at: curData.last_analysis_at || null,
    followup_of: curData.followup_of || null,
    // PR-3: 手入力の仮データ由来フラグ（請求OKに倒さないため、合算後も保持）
    manual_quick_input: curData.manual_quick_input || safe.manual_quick_input || null,
  };
}

// draft.data → /api/analyze/from-local が受け取る analysis_source 互換バンドル。
export function draftToBundle(draftData = {}, { facility = null } = {}) {
  const fac = { id: facility?.id || draftData.facilityId || 'local' };
  if (facility?.name) fac.name = String(facility.name);
  return {
    schemaVersion: '1.0',
    organizationId: 'local-pro',
    facility: fac,
    serviceMonth: draftData.serviceMonth || null,
    serviceKey: draftData.serviceKey || null,
    userSummary: draftData.userSummary || undefined,
    staffSummary: draftData.staffSummary || undefined,
    claimEvidence: draftData.claimEvidence || undefined,
    dataCompleteness: {
      billing: draftData.claimEvidence ? 'partial' : 'missing',
      users: draftData.userSummary ? 'partial' : 'missing',
      staffing: draftData.staffSummary ? 'partial' : 'missing',
    },
    warnings: ['プロ・ドラフトから実行（少しずつ取込んだ集計値）', ...(draftData.warnings || [])],
    fileTypeCounts: draftData.fileTypeCounts || {},
    manual_quick_input: draftData.manual_quick_input || undefined,
  };
}
