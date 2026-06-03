// 加算ごとの算定対象者数を user_summary から計算する。
//
// regulatory_master/target_user_filters.json の predicate を評価して、
// その加算に該当する利用者数（概算）を返す。
//
// 評価優先順位:
//   1. predicate が user_summary の構造化フィールドに対応していれば、その値を使う
//   2. estimated_ratio:F 形式なら users_total × F
//   3. 未定義 / 評価不可なら users_total（全員と仮定）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILTERS_PATH = path.resolve(
  __dirname,
  '../../../regulatory_master/target_user_filters.json',
);

let cached = null;
function loadFilters() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(FILTERS_PATH, 'utf-8');
    cached = JSON.parse(raw);
  } catch (err) {
    console.warn(`[target-user-filter] load failed: ${err.message}`);
    cached = { filters: {} };
  }
  return cached;
}

export function getFilter(kasanKey) {
  const t = loadFilters();
  return t.filters?.[kasanKey] || { predicate: 'all', rationale: '（フィルタ未定義 / 全員と仮定）' };
}

const DEMENTIA_RANK = { I: 1, IIa: 2, IIb: 3, IIIa: 4, IIIb: 5, IV: 6, M: 7 };

function sumCareLevelAtOrAbove(distribution, minN) {
  if (!distribution || typeof distribution !== 'object') return null;
  let sum = 0;
  let matched = false;
  for (let n = Math.max(1, minN); n <= 5; n += 1) {
    const v = distribution[`youkaigo_${n}`];
    if (typeof v === 'number') {
      sum += v;
      matched = true;
    }
  }
  return matched ? sum : null;
}

function sumDementiaAtOrAbove(distribution, minLevel) {
  if (!distribution || typeof distribution !== 'object') return null;
  const minRank = DEMENTIA_RANK[minLevel];
  if (!minRank) return null;
  let sum = 0;
  let matched = false;
  for (const [k, v] of Object.entries(distribution)) {
    const rank = DEMENTIA_RANK[k];
    if (rank && rank >= minRank && typeof v === 'number') {
      sum += v;
      matched = true;
    }
  }
  return matched ? sum : null;
}

// userSummary は user_summary_display か user_summary オブジェクトを期待。
// 戻り値: { count: number, source: 'all'|'care_level'|'dementia'|'field'|'estimated'|'fallback', rationale: string }
export function evalTargetUserCount(kasanKey, userSummary) {
  const filter = getFilter(kasanKey);
  const pred = String(filter.predicate || 'all');
  const usersTotal = userSummary?.users_total || 0;
  // すべての枝で usersTotal=0 ならゼロを返す
  if (!usersTotal) return { count: 0, source: 'none', rationale: 'user_summary が未取得 / users_total=0' };

  if (pred === 'all') {
    return { count: usersTotal, source: 'all', rationale: filter.rationale || '全員対象' };
  }
  let m;
  if ((m = pred.match(/^care_level_min:(\d)$/))) {
    const n = Number(m[1]);
    // ショートカット用のサマリ統計を優先
    if (n === 3 && typeof userSummary.care_level_3_or_higher_count === 'number') {
      return {
        count: userSummary.care_level_3_or_higher_count,
        source: 'field',
        rationale: filter.rationale || `要介護${n}以上`,
      };
    }
    if (n === 4 && typeof userSummary.care_level_4_or_higher_count === 'number') {
      return {
        count: userSummary.care_level_4_or_higher_count,
        source: 'field',
        rationale: filter.rationale || `要介護${n}以上`,
      };
    }
    const v = sumCareLevelAtOrAbove(userSummary.care_level_distribution, n);
    if (v != null) return { count: v, source: 'care_level', rationale: filter.rationale || `要介護${n}以上` };
  }
  if ((m = pred.match(/^dementia_min:([\w]+)$/))) {
    const v = sumDementiaAtOrAbove(userSummary.dementia_care_level_distribution, m[1]);
    if (v != null) return { count: v, source: 'dementia', rationale: filter.rationale || `認知症${m[1]}以上` };
  }
  const FIELD_PREDICATES = {
    dementia_related: 'dementia_related_count',
    medical_dependency: 'medical_dependency_count',
    terminal: 'terminal_care_related_count',
    discharge_support: 'discharge_support_related_count',
    emergency_response: 'emergency_response_related_count',
  };
  if (pred in FIELD_PREDICATES) {
    const field = FIELD_PREDICATES[pred];
    const v = userSummary[field];
    if (typeof v === 'number') return { count: v, source: 'field', rationale: filter.rationale || pred };
  }
  if ((m = pred.match(/^estimated_ratio:([0-9.]+)$/))) {
    const ratio = Number(m[1]);
    return {
      count: Math.round(usersTotal * ratio),
      source: 'estimated',
      rationale: filter.rationale || `推定比率 ${ratio}`,
    };
  }
  // 評価不能 → 全員にフォールバック（保守的に多めに見積もる）
  return { count: usersTotal, source: 'fallback', rationale: '対応するデータ無し / 全員と仮定' };
}
