// CPOS API レスポンスの型情報と最小限のバリデーション
// 厳密なスキーマ検証は ajv 等を導入せず、必要最小限のチェックだけ行う。

/**
 * @typedef {object} BootstrapResponse
 * @property {boolean} connected
 * @property {{ baseUrl: string, apiVersion: string, serverTime: string }} cpos
 * @property {{ userId: string, email?: string, name?: string, role?: string, permissions?: string[] }} user
 * @property {{ organizationId: string, name?: string }} organization
 * @property {Array<{ id: string, name?: string, businessNumber?: string, serviceTypeCodes?: string[] }>} facilities
 * @property {Record<string, boolean>} [features]
 */

/**
 * @typedef {object} AnalysisSourceResponse
 * @property {string} schemaVersion
 * @property {string} organizationId
 * @property {{ id: string, name?: string, businessNumber?: string, serviceTypeCodes?: string[], facilityCategoryCode?: string, regionClass?: string }} facility
 * @property {string} serviceMonth - YYYY-MM
 * @property {{ includePii: boolean, userIdentifierType?: string }} [privacy]
 * @property {{ activeUserCount?: number, careLevelDistribution?: Record<string, number>, care3PlusCount?: number, care3PlusRatio?: number, newUsersInMonth?: number, endedUsersInMonth?: number }} [userSummary]
 * @property {{ qualifiedPersonCountByProfession?: Record<string, number>, fteByProfession?: Record<string, number>, hasExternalPtOtSt?: boolean, warnings?: string[] }} [staffSummary]
 * @property {{ source?: string, claimStatementsCount?: number, totalUnits?: number, currentAddOnCounts?: Record<string, number>, currentAddOnUnits?: Record<string, number>, warnings?: string[] }} [claimSummary]
 * @property {{ recordsCount?: number, limitUnitsTotal?: number, plannedUnitsTotal?: number, actualUnitsTotal?: number, overLimitUserCount?: number, warnings?: string[] }} [provisionSummary]
 * @property {{ recordsCount?: number, recordTypeCounts?: Record<string, number>, evidenceSignals?: Record<string, number>, warnings?: string[] }} [recordsSummary]
 * @property {Record<string, 'complete' | 'partial' | 'missing'>} [dataCompleteness]
 * @property {string[]} [warnings]
 */

const SUPPORTED_SCHEMA_VERSIONS = new Set(['1.0']);

export function validateBootstrap(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('bootstrap: 空のレスポンス');
  if (typeof payload.connected !== 'boolean') throw new Error('bootstrap: connected が boolean ではありません');
  if (!payload.user) throw new Error('bootstrap: user フィールドがありません');
  if (!Array.isArray(payload.facilities)) throw new Error('bootstrap: facilities が配列ではありません');
  return payload;
}

export function validateAnalysisSource(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('analysis-source: 空のレスポンス');
  if (typeof payload.schemaVersion !== 'string') {
    throw new Error('analysis-source: schemaVersion がありません');
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.has(payload.schemaVersion)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[cpos] 警告: 想定外の schemaVersion=${payload.schemaVersion}（サポート: ${[...SUPPORTED_SCHEMA_VERSIONS].join(',')}）`,
    );
  }
  if (!payload.facility?.id) throw new Error('analysis-source: facility.id がありません');
  if (!payload.serviceMonth) throw new Error('analysis-source: serviceMonth がありません');
  return payload;
}

export function isSupportedSchemaVersion(version) {
  return SUPPORTED_SCHEMA_VERSIONS.has(String(version));
}
