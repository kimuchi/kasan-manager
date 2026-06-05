// CareLinker 加算チェッカー alpha.5: 要件論理式DSL evaluator (Node.js port)
// 元実装: scripts/requirement_dsl.py

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');

export const VALID_OPS = new Set([
  '==', '!=', '>', '>=', '<', '<=',
  'exists', 'not_exists', 'in', 'not_in', 'bool_true', 'bool_false',
]);

const MAPPING_DEPENDENT_FACT_TOKENS = [
  'current_kasan_counts',
  'detected_claim_status',
  'service_code',
  'claim_item_code',
  'claimed_units',
];

const PATTERN_UNVERIFIED_NOTE =
  'evidenceの service_code_mapping_status=pattern_based_unverified を含むため、サービスコード完全照合前提の評価は確定値ではありません。';
const MAPPING_DEPENDENT_HOLD_NOTE =
  'サービスコード照合未完了のため、サービスコード依存条件は保留扱いとしました。';
const DEFAULT_DISCLAIMER =
  'PDF evidenceに基づく機械的推定。算定可否を保証するものではありません。';

export function isMappingDependent(node) {
  if (Object.prototype.hasOwnProperty.call(node, 'depends_on_service_code_mapping')) {
    return Boolean(node.depends_on_service_code_mapping);
  }
  const fact = node.fact || '';
  return MAPPING_DEPENDENT_FACT_TOKENS.some((tok) => fact.includes(tok));
}

export function getFact(facts, dottedKey) {
  let cur = facts;
  for (const part of dottedKey.split('.')) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return [null, false];
    }
  }
  return [cur, true];
}

export function evaluateCondition(node, facts, mappingUnverified = false) {
  const factPath = node.fact;
  const op = node.op;
  const value = node.value;
  const label = node.label || `${factPath} ${op} ${value}`;

  if (!VALID_OPS.has(op)) {
    return { status: 'unknown', label, reason: `unsupported op: ${op}` };
  }

  if (mappingUnverified && isMappingDependent(node)) {
    return {
      status: 'blocked_by_unverified_mapping',
      label,
      reason: 'service_code_mapping_status=pattern_based_unverified',
      missing: [],
    };
  }

  const [factVal, found] = getFact(facts, factPath);

  if (op === 'exists') {
    return {
      status: found ? 'clear' : 'blocked_by_missing_evidence',
      label,
      missing: found ? [] : [factPath],
    };
  }
  if (op === 'not_exists') {
    return { status: !found ? 'clear' : 'not_clear', label, missing: [] };
  }

  if (!found) {
    return { status: 'blocked_by_missing_evidence', label, missing: [factPath] };
  }

  if (factVal === 'missing' || factVal === 'unknown' || factVal === 'waiting' || factVal == null) {
    return {
      status: 'blocked_by_missing_evidence',
      label,
      fact: factPath,
      op,
      target: value,
      missing: [factPath],
      actual: factVal,
    };
  }

  let ok = false;
  try {
    switch (op) {
      case '==': ok = factVal === value; break;
      case '!=': ok = factVal !== value; break;
      case '>': ok = factVal > value; break;
      case '>=': ok = factVal >= value; break;
      case '<': ok = factVal < value; break;
      case '<=': ok = factVal <= value; break;
      case 'in': ok = Array.isArray(value) && value.includes(factVal); break;
      case 'not_in': ok = Array.isArray(value) && !value.includes(factVal); break;
      case 'bool_true': ok = Boolean(factVal) === true; break;
      case 'bool_false': ok = Boolean(factVal) === false; break;
      default: ok = false;
    }
  } catch (err) {
    return { status: 'unknown', label, reason: `comparison error: ${err.message}` };
  }

  return {
    status: ok ? 'clear' : 'not_clear',
    label,
    fact: factPath,
    op,
    target: value,
    actual: factVal,
    missing: [],
  };
}

// =====================================================================
// 達成度（あと何%/何で加算がとれるか）算出
// 元の ref ターミナルでは hand-authored な tenant_status.inquiry の
// current/target で「現状X% / 目標Y%」を表示していた。Web/pro 経路では
// その inquiry が無いため、DSL が各 condition で持っている actual と
// しきい値 value から gap を機械的に算出して同等の情報を出せるようにする。
// =====================================================================
const NUMERIC_GAP_OPS = new Set(['>=', '>', '<=', '<']);

// 単一 condition 結果から「あと何で届くか」を算出。数値しきい値の条件のみ対象。
export function computeConditionGap(cond) {
  if (!cond || !NUMERIC_GAP_OPS.has(cond.op)) return null;
  const { target, actual } = cond;
  if (typeof target !== 'number' || typeof actual !== 'number') return null;
  const isRatio = target > 0 && target <= 1 && actual >= 0 && actual <= 1;
  let shortfall;
  let achievement;
  if (cond.op === '>=' || cond.op === '>') {
    // 下限要件: actual がしきい値以上で達成
    shortfall = target - actual;
    achievement = target > 0 ? actual / target : actual >= target ? 1 : 0;
  } else {
    // 上限要件 (<= / <): actual がしきい値以下で達成
    shortfall = actual - target;
    achievement = actual > 0 ? Math.min(target, actual) / actual : 1;
  }
  return {
    fact: cond.fact,
    label: cond.label,
    op: cond.op,
    target,
    actual,
    kind: isRatio ? 'ratio' : 'value',
    shortfall: Math.max(0, shortfall),
    achievement: Math.max(0, Math.min(1, achievement)),
    met: cond.status === 'clear' || shortfall <= 0,
  };
}

// 評価済みノードツリーを辿り、加算1件の「達成度」と「あと一歩の不足数値」を集計する。
// - all(AND): 全条件が必要。達成度は数値条件の最小値、gap は未達条件をすべて集約。
// - any(OR): 1つ達成すれば可。最も達成度の高い（＝最短の）ルートを採用。
// 戻り値: { achievement: number|null, gaps: [gap], blockers: [label] }
//   achievement=null は「数値で測れない（情報不足・カテゴリ要件のみ）」を意味する。
export function collectRequirementProgress(nodeResult) {
  function walk(r) {
    if (r && r.all_children) {
      const kids = r.all_children.map(walk);
      if (r.operator === 'any') {
        let best = null;
        for (const k of kids) {
          const ka = k.achievement == null ? -1 : k.achievement;
          const ba = best == null || best.achievement == null ? -1 : best.achievement;
          if (best == null || ka > ba) best = k;
        }
        if (!best || best.achievement === 1) return { achievement: 1, gaps: [], blockers: [] };
        return { achievement: best.achievement, gaps: best.gaps, blockers: best.blockers };
      }
      // all
      const determinate = kids.filter((k) => typeof k.achievement === 'number');
      const achievement = determinate.length ? Math.min(...determinate.map((k) => k.achievement)) : null;
      const gaps = [];
      const blockers = [];
      for (const k of kids) {
        if (k.achievement === 1) continue;
        gaps.push(...k.gaps);
        blockers.push(...k.blockers);
      }
      return { achievement, gaps, blockers };
    }
    // leaf condition
    if (r && r.status === 'clear') return { achievement: 1, gaps: [], blockers: [] };
    const gap = computeConditionGap(r);
    if (gap) return { achievement: gap.achievement, gaps: gap.met ? [] : [gap], blockers: [] };
    if (r && r.status === 'not_clear') {
      return { achievement: null, gaps: [], blockers: r.label ? [r.label] : [] };
    }
    // blocked_by_missing_evidence / blocked_by_unverified_mapping / unknown → 数値で測れない
    return { achievement: null, gaps: [], blockers: [] };
  }
  const res = walk(nodeResult);
  res.gaps = (res.gaps || []).slice().sort((a, b) => a.shortfall - b.shortfall);
  return res;
}

function aggregateNode(childResults, operator) {
  const statuses = childResults.map((r) => r.status);
  const satisfied = childResults.filter((r) => r.status === 'clear');
  const notClear = childResults.filter((r) => r.status === 'not_clear');
  const missing = childResults.filter((r) => r.status === 'blocked_by_missing_evidence');
  const heldMapping = childResults.filter((r) => r.status === 'blocked_by_unverified_mapping');

  let overall;
  if (operator === 'all') {
    if (statuses.every((s) => s === 'clear')) {
      overall = 'clear';
    } else if (statuses.some((s) => s === 'not_clear')) {
      overall = 'not_clear';
    } else if (heldMapping.length && !notClear.length) {
      overall = !satisfied.length ? 'blocked_by_unverified_mapping' : 'partially_clear';
    } else if (missing.length && !notClear.length) {
      overall = !satisfied.length ? 'blocked_by_missing_evidence' : 'partially_clear';
    } else {
      overall = 'unknown';
    }
  } else {
    if (statuses.some((s) => s === 'clear')) {
      overall = 'clear';
    } else if (statuses.every((s) => s === 'blocked_by_missing_evidence')) {
      overall = 'blocked_by_missing_evidence';
    } else if (statuses.every((s) => s === 'blocked_by_unverified_mapping')) {
      overall = 'blocked_by_unverified_mapping';
    } else if (statuses.every((s) => s === 'not_clear')) {
      overall = 'not_clear';
    } else if (
      statuses.some((s) => s === 'blocked_by_missing_evidence' || s === 'blocked_by_unverified_mapping')
    ) {
      overall = 'partially_clear';
    } else {
      overall = 'not_clear';
    }
  }

  return {
    status: overall,
    satisfied,
    not_clear: notClear,
    missing_evidence_nodes: missing,
    mapping_held_nodes: heldMapping,
    all_children: childResults,
  };
}

export function evaluateNode(node, facts, mappingUnverified = false) {
  const op = node.operator || node.type;
  if (op === 'condition' || Object.prototype.hasOwnProperty.call(node, 'fact')) {
    return evaluateCondition(node, facts, mappingUnverified);
  }
  if (op === 'all' || op === 'any') {
    const children = node.children || [];
    const childResults = children.map((c) => evaluateNode(c, facts, mappingUnverified));
    return {
      ...aggregateNode(childResults, op),
      operator: op,
      label: node.description || node.label || op,
    };
  }
  return {
    status: 'unknown',
    label: node.label || 'unknown_node',
    reason: `unknown node operator: ${op}`,
  };
}

export function evaluateRequirementLogic(logic, facts, itemMeta) {
  const notes = [];
  let mappingUnverified = false;
  // mapping 保留判定: per-kasan メタ（itemMeta.service_code_mapping_status / overall_mapping_status）を優先し、
  // 無ければ evidence の service_code_mapping_status にフォールバック
  const perKasanMapping =
    itemMeta?.overall_mapping_status || itemMeta?.service_code_mapping_status;
  const evidenceMapping = (facts.receipt_pdf || {}).service_code_mapping_status;
  const effectiveMapping = perKasanMapping || evidenceMapping;
  if (effectiveMapping === 'pattern_based_unverified') {
    mappingUnverified = true;
    notes.push(PATTERN_UNVERIFIED_NOTE);
  }

  if (itemMeta?.applicability === 'not_applicable') {
    return {
      status: 'not_applicable',
      logic_status: 'n/a',
      source_status: itemMeta.source_status,
      satisfied_route: [],
      failed_conditions: [],
      missing_evidence: [],
      applicability_reason: itemMeta.applicability_reason,
      notes: ['このサービスでは算定対象外（公式根拠で確認済）'],
    };
  }

  const src = itemMeta?.source_status;
  if (src && src !== 'checked') {
    return {
      status: 'not_evaluated_source_required',
      logic_status: 'n/a',
      source_status: src,
      satisfied_route: [],
      failed_conditions: [],
      missing_evidence: [],
      notes: [`source_status=${src} のため要件論理式を評価しません`],
    };
  }

  if (!logic) {
    return {
      status: 'unknown',
      logic_status: 'absent',
      source_status: src,
      satisfied_route: [],
      failed_conditions: [],
      missing_evidence: [],
      notes: ['要件論理式が未登録（logic未構造化）'],
    };
  }

  const logicStatus = logic.logic_status || 'draft';
  if (logicStatus !== 'checked') {
    return {
      status: 'not_evaluated_logic_unchecked',
      logic_status: logicStatus,
      source_status: src,
      satisfied_route: [],
      failed_conditions: [],
      missing_evidence: [],
      notes: [`logic_status=${logicStatus} のため要件論理式を評価しません`],
    };
  }

  const result = evaluateNode(logic, facts, mappingUnverified);

  const satisfiedRoute = [];
  const failed = [];
  const missing = new Set();
  const mappingHeld = [];

  function collect(r, suppressBlocked = false) {
    if (r.all_children) {
      const op = r.operator;
      const childSuppress = suppressBlocked || (op === 'any' && r.status === 'clear');
      for (const child of r.all_children) {
        collect(child, childSuppress);
      }
    } else {
      if (r.status === 'clear') {
        satisfiedRoute.push(r.label);
      } else if (r.status === 'not_clear') {
        failed.push(r.label);
      } else if (r.status === 'blocked_by_missing_evidence') {
        if (!suppressBlocked) {
          for (const m of r.missing || []) missing.add(m);
        }
      } else if (r.status === 'blocked_by_unverified_mapping') {
        if (!suppressBlocked) mappingHeld.push(r.label);
      }
    }
  }
  collect(result);

  const finalNotes = [...notes, DEFAULT_DISCLAIMER];
  if (mappingHeld.length) finalNotes.push(MAPPING_DEPENDENT_HOLD_NOTE);

  // 「あと何%/何で加算がとれるか」を機械的に算出（最短ルートの未達数値要件）
  const progress = collectRequirementProgress(result);

  return {
    status: result.status,
    logic_status: logicStatus,
    source_status: src,
    satisfied_route: satisfiedRoute,
    failed_conditions: failed,
    missing_evidence: [...missing].sort(),
    mapping_held_conditions: mappingHeld,
    progress,
    notes: finalNotes,
  };
}

export function buildFactsFromEvidence(evidence, tenantStatus) {
  // evidence は {evidence: [...]} 形式 / フラット形式 / null のいずれでも受け付ける
  const facts = { receipt_pdf: {}, tenant_status: {} };
  if (evidence) {
    const e = Array.isArray(evidence.evidence) && evidence.evidence.length
      ? evidence.evidence[0]
      : evidence;
    const keys = [
      'total_users_estimated', 'yokaigo_3plus_ratio', 'raw_yokaigo_3plus_ratio',
      'extraction_confidence', 'service_code_mapping_status',
      'current_kasan_counts', 'detected_service_codes',
      'service_category_counts', 'time_band_counts',
    ];
    for (const k of keys) {
      if (k in e) facts.receipt_pdf[k] = e[k];
    }
  }
  if (tenantStatus) {
    facts.tenant_status = tenantStatus.requirement_status || {};
  }
  return facts;
}

export async function loadDemoTenantStatus(p) {
  if (!p || !existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf-8'));
}

export function mergeDemoTenantFacts(baseFacts, demoTenantStatus) {
  if (!demoTenantStatus) return baseFacts;
  const out = { ...baseFacts };
  if (!out.tenant_status) out.tenant_status = {};
  const demoFacts = demoTenantStatus.facts || {};
  for (const [dottedKey, value] of Object.entries(demoFacts)) {
    if (dottedKey.startsWith('receipt_pdf.')) continue;
    if (dottedKey.startsWith('tenant_status.')) {
      const parts = dottedKey.split('.').slice(1);
      let cur = out.tenant_status;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      cur[parts[parts.length - 1]] = value;
    } else {
      const parts = dottedKey.split('.');
      let cur = out;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      cur[parts[parts.length - 1]] = value;
    }
  }
  return out;
}

export async function loadEvidenceLabels(p) {
  const labelPath = p || path.join(PROJECT_ROOT, 'config', 'evidence_labels.json');
  if (!existsSync(labelPath)) return { labels: {}, default_priority: '中' };
  return JSON.parse(await readFile(labelPath, 'utf-8'));
}

// =====================================================================
// alpha.5.3: DEMO staff.json bridge
// =====================================================================
const FUKUSHISHI_TOU_KEYWORDS = ['介護福祉士', '実務者', '基礎研修', '介護職員基礎研修'];
const KAIGO_FUKUSHISHI_KEYWORDS = ['介護福祉士'];
const KAIGO_QUALIFICATION_KEYWORDS = ['介護福祉士', '実務者', '基礎研修', '初任者', 'ホームヘルパー'];
const KINOU_KUNREN_QUALIFICATION_KEYWORDS = [
  '理学療法士', '作業療法士', '言語聴覚士', '看護師', '准看護師',
  '柔道整復師', 'あん摩マッサージ指圧師', 'あマ指師', '鍼灸師',
  'はり師', 'きゅう師', '介護福祉士',
];

export async function loadStaffData(p) {
  if (!p || !existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf-8'));
}

function hasKeyword(quals, keywords) {
  if (!Array.isArray(quals)) return false;
  return quals.some((q) => typeof q === 'string' && keywords.some((k) => q.includes(k)));
}

function ratio(num, den) {
  if (den == null || den <= 0) return null;
  return Math.round((num / den) * 10000) / 10000;
}

function fteSum(arr) {
  return Math.round(arr.reduce((acc, s) => acc + (Number(s.fte) || 0), 0) * 10000) / 10000;
}

export function buildFactsFromStaffData(staffData, serviceKey) {
  const out = {};
  if (!staffData) return out;
  if (staffData.sample_policy !== 'public_demo_synthetic') return out;
  const list = Array.isArray(staffData.staff) ? staffData.staff : [];
  const active = list.filter((s) => s && typeof s === 'object' && s.active === true);

  const saseki = active.filter((s) => s.role === 'saseki' || s.role === 'saseki_uwanose');
  const sasekiUwanose = active.filter((s) => s.role === 'saseki_uwanose');
  const helpers = active.filter((s) => s.role === 'helper');
  const kango = active.filter((s) => s.role === 'kango');
  const kaigo = active.filter((s) => s.role === 'kaigo');
  const riha = active.filter((s) => s.role === 'rihabilitation' || s.role === 'kinou_kunren');
  const cm = active.filter((s) => s.role === 'cm');
  const shuninCm = active.filter((s) => s.role === 'shunin_cm');

  if (serviceKey === 'houmon_kaigo' || serviceKey == null) {
    const helperTotal = helpers.length;
    const helperKaigoFukushi = helpers.filter((s) => hasKeyword(s.qualifications, KAIGO_FUKUSHISHI_KEYWORDS)).length;
    const helperFukushiTou = helpers.filter((s) => hasKeyword(s.qualifications, FUKUSHISHI_TOU_KEYWORDS)).length;
    const helperQualifiedAny = helpers.filter((s) => hasKeyword(s.qualifications, KAIGO_QUALIFICATION_KEYWORDS)).length;
    out['staff_summary.saseki_qualified_count'] = saseki.filter((s) => (s.qualifications || []).length).length;
    out['staff_summary.saseki_uwanose_fte'] = fteSum(sasekiUwanose);
    out['staff_summary.helper_total_count'] = helperTotal;
    out['staff_summary.helper_total_fte'] = fteSum(helpers);
    out['staff_summary.helper_kaigo_fukushishi_count'] = helperKaigoFukushi;
    out['staff_summary.helper_kaigo_fukushishi_ratio'] = ratio(helperKaigoFukushi, helperTotal);
    out['staff_summary.helper_fukushishi_jitsumusha_kiso_ratio'] = ratio(helperFukushiTou, helperTotal);
    out['staff_summary.helper_qualified_any_count'] = helperQualifiedAny;
  }

  if (serviceKey === 'tsusho_kaigo' || serviceKey == null) {
    const kinouKunrenQualified = active
      .filter((s) => ['kinou_kunren', 'kango', 'rihabilitation', 'kaigo'].includes(s.role))
      .some((s) => hasKeyword(s.qualifications, KINOU_KUNREN_QUALIFICATION_KEYWORDS));
    out['staff_summary.kango_count'] = kango.length;
    out['staff_summary.kango_fte'] = fteSum(kango);
    out['staff_summary.kaigo_count'] = kaigo.length;
    out['staff_summary.kaigo_fte'] = fteSum(kaigo);
    out['staff_summary.kango_kaigo_total_fte'] = Math.round((fteSum(kango) + fteSum(kaigo)) * 10000) / 10000;
    out['staff_summary.kinou_kunren_qualified'] = Boolean(kinouKunrenQualified);
  }

  if (serviceKey === 'houmon_kango_kaigo' || serviceKey == null) {
    const kangoJoukin = kango.filter((s) => s.is_joukin === true);
    out['staff_summary.kango_count'] = kango.length;
    out['staff_summary.kango_fte'] = fteSum(kango);
    out['staff_summary.kango_joukin_count'] = kangoJoukin.length;
    out['staff_summary.rihabilitation_count'] = riha.length;
  }

  if (serviceKey === 'kyotaku_shien' || serviceKey == null) {
    const allCm = [...cm, ...shuninCm];
    out['staff_summary.cm_count'] = allCm.length;
    out['staff_summary.shunin_cm_count'] = shuninCm.length;
    out['staff_summary.cm_total_fte'] = fteSum(allCm);
  }

  return out;
}

export function mergeRequirementFacts(baseFacts, staffSummaryFacts, userSummaryFacts) {
  const out = { ...baseFacts };
  if (!out.staff_summary) out.staff_summary = {};
  if (!out.user_summary) out.user_summary = {};

  function mergeNamespace(facts, expectedPrefix, target) {
    if (!facts) return;
    for (const [dottedKey, value] of Object.entries(facts)) {
      if (typeof dottedKey !== 'string') continue;
      if (dottedKey.startsWith('receipt_pdf.') || dottedKey.startsWith('tenant_status.')) continue;
      if (!dottedKey.startsWith(`${expectedPrefix}.`)) continue;
      const parts = dottedKey.split('.').slice(1);
      let cur = target;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      cur[parts[parts.length - 1]] = value;
    }
  }

  mergeNamespace(staffSummaryFacts, 'staff_summary', out.staff_summary);
  mergeNamespace(userSummaryFacts, 'user_summary', out.user_summary);
  return out;
}

// Python 版とのシグネチャ互換: serviceKey は受け取るが未使用（将来の service 別表示用に予約）
export function buildStaffSummaryDisplay(staffSummaryFacts, _serviceKey = null) {
  if (!staffSummaryFacts) return {};
  const out = {};
  for (const [k, v] of Object.entries(staffSummaryFacts)) {
    if (typeof k === 'string') out[k.replace('staff_summary.', '')] = v;
  }
  return out;
}

// =====================================================================
// alpha.5.4: DEMO user_summary bridge
// =====================================================================
const USER_SUMMARY_FORBIDDEN_FIELDS = new Set([
  'users', 'user_list', 'user_records',
  'name', 'kana', 'kanji_name', 'user_name',
  'birth', 'birthday', 'birth_date', 'date_of_birth',
  'address', 'phone', 'phone_number', 'tel', 'email',
  'hihokensha_number', 'insured_number',
  'shinsei_number',
  'family_member', 'family', 'kazoku',
  'iryo_kikan_name', 'hospital_name', 'doctor_name',
  'shoubyou_name', 'byoumei', 'diagnosis_text',
]);

export async function loadUserSummary(p) {
  if (!p || !existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf-8'));
}

function userSummaryIsSafe(userSummary) {
  if (!userSummary || typeof userSummary !== 'object') return false;
  function walk(node) {
    if (Array.isArray(node)) return node.some(walk);
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (USER_SUMMARY_FORBIDDEN_FIELDS.has(k)) return true;
        if (walk(node[k])) return true;
      }
    }
    return false;
  }
  return !walk(userSummary);
}

// Python 版とのシグネチャ互換: serviceKey は受け取るが未使用（将来の service 別 facts 拡張用に予約）
export function buildFactsFromUserSummary(userSummary, _serviceKey = null) {
  const out = {};
  if (!userSummary) return out;
  if (userSummary.sample_policy !== 'public_demo_synthetic') return out;
  if (!userSummaryIsSafe(userSummary)) return out;

  out['user_summary.data_source_type'] = userSummary.data_source_type || 'demo_aggregate';
  out['user_summary.source_status'] = userSummary.source_status || 'demo_aggregate_unverified';
  const period = userSummary.target_period || {};
  if ('start' in period) out['user_summary.target_period_start'] = period.start;
  if ('end' in period) out['user_summary.target_period_end'] = period.end;

  const directKeys = [
    'users_total',
    'care_level_3_or_higher_count', 'care_level_3_or_higher_ratio',
    'care_level_4_or_higher_count', 'care_level_4_or_higher_ratio',
    'severe_user_count', 'severe_user_ratio',
    'dementia_related_count', 'medical_dependency_count',
    'terminal_care_related_count', 'discharge_support_related_count',
    'emergency_response_related_count',
  ];
  for (const k of directKeys) {
    if (k in userSummary) out[`user_summary.${k}`] = userSummary[k];
  }
  const cl = userSummary.care_level_distribution;
  if (cl && typeof cl === 'object') out['user_summary.care_level_distribution'] = cl;
  const dem = userSummary.dementia_care_level_distribution;
  if (dem && typeof dem === 'object') out['user_summary.dementia_care_level_distribution'] = dem;

  return out;
}

// Python 版とのシグネチャ互換: serviceKey は受け取るが未使用
export function buildUserSummaryDisplay(userSummaryFacts, _serviceKey = null) {
  if (!userSummaryFacts) return {};
  const out = {};
  for (const [k, v] of Object.entries(userSummaryFacts)) {
    if (typeof k === 'string') out[k.replace('user_summary.', '')] = v;
  }
  return out;
}

// =====================================================================
// 不足証跡チェックリスト
// =====================================================================
export function buildEvidenceChecklist(dslResults, judgements, labelConfig) {
  const labels = labelConfig.labels || {};
  const defaultPriority = labelConfig.default_priority || '中';
  const defaultNextAction =
    labelConfig.default_next_action || '事業所内で資料の有無を確認する';
  const checklist = [];
  for (const [kasanKey, dsl] of Object.entries(dslResults)) {
    if (!['blocked_by_missing_evidence', 'partially_clear', 'blocked_by_unverified_mapping']
      .includes(dsl.status)) continue;
    const kasanName = (judgements[kasanKey] || {}).name || kasanKey;

    for (const factPath of dsl.missing_evidence || []) {
      const labelInfo = labels[factPath] || {};
      checklist.push({
        kasan_key: kasanKey,
        kasan_name: kasanName,
        fact_path: factPath,
        label: labelInfo.label || factPath,
        recommended_documents: labelInfo.recommended_documents || [],
        priority: labelInfo.priority || defaultPriority,
        next_action: labelInfo.next_action || defaultNextAction,
        category: 'missing_evidence',
      });
    }
    for (const heldLabel of dsl.mapping_held_conditions || []) {
      checklist.push({
        kasan_key: kasanKey,
        kasan_name: kasanName,
        fact_path: '(service_code_mapping)',
        label: `${heldLabel}（サービスコード照合未完了のため保留）`,
        recommended_documents: ['公式サービスコード表照合'],
        priority: '中',
        next_action: 'サービスコード表との照合を実施する',
        category: 'mapping_unverified',
      });
    }
  }
  const priorityOrder = { 高: 0, 中: 1, 低: 2, High: 0, Medium: 1, Low: 2 };
  checklist.sort((a, b) => {
    const pa = priorityOrder[a.priority || defaultPriority] ?? 99;
    const pb = priorityOrder[b.priority || defaultPriority] ?? 99;
    return pa - pb;
  });
  return checklist;
}
