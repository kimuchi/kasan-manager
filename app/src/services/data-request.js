// PR-2: 「どんなデータが必要か」提案エンジン。
//
// DSL の missing_evidence / result-classifier の next_required_data を、
// 「この加算のこの判定には、利用者集計／勤務形態一覧表／LIFE送信履歴／計画書が必要」という
// 具体的な追加提出リクエストに変換する。fact_path 単位で集約し、対象加算・推奨資料・提出方法・
// 手入力可否・提出後に上がる信頼度を返す。

import { loadEvidenceLabels } from './dsl.js';

// fact_path の名前空間ごとの既定（提出方法・テンプレ種別・提出後信頼度）
const NAMESPACE_TEMPLATES = {
  user_summary: {
    template_kind: 'user_summary',
    acceptable_sources: ['利用者一覧CSV', '受給者台帳Excel', '介護ソフトの利用者集計表', '手入力（仮判定のみ）'],
    manual_input_allowed: true,
    upload_allowed: true,
    expected_confidence_after_submission: 'medium',
  },
  staff_summary: {
    template_kind: 'staff_roster',
    acceptable_sources: ['勤務形態一覧表', '資格者一覧', '介護ソフトの職員台帳', '手入力（仮判定のみ）'],
    manual_input_allowed: true,
    upload_allowed: true,
    expected_confidence_after_submission: 'medium',
  },
  tenant_status: {
    template_kind: 'tenant_status',
    acceptable_sources: ['体制等に関する届出書', '運営規程', '勤務表（実績）', '手入力（仮判定のみ）'],
    manual_input_allowed: true,
    upload_allowed: true,
    expected_confidence_after_submission: 'medium',
  },
  receipt_pdf: {
    template_kind: 'receipt',
    acceptable_sources: ['介護給付費明細書（レセプト）PDF', '介護ソフトの請求明細'],
    manual_input_allowed: false,
    upload_allowed: true,
    expected_confidence_after_submission: 'high',
  },
};

const OTHER_TEMPLATE = {
  template_kind: 'other',
  acceptable_sources: ['該当する記録・帳票', '手入力（仮判定のみ）'],
  manual_input_allowed: true,
  upload_allowed: true,
  expected_confidence_after_submission: 'low',
};

// 不足データが出る実務バケット（請求OK・対象外には出さない）
const REQUESTABLE_BUCKETS = new Set(['claimed_evidence_risk', 'almost_ready', 'needs_more_data']);

function namespaceTemplate(factPath) {
  const ns = String(factPath || '').split('.')[0];
  return NAMESPACE_TEMPLATES[ns] || OTHER_TEMPLATE;
}

function slug(s) {
  return String(s)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizePriority(raw, risk) {
  if (risk) return 'high';
  if (raw === '高' || raw === 'High') return 'high';
  if (raw === '低' || raw === 'Low') return 'low';
  return 'medium';
}

// judgeResult（classification 付与済み）から DataRequest[] を構築する純関数
export function buildDataRequests({ judgeResult, labelConfig }) {
  const labels = (labelConfig && labelConfig.labels) || {};
  const defaultPriority = (labelConfig && labelConfig.default_priority) || '中';
  const classification = judgeResult.classification || {};
  const judgements = judgeResult.judgements || {};
  const dslResults = judgeResult.dsl_results || {};

  const byFact = new Map();
  for (const [kasanKey, cls] of Object.entries(classification)) {
    if (!REQUESTABLE_BUCKETS.has(cls.user_visible_bucket)) continue;
    const dsl = dslResults[kasanKey] || {};
    const facts = new Set([...(dsl.missing_evidence || []), ...(cls.next_required_data || [])]);
    const kasanName = judgements[kasanKey]?.name || kasanKey;
    const risk = cls.user_visible_bucket === 'claimed_evidence_risk'; // 算定中だが未確認＝収益リスク高
    for (const fp of facts) {
      if (!fp || typeof fp !== 'string') continue;
      if (!byFact.has(fp)) {
        const info = labels[fp] || {};
        byFact.set(fp, {
          fact_path: fp,
          data_label: info.label || fp,
          recommended_documents: info.recommended_documents || [],
          priority_raw: info.priority || defaultPriority,
          target_kasans: new Set(),
          target_kasan_names: new Set(),
          risk: false,
          blocking_status: dsl.status || 'unknown',
        });
      }
      const r = byFact.get(fp);
      r.target_kasans.add(kasanKey);
      r.target_kasan_names.add(kasanName);
      if (risk) r.risk = true;
    }
  }

  const out = [];
  for (const r of byFact.values()) {
    const tmpl = namespaceTemplate(r.fact_path);
    const names = [...r.target_kasan_names];
    const acceptable = [...new Set([...(r.recommended_documents || []), ...tmpl.acceptable_sources])];
    out.push({
      request_id: `REQ-${slug(r.fact_path)}`,
      priority: normalizePriority(r.priority_raw, r.risk),
      target_kasans: [...r.target_kasans],
      fact_path: r.fact_path,
      data_label: r.data_label,
      why_needed: `${names.slice(0, 3).join('・')}${names.length > 3 ? ` 他${names.length - 3}件` : ''}の判定に必要`,
      acceptable_sources: acceptable,
      manual_input_allowed: tmpl.manual_input_allowed,
      upload_allowed: tmpl.upload_allowed,
      template_kind: tmpl.template_kind,
      expected_confidence_after_submission: tmpl.expected_confidence_after_submission,
      current_blocking_status: r.blocking_status,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort(
    (a, b) => (order[a.priority] - order[b.priority]) || b.target_kasans.length - a.target_kasans.length,
  );
  return out;
}

// judgeResult に data_requests を付与（evidence_labels を読み込んで構築）
export async function attachDataRequests(judgeResult, { labelConfig = null } = {}) {
  if (!judgeResult || typeof judgeResult !== 'object') return judgeResult;
  const cfg = labelConfig || (await loadEvidenceLabels());
  judgeResult.data_requests = buildDataRequests({ judgeResult, labelConfig: cfg });
  return judgeResult;
}
