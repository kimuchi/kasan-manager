// CPOS の analysis-source レスポンスを、加算マネージャの判定エンジン入力に変換する。
//
// 出力（指示書 §5.3）:
//   - tenant_status:  judge.run() に渡す事業所ステータス（既存形式）
//   - staff_data:     dsl.buildFactsFromStaffData() 互換
//   - user_summary:   dsl.buildFactsFromUserSummary() 互換
//   - claim_evidence: judge.run({ inlineEvidence: ... }) に渡す PDF evidence 互換
//   - metadata:       レポート整形用の補助情報（CPOS 由来であることなど）
//
// 既存エンジン（app/src/services/judge.js / dsl.js / markdown-report.js）を変更せず、
// 入力ファクトの dotted-key 名を既存実装と完全一致させることが重要。

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const MAPPING_PATH = path.join(PROJECT_ROOT, 'regulatory_master', 'mapping', 'cpos_addon_mapping.json');

let cachedMapping = null;

export async function loadAddonMapping() {
  if (cachedMapping) return cachedMapping;
  if (!existsSync(MAPPING_PATH)) {
    cachedMapping = { mappings: [] };
    return cachedMapping;
  }
  const raw = await readFile(MAPPING_PATH, 'utf-8');
  cachedMapping = JSON.parse(raw);
  return cachedMapping;
}

// CPOS の addOnKey / addOnName / serviceCode のいずれかから、加算マネージャの kasan_key を解決する。
// 解決できなければ null。
export function resolveKasanKey(mapping, { serviceKey, addOnKey, addOnName, serviceCode }) {
  const candidates = (mapping.mappings || []).filter((m) => m.service_key === serviceKey);
  if (addOnKey) {
    const hit = candidates.find((m) => (m.cpos_addon_keys || []).includes(addOnKey));
    if (hit) return { kasanKey: hit.kasan_key, confidence: hit.confidence || 'unknown', via: 'cpos_addon_key' };
  }
  if (serviceCode) {
    const hit = candidates.find((m) => (m.service_code_patterns || []).some((p) => String(serviceCode).startsWith(p)));
    if (hit) return { kasanKey: hit.kasan_key, confidence: hit.confidence || 'unknown', via: 'service_code' };
  }
  if (addOnName) {
    const hit = candidates.find((m) => (m.aliases || []).includes(addOnName));
    if (hit) return { kasanKey: hit.kasan_key, confidence: hit.confidence || 'unknown', via: 'alias' };
  }
  return null;
}

// /api/platform/kasan/export と /api/kasan/v1/analysis-source のスキーマ差異を吸収する。
// - analysis-source は schemaVersion=1.0、claimSummary.currentAddOnCounts
// - platform/kasan/export は formatVersion=1、claimSummary.currentKasanCounts
// toEngineInputs は前者を前提にしているため、export 形式が来たらこの関数で変換する。
export function normalizeCposAnalysisPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.schemaVersion) return payload;
  if (payload.formatVersion) {
    return {
      schemaVersion: '1.0',
      organizationId: payload.organizationId,
      facility: payload.facility,
      serviceMonth: payload.serviceMonth,
      serviceKey: payload.serviceKey,
      privacy: { includePii: false, userIdentifierType: 'anonymousUserKey' },
      userSummary: payload.userSummary || {},
      staffSummary: payload.staffSummary || {},
      claimSummary: {
        ...(payload.claimSummary || {}),
        currentAddOnCounts:
          payload.claimSummary?.currentAddOnCounts ||
          payload.claimSummary?.currentKasanCounts ||
          {},
      },
      provisionSummary: payload.provisionSummary || payload.benefitManagementSummary || {},
      recordsSummary: payload.recordsSummary || {},
      dataCompleteness: payload.dataCompleteness || {},
      warnings: payload.warnings || [],
    };
  }
  return payload;
}

// CPOS service_type_code → 加算マネージャ service_key の推定（fallback）
const SERVICE_TYPE_CODE_TO_KEY = {
  15: 'tsusho_kaigo',
  11: 'houmon_kaigo',
  43: 'kyotaku_shien',
  13: 'houmon_kango_kaigo',
};

export function inferServiceKey(facility) {
  if (!facility) return null;
  const code = (facility.serviceTypeCodes || [])[0];
  if (!code) return null;
  return SERVICE_TYPE_CODE_TO_KEY[String(code)] || null;
}

// ─────────────────────────────────────────────────────────────────────
// 個別変換ヘルパー
// ─────────────────────────────────────────────────────────────────────

// userSummary → 既存 user_summary.json 互換 facts
function transformUserSummary(serviceKey, src = {}) {
  const cl = src.careLevelDistribution || {};

  const distribution = {};
  // CPOS の `care3` キーを user_summary.json の `youkaigo_3` 等に正規化
  const KEY_MAP = {
    support1: 'youshien_1',
    support2: 'youshien_2',
    care1: 'youkaigo_1',
    care2: 'youkaigo_2',
    care3: 'youkaigo_3',
    care4: 'youkaigo_4',
    care5: 'youkaigo_5',
  };
  for (const [k, v] of Object.entries(cl)) {
    const mapped = KEY_MAP[k] || k;
    distribution[mapped] = v;
  }

  const sum = (...keys) => keys.reduce((acc, k) => acc + (Number(distribution[k]) || 0), 0);
  const total = src.activeUserCount ?? Object.values(distribution).reduce((a, b) => a + (Number(b) || 0), 0);
  const care3plus = src.care3PlusCount ?? sum('youkaigo_3', 'youkaigo_4', 'youkaigo_5');
  const care3plusRatio =
    src.care3PlusRatio != null ? src.care3PlusRatio : total > 0 ? Math.round((care3plus / total) * 10000) / 10000 : null;
  const care4plus = sum('youkaigo_4', 'youkaigo_5');

  return {
    office_code: null,
    service_key: serviceKey,
    schema_version: 'cpos-analysis-source-v1',
    sample_policy: 'public_demo_synthetic', // dsl.buildFactsFromUserSummary が読む安全弁
    data_source_type: 'cpos_aggregate',
    source_status: 'cpos_aggregate_unverified',
    target_period: src.targetPeriod || {},
    users_total: total,
    care_level_distribution: distribution,
    care_level_3_or_higher_count: care3plus,
    care_level_3_or_higher_ratio: care3plusRatio,
    care_level_4_or_higher_count: care4plus,
    care_level_4_or_higher_ratio: total > 0 ? Math.round((care4plus / total) * 10000) / 10000 : null,
    notes: ['CPOS analysis-source から取得（PII 非含有・集計値のみ）'],
  };
}

// staffSummary → 既存 staff_data.json 互換
// 注意: dsl.buildFactsFromStaffData は staff[] 配列を要求するため、CPOS の集計値から
// 最小限の合成 staff[] を組み立てる（個人情報は持たず、profession 別の役割のみ）。
function transformStaffSummary(serviceKey, src = {}) {
  const counts = src.qualifiedPersonCountByProfession || {};
  const fte = src.fteByProfession || {};
  const PROFESSION_TO_ROLE = {
    nurse: 'kango',
    assistant_nurse: 'kango',
    care_worker: 'kaigo',
    physical_therapist: 'rihabilitation',
    occupational_therapist: 'rihabilitation',
    speech_therapist: 'rihabilitation',
    care_manager: 'cm',
    chief_care_manager: 'shunin_cm',
  };
  const PROFESSION_TO_QUAL = {
    nurse: '看護師',
    assistant_nurse: '准看護師',
    care_worker: '介護福祉士',
    physical_therapist: '理学療法士',
    occupational_therapist: '作業療法士',
    speech_therapist: '言語聴覚士',
    care_manager: '介護支援専門員',
    chief_care_manager: '主任介護支援専門員',
    registered_dietitian: '管理栄養士',
    dietitian: '栄養士',
    dental_hygienist: '歯科衛生士',
  };

  const staff = [];
  let idx = 0;
  for (const [prof, count] of Object.entries(counts)) {
    const n = Number(count) || 0;
    if (n <= 0) continue;
    const role = PROFESSION_TO_ROLE[prof] || 'kaigo';
    const qual = PROFESSION_TO_QUAL[prof] || prof;
    const totalFte = Number(fte[prof] || 0);
    const fteEach = n > 0 ? Math.round((totalFte / n) * 10000) / 10000 : 0;
    for (let i = 0; i < n; i += 1) {
      idx += 1;
      staff.push({
        staff_id: `CPOS-${prof}-${idx}`,
        display_label: `（CPOS集計合成 ${prof} #${i + 1}）`,
        role,
        qualifications: [qual],
        fte: fteEach || (totalFte && i === 0 ? totalFte : 0),
        active: true,
        is_joukin: fteEach >= 1,
      });
    }
  }

  return {
    office_code: null,
    service_key: serviceKey,
    schema_version: 'cpos-analysis-source-v1',
    sample_policy: 'public_demo_synthetic',
    policy_notes: ['CPOS の qualifiedPersonCountByProfession / fteByProfession から合成'],
    staff,
    notes: ['CPOS analysis-source 由来。氏名・staff_id 等の PII は含みません'],
    has_external_pt_ot_st: Boolean(src.hasExternalPtOtSt),
  };
}

// claimSummary → judge.run({ inlineEvidence }) 互換の receipt evidence を生成
function transformClaimSummary(serviceKey, src = {}, mapping) {
  const counts = src.currentAddOnCounts || {};
  const ratios = src.currentAddOnRatios || {};
  const remappedCounts = {};
  const remappedRatios = {};
  const unmapped = [];

  for (const [addOnKey, count] of Object.entries(counts)) {
    const resolved = resolveKasanKey(mapping, { serviceKey, addOnKey });
    if (resolved) {
      remappedCounts[resolved.kasanKey] = (remappedCounts[resolved.kasanKey] || 0) + Number(count || 0);
      if (ratios[addOnKey] != null) remappedRatios[resolved.kasanKey] = ratios[addOnKey];
    } else {
      unmapped.push(addOnKey);
    }
  }

  return {
    _meta: {
      schema: 'evidence',
      schema_version: '1.2',
      source: 'cpos.analysis-source',
    },
    evidence: [
      {
        evidence_id: `cpos_${serviceKey}_${Date.now()}`,
        service_key: serviceKey,
        source_type: 'cpos_analysis_source',
        source_file_name: 'CPOS billing API',
        extracted_at: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
        extraction_version: 'cpos-analysis-source-v1',
        detected_claim_status: 'cpos_billing_summary',
        detection_scope: 'aggregated_addon_counts_only',
        not_detected_policy: 'CPOS で集計されていない加算は「未算定」を意味しません',
        requirement_policy: 'CPOS 集計は算定中の推定であり、要件充足確認は別途必要',
        pii_policy: { policy_note: 'CPOS から匿名・集計データとして取得' },
        total_users_estimated: 0,
        current_kasan_counts: remappedCounts,
        current_kasan_ratios: remappedRatios,
        unmapped_cpos_addons: unmapped,
        warnings: [
          ...(src.warnings || []),
          ...(unmapped.length
            ? [`CPOS の addOnKey ${unmapped.length} 件はマッピング未登録（regulatory_master/mapping/cpos_addon_mapping.json に追加してください）`]
            : []),
        ],
        extraction_confidence: 'medium',
        service_code_mapping_status: 'cpos_authoritative',
        service_code_mapping_source: 'CPOS /api/billing/v1/addon-summary',
        pattern_confidence_note: 'CPOS から正規化された請求明細サマリ',
      },
    ],
  };
}

// dataCompleteness / warnings → tenant_status.inquiry に変換
// 既存 markdown レンダラの「3. 確認待ち項目」「すぐ確認すべき項目」に出る形に整形
function transformInquiry(payload) {
  const dc = payload.dataCompleteness || {};
  const remaining = [];
  const labelMap = {
    facility: '事業所マスタ',
    users: '利用者マスタ',
    staffing: '常勤換算',
    qualifiedPersons: '有資格者名簿',
    billing: '請求明細',
    provision: '給付管理',
    records: '記録',
  };
  let id = 1;
  for (const [k, v] of Object.entries(dc)) {
    if (v === 'missing' || v === 'partial') {
      remaining.push({
        id: `CPOS-${id++}`,
        item: `${labelMap[k] || k}: ${v === 'missing' ? '未登録' : '一部登録'}`,
        status: v === 'missing' ? 'unknown' : 'waiting',
        linked_kasan_req: null,
      });
    }
  }
  return { remaining_5_items: remaining.slice(0, 5) };
}

// ─────────────────────────────────────────────────────────────────────
// メインエントリ
// ─────────────────────────────────────────────────────────────────────

export async function toEngineInputs(analysisSource, { mapping = null } = {}) {
  const usedMapping = mapping || (await loadAddonMapping());

  const facility = analysisSource.facility || {};
  const serviceKey = inferServiceKey(facility) || analysisSource.serviceKey || null;
  if (!serviceKey) {
    throw new Error(
      'CPOS analysis-source から service_key を推定できませんでした（facility.serviceTypeCodes が空？）',
    );
  }

  const userSummary = transformUserSummary(serviceKey, analysisSource.userSummary || {});
  const staffData = transformStaffSummary(serviceKey, analysisSource.staffSummary || {});
  const claimEvidence = transformClaimSummary(serviceKey, analysisSource.claimSummary || {}, usedMapping);

  // tenant_status は最低限の枠だけ。inquiry にデータ完全性を載せて、レポートに見せる。
  const tenantStatus = {
    office_code: facility.id || null,
    service_key: serviceKey,
    status_version: 'cpos-analysis-source-v1',
    sample_policy: 'cpos_synthetic_aggregate',
    facts: {},
    requirement_status: {},
    notes: ['CPOS analysis-source から取得（dataCompleteness は inquiry に載せています）'],
    inquiry: transformInquiry(analysisSource),
  };

  return {
    service_key: serviceKey,
    facility,
    serviceMonth: analysisSource.serviceMonth,
    tenant_status: tenantStatus,
    staff_data: staffData,
    user_summary: userSummary,
    claim_evidence: claimEvidence,
    metadata: {
      source: 'cpos.analysis-source',
      schemaVersion: analysisSource.schemaVersion,
      organizationId: analysisSource.organizationId,
      facilityId: facility.id,
      facilityName: facility.name,
      serviceMonth: analysisSource.serviceMonth,
      includePii: Boolean(analysisSource.privacy?.includePii),
      dataCompleteness: analysisSource.dataCompleteness || {},
      warnings: analysisSource.warnings || [],
      claimSummaryWarnings: analysisSource.claimSummary?.warnings || [],
      provisionSummaryWarnings: analysisSource.provisionSummary?.warnings || [],
      staffSummaryWarnings: analysisSource.staffSummary?.warnings || [],
      recordsSummary: analysisSource.recordsSummary || null,
      provisionSummary: analysisSource.provisionSummary || null,
      hasExternalPtOtSt: Boolean(analysisSource.staffSummary?.hasExternalPtOtSt),
    },
  };
}
