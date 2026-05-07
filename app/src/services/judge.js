// CareLinker 加算チェッカー判定エンジン (Node.js port)
// 元実装: scripts/judge_kasan.py の run() / judge_kasan() / load_*

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateRequirementLogic,
  buildFactsFromEvidence,
  loadDemoTenantStatus,
  mergeDemoTenantFacts,
  loadEvidenceLabels,
  buildEvidenceChecklist,
  loadStaffData,
  buildFactsFromStaffData,
  mergeRequirementFacts,
  buildStaffSummaryDisplay,
  loadUserSummary,
  buildFactsFromUserSummary,
  buildUserSummaryDisplay,
} from './dsl.js';
import { runExtraction } from './receipt-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const REGISTRY_PATH = path.join(PROJECT_ROOT, 'regulatory_master', 'service_registry.json');
const DEFAULT_STATUS_DIR = path.join(PROJECT_ROOT, 'tenant_data', 'status');

export const STATUS_LABELS = {
  clear: '✅ 取得済/要件クリア',
  waiting: '⏸ 確認待ち',
  not_clear: '❌ 対象外/不可',
  unknown: '❔ 情報不足',
  currently_claimed: '💰 現在算定中',
  claimed_but_requirements_unknown: '💰❔ 算定中（要件未確認）',
  not_detected_in_pdf: '📄❔ PDF未検出',
  not_applicable: '🚫 当サービスでは算定対象外',
};

export const STATUS_MARKS = {
  clear: '✅',
  waiting: '⏸',
  not_clear: '❌',
  unknown: '❔',
  currently_claimed: '💰',
  claimed_but_requirements_unknown: '💰❔',
  not_detected_in_pdf: '📄❔',
  not_applicable: '🚫',
};

export const UNKNOWN_TAXONOMY = {
  tenant_status_missing:
    '事業所ステータスファイル未登録（tenant_data/status/<office>.jsonを作成すれば判定可）',
  data_missing: '職員情報・利用者情報が未入力（staff/user データ取込で解決）',
  source_required: '公式根拠の確認待ち（マスタ要件側に確定値が未投入）',
  logic_not_implemented: '判定ロジック未実装（OR/AND等のネスト評価が今後の対応事項）',
  not_applicable_unknown: '対象外の可能性があるが未確認（地域要件等）',
};

export const USER_INFO_KEYS = new Set([
  'kongan_jirei_ratio',
  'juudosha_ratio',
  'chusankan_user_count',
  'user_ratio',
]);
export const STAFF_INFO_KEYS = new Set([
  'saseki_qualifications',
  'helper_qualifications',
  'joukin_senjuu_cm_count',
  'shunin_cm_count',
  'saseki_health_check',
  'kinzoku_7nen_ratio',
  'saseki_uwanose_count',
]);

export async function loadRegistry() {
  return JSON.parse(await readFile(REGISTRY_PATH, 'utf-8'));
}

export function findService(registry, service, { domain, statusFilter } = {}) {
  for (const s of registry.services) {
    if (s.service_key !== service) continue;
    if (domain && s.domain !== domain) continue;
    if (statusFilter && s.status !== statusFilter) continue;
    return s;
  }
  return null;
}

export async function loadMaster(serviceDef) {
  const p = path.join(PROJECT_ROOT, serviceDef.master_file);
  if (!existsSync(p)) throw new Error(`マスタファイルが存在しません: ${p}`);
  return JSON.parse(await readFile(p, 'utf-8'));
}

export async function loadTenantStatus(office, explicitPath) {
  let p;
  if (explicitPath) {
    p = path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
  } else if (office) {
    p = path.join(DEFAULT_STATUS_DIR, `${office}.json`);
  } else {
    return null;
  }
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf-8'));
}

function collectStatusKeys(reqValue) {
  const keys = [];
  if (!reqValue || typeof reqValue !== 'object') return keys;
  if (Object.prototype.hasOwnProperty.call(reqValue, 'tenant_status_key')) {
    keys.push(reqValue.tenant_status_key);
  }
  for (const v of Object.values(reqValue)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectStatusKeys(v));
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') keys.push(...collectStatusKeys(item));
      }
    }
  }
  return keys;
}

export function classifyUnknown(reason, tenantLoaded) {
  if (!tenantLoaded) return 'tenant_status_missing';
  if (!reason) return 'logic_not_implemented';
  if (typeof reason === 'string' && reason.includes('no tenant_status_key bound')) {
    return 'logic_not_implemented';
  }
  if (USER_INFO_KEYS.has(reason)) return 'data_missing';
  if (STAFF_INFO_KEYS.has(reason)) return 'data_missing';
  return 'data_missing';
}

export function judgeRequirement(reqValue, tenantStatus) {
  if (!reqValue || typeof reqValue !== 'object') return ['unknown', null];
  const keys = collectStatusKeys(reqValue);
  if (!keys.length) return ['unknown', 'no tenant_status_key bound'];
  const rsMap = (tenantStatus && tenantStatus.requirement_status) || {};
  const statuses = keys.map((k) => {
    const entry = rsMap[k];
    return entry ? [entry.status || 'unknown', k] : ['unknown', k];
  });
  const levels = statuses.map((s) => s[0]);
  if (levels.includes('not_clear')) {
    return ['not_clear', statuses.find((s) => s[0] === 'not_clear')[1]];
  }
  if (levels.includes('waiting')) {
    return ['waiting', statuses.find((s) => s[0] === 'waiting')[1]];
  }
  if (levels.includes('unknown')) {
    return ['unknown', statuses.find((s) => s[0] === 'unknown')[1]];
  }
  return ['clear', null];
}

export function judgeKasan(kasanKey, kasanDef, tenantStatus) {
  const requirements = kasanDef.requirements || {};
  const reqJudgements = {};
  for (const [reqKey, reqVal] of Object.entries(requirements)) {
    const [status, reason] = judgeRequirement(reqVal, tenantStatus || {});
    reqJudgements[reqKey] = { status, reason };
  }

  let overall;
  if (kasanDef.applicability === 'not_applicable') {
    overall = 'not_applicable';
  } else {
    const statuses = Object.values(reqJudgements).map((r) => r.status);
    if (!statuses.length) overall = 'unknown';
    else if (statuses.every((s) => s === 'clear')) overall = 'clear';
    else if (statuses.some((s) => s === 'not_clear')) overall = 'not_clear';
    else if (statuses.some((s) => s === 'waiting')) overall = 'waiting';
    else overall = 'unknown';
  }

  return {
    name: kasanDef.name,
    short_name: kasanDef.short_name,
    category: kasanDef.category,
    priority_hint: kasanDef.priority_hint,
    unit_per_month: kasanDef.unit_per_month,
    unit_per_day: kasanDef.unit_per_day,
    unit_per_visit: kasanDef.unit_per_visit,
    rate: kasanDef.rate,
    requirements_judgement: reqJudgements,
    algorithm_judgement: overall,
    documents_required: kasanDef.documents_required || [],
    roi_estimation: kasanDef.roi_estimation,
    interaction: kasanDef.interaction,
    tips: kasanDef.tips || [],
  };
}

export async function loadEvidence(p) {
  if (!p) return null;
  let resolved = p;
  if (!path.isAbsolute(resolved)) resolved = path.resolve(process.cwd(), resolved);
  if (!existsSync(resolved)) return null;
  const data = JSON.parse(await readFile(resolved, 'utf-8'));
  if (Array.isArray(data.evidence) && data.evidence.length) return data.evidence[0];
  return data;
}

export function applyEvidenceToJudgements(judgements, evidence) {
  if (!evidence) return judgements;
  const counts = evidence.current_kasan_counts || {};
  const out = {};
  for (const [kasanKey, j] of Object.entries(judgements)) {
    const newJ = { ...j };
    const inPdf = Object.prototype.hasOwnProperty.call(counts, kasanKey);
    newJ.pdf_detected = inPdf;
    newJ.pdf_count = counts[kasanKey] || 0;
    if (inPdf) {
      if (j.algorithm_judgement === 'clear') newJ.algorithm_judgement = 'currently_claimed';
      else if (['waiting', 'unknown'].includes(j.algorithm_judgement)) {
        newJ.algorithm_judgement = 'claimed_but_requirements_unknown';
      }
    }
    out[kasanKey] = newJ;
  }
  return out;
}

function isoNoMs(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

export async function run({
  service,
  office = null,
  domain = null,
  statusFilter = null,
  statusPath = null,
  evidencePath = null,
  applyEvidence = false,
  inlineEvidence = null,
  receiptPdfPath = null,
  receiptPdfBuffer = null,
  receiptPdfSourceName = null,
  evidenceOut = null,
  tenant = null,
  demoTenantStatusPath = null,
  staffDataPath = null,
  userSummaryPath = null,
} = {}) {
  const registry = await loadRegistry();
  const serviceDef = findService(registry, service, { domain, statusFilter });
  if (!serviceDef) {
    throw new Error(
      `サービスが見つかりません: service=${service}, domain=${domain}, status=${statusFilter}`,
    );
  }
  const master = await loadMaster(serviceDef);
  const masterMeta = master._meta || {};

  if (serviceDef.status === 'draft' && !master.kasans) {
    return {
      service,
      service_def: serviceDef,
      master_meta: masterMeta,
      office_code: office,
      draft_warning:
        'このサービスはdraftで、加算マスタは未実装(source_required)です。中身は推測で埋めず、source_requiredのまま空マスタとして配置されています。',
      kasan_count: 0,
      judgements: {},
      summary: { clear: [], waiting: [], not_clear: [], unknown: [] },
      tenant_status_loaded: false,
      tenant_status_inquiry: null,
      executed_at: isoNoMs(),
    };
  }

  const tenantStatus = await loadTenantStatus(office, statusPath);
  const kasans = master.kasans || {};
  let judgements = {};
  for (const [key, val] of Object.entries(kasans)) {
    judgements[key] = judgeKasan(key, val, tenantStatus);
  }

  // PDF からの evidence を取り込み
  let evidence = null;
  let inlineEvidencePath = null;
  if (applyEvidence) {
    if (evidencePath) {
      evidence = await loadEvidence(evidencePath);
    } else if (inlineEvidence) {
      if (Array.isArray(inlineEvidence.evidence) && inlineEvidence.evidence.length) {
        evidence = inlineEvidence.evidence[0];
      } else {
        evidence = inlineEvidence;
      }
    } else if (receiptPdfPath || receiptPdfBuffer) {
      const r = await runExtraction({
        office: office || 'unknown',
        service,
        tenant,
        pdfPath: receiptPdfPath,
        pdfBuffer: receiptPdfBuffer,
        sourceName: receiptPdfSourceName,
        evidenceOut,
      });
      inlineEvidencePath = r.savedPath;
      if (Array.isArray(r.evidence.evidence) && r.evidence.evidence.length) {
        evidence = r.evidence.evidence[0];
      }
    }
  }
  if (applyEvidence && evidence) {
    judgements = applyEvidenceToJudgements(judgements, evidence);
  }

  const summary = {};
  for (const status of [
    'clear', 'waiting', 'not_clear', 'unknown',
    'currently_claimed', 'claimed_but_requirements_unknown', 'not_applicable',
  ]) {
    summary[status] = Object.entries(judgements)
      .filter(([, j]) => j.algorithm_judgement === status)
      .map(([k]) => k);
  }

  // DSL 評価 + DEMO bridge
  let facts = buildFactsFromEvidence(evidence, tenantStatus);
  if (demoTenantStatusPath) {
    const demoTs = await loadDemoTenantStatus(demoTenantStatusPath);
    facts = mergeDemoTenantFacts(facts, demoTs);
  }

  let staffSummaryFacts = {};
  let staffSummaryDisplay = {};
  if (staffDataPath) {
    const staffData = await loadStaffData(staffDataPath);
    staffSummaryFacts = buildFactsFromStaffData(staffData, service);
    staffSummaryDisplay = buildStaffSummaryDisplay(staffSummaryFacts, service);
  }

  let userSummaryFacts = {};
  let userSummaryDisplay = {};
  if (userSummaryPath) {
    const userSummary = await loadUserSummary(userSummaryPath);
    userSummaryFacts = buildFactsFromUserSummary(userSummary, service);
    userSummaryDisplay = buildUserSummaryDisplay(userSummaryFacts, service);
  }
  facts = mergeRequirementFacts(facts, staffSummaryFacts, userSummaryFacts);

  const dslResults = {};
  for (const [kasanKey, kasanDef] of Object.entries(kasans)) {
    let itemMeta;
    if (kasanDef.applicability === 'not_applicable') {
      itemMeta = {
        source_status: kasanDef.source_status,
        applicability: 'not_applicable',
        applicability_reason: kasanDef.applicability_reason,
      };
    } else {
      itemMeta = { source_status: kasanDef.source_status || 'checked' };
    }
    dslResults[kasanKey] = evaluateRequirementLogic(kasanDef.requirement_logic, facts, itemMeta);
  }

  const labelConfig = await loadEvidenceLabels();
  const evidenceChecklist = buildEvidenceChecklist(dslResults, judgements, labelConfig);

  return {
    service,
    service_def: serviceDef,
    master_meta: masterMeta,
    office_code: office,
    tenant_status_loaded: tenantStatus !== null,
    tenant_status: tenantStatus,
    tenant_status_inquiry: tenantStatus ? tenantStatus.inquiry || null : null,
    evidence,
    evidence_applied: applyEvidence && evidence !== null,
    inline_evidence_path: inlineEvidencePath,
    kasan_count: Object.keys(kasans).length,
    summary,
    judgements,
    dsl_results: dslResults,
    evidence_checklist: evidenceChecklist,
    demo_tenant_status_loaded: demoTenantStatusPath !== null,
    staff_data_loaded: staffDataPath !== null,
    staff_summary_display: staffSummaryDisplay,
    user_summary_loaded: userSummaryPath !== null,
    user_summary_display: userSummaryDisplay,
    executed_at: isoNoMs(),
  };
}

export function collectUnknownClassified(result) {
  const classified = {};
  for (const k of Object.keys(UNKNOWN_TAXONOMY)) classified[k] = [];
  const tenantLoaded = result.tenant_status_loaded || false;
  for (const [kasanKey, j] of Object.entries(result.judgements || {})) {
    for (const [reqKey, reqJ] of Object.entries(j.requirements_judgement || {})) {
      if (reqJ.status !== 'unknown') continue;
      const cat = classifyUnknown(reqJ.reason, tenantLoaded);
      classified[cat].push({ kasan: kasanKey, req: reqKey, reason: reqJ.reason });
    }
  }
  return classified;
}

export function top5Actions(result) {
  const actions = [];
  const inquiry = result.tenant_status_inquiry || {};
  for (const it of (inquiry.remaining_5_items || []).slice(0, 5)) {
    actions.push(`[${it.id}] ${it.item}`);
  }
  if (inquiry.tokujituI_youkaigo3_ratio) {
    const r = inquiry.tokujituI_youkaigo3_ratio;
    const cur = ((r.current || 0) * 100).toFixed(1);
    const tgt = ((r.target || 0) * 100).toFixed(1);
    actions.push(
      `[要介護3以上40%要件] 現状${cur}% / 目標${tgt}% / ${r.needed_subtraction_for_clear || ''}`,
    );
  }
  for (const [k, j] of Object.entries(result.judgements || {})) {
    if (actions.length >= 5) break;
    if (j.algorithm_judgement === 'waiting' && j.priority_hint) {
      actions.push(`[${j.name}] ${j.priority_hint}`);
    }
  }
  return actions.slice(0, 5);
}
