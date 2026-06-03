// 集計結果 → クラウド送信用バンドルの組み立て（依存なし。pii.js のみ利用）。
//
// 出力は CPOS analysis-source 互換（schemaVersion 1.0）。サーバ側は
// validateAnalysisSource → normalizeCposAnalysisPayload → toEngineInputs の既存経路で処理する。
// claimEvidence はローカルのレセプト抽出（kasan_key ベース）を inlineEvidence として
// そのまま判定に使うための追加フィールド（CPOS の addOnKey 再マッピングを経由しない）。

import { assertNoPii } from './pii.js';

// 加算マネージャ service_key → CPOS service_type_code（toEngineInputs の inferServiceKey 用）
export const SERVICE_KEY_TO_TYPE_CODE = {
  tsusho_kaigo: '15',
  houmon_kaigo: '11',
  houmon_kango_kaigo: '13',
  kyotaku_shien: '43',
};

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

export function buildLocalBundle({
  office = 'local',
  organizationId = 'local',
  serviceKey,
  serviceMonth,
  userSummary = null,
  staffSummary = null,
  claimEvidence = null,
  dataCompleteness = {},
  warnings = [],
  fileTypeCounts = {},
} = {}) {
  if (!serviceKey) throw new Error('buildLocalBundle: serviceKey は必須です。');
  if (!serviceMonth || !/^\d{4}-\d{2}$/.test(String(serviceMonth))) {
    throw new Error('buildLocalBundle: serviceMonth は YYYY-MM 形式で必須です。');
  }

  const typeCode = SERVICE_KEY_TO_TYPE_CODE[serviceKey] || null;

  const bundle = {
    schemaVersion: '1.0',
    organizationId,
    facility: {
      id: String(office || 'local'),
      serviceTypeCodes: typeCode ? [typeCode] : [],
    },
    serviceMonth: String(serviceMonth),
    serviceKey,
    privacy: { includePii: false, userIdentifierType: 'anonymousUserKey' },
    userSummary: userSummary || {},
    staffSummary: staffSummary || {},
    claimSummary: { source: 'local.receipt', currentAddOnCounts: {} },
    dataCompleteness: dataCompleteness || {},
    warnings: Array.isArray(warnings) ? warnings : [],
    _local: {
      generator: 'kasan-local-engine',
      generatedAt: nowIso(),
      fileTypeCounts: fileTypeCounts || {},
    },
  };

  if (claimEvidence && Array.isArray(claimEvidence.evidence) && claimEvidence.evidence.length) {
    bundle.claimEvidence = claimEvidence;
  }

  // 送信前の防御線: 数値系 PII（被保険者番号・電話・メール等）が混入していたら中止
  assertNoPii(bundle);

  return bundle;
}
