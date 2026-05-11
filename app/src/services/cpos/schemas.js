// CPOS API レスポンスの型情報とバリデーション
//
// 正規スキーマ schemas/analysis_source.schema.json に対して Ajv で検証する。
// 未対応 schemaVersion は警告のみ・互換 best-effort。

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const ANALYSIS_SOURCE_SCHEMA_PATH = path.join(PROJECT_ROOT, 'schemas', 'analysis_source.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

let analysisSourceValidator = null;

function loadAnalysisSourceValidator() {
  if (analysisSourceValidator) return analysisSourceValidator;
  if (!existsSync(ANALYSIS_SOURCE_SCHEMA_PATH)) {
    // フォールバック: schema ファイルがない環境では緩い検証だけ行う
    analysisSourceValidator = (data) => {
      if (!data || typeof data !== 'object') return false;
      if (typeof data.schemaVersion !== 'string') return false;
      if (!data.facility?.id) return false;
      if (!data.serviceMonth) return false;
      analysisSourceValidator.errors = null;
      return true;
    };
    return analysisSourceValidator;
  }
  const schema = JSON.parse(readFileSync(ANALYSIS_SOURCE_SCHEMA_PATH, 'utf-8'));
  analysisSourceValidator = ajv.compile(schema);
  return analysisSourceValidator;
}

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
  const validate = loadAnalysisSourceValidator();
  const ok = validate(payload);
  if (!ok) {
    const detail = (validate.errors || [])
      .slice(0, 5)
      .map((e) => `${e.instancePath || '$'}: ${e.message}`)
      .join('; ');
    throw new Error(`analysis-source: スキーマ違反 (${detail})`);
  }
  return payload;
}

export function isSupportedSchemaVersion(version) {
  return SUPPORTED_SCHEMA_VERSIONS.has(String(version));
}

// dataCompleteness から warnings 互換の警告を派生させる（mapping_warnings 出力用）
export function deriveCompletenessWarnings(payload) {
  const dc = payload?.dataCompleteness || {};
  const labelMap = {
    facility: '事業所マスタ',
    users: '利用者マスタ',
    staffing: '常勤換算',
    qualifiedPersons: '有資格者名簿',
    billing: '請求明細',
    provision: '給付管理',
    records: '記録',
  };
  const warnings = [];
  for (const [k, v] of Object.entries(dc)) {
    const label = labelMap[k] || k;
    if (v === 'missing') warnings.push(`${label}: 未登録（影響する加算は判定保留）`);
    else if (v === 'partial') warnings.push(`${label}: 一部のみ登録（一部要件は確認が必要）`);
  }
  return warnings;
}
