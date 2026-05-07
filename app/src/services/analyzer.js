// Gemini を使った augmented 分析。
// 既存の `judge` エンジンが返す決定的レポート（JSON / Markdown）に Gemini で
// 「取り方アクション」「不足情報の補完案」「アップロード追加資料からの示唆」を加える。

import { generateAnalysis, getModelName } from './gemini.js';
import { run as runJudge } from './judge.js';
import { renderMarkdown } from './markdown-report.js';
import { runExtraction } from './receipt-pdf.js';
import { summarizeKasansForPrompt, loadMaster as loadServiceMaster } from './regulator.js';

const SYSTEM_PROMPT = `あなたは日本の介護保険・障害福祉に精通した加算（報酬加算）分析の専門家です。
渡された決定的判定エンジンの結果（取得済み・確認待ち・対象外・情報不足の仕分け）と、
事業所が補足した自由記述・添付ファイル抜粋を組み合わせて、
「次にとるべきアクション」「取り漏れの可能性が高い加算」「現場で見落とされやすい OR 条件・代替資格・外部連携ルート」
を構造化された日本語 JSON で返してください。

姿勢:
- 決定的判定エンジンが waiting / unknown とした加算には、判定で必要な追加情報・確認手順を必ず添える。
- 「取れない」で終わらせず、最短で取得できるルートを示す（例: 介護福祉士70%が無理でも勤続10年以上25%ルート）。
- 公開情報の範囲で答え、最終確認は自治体・社労士に委ねる旨を明記する。
- 障害福祉では処遇改善・福祉専門職員配置・目標工賃達成指導員・ピアサポート・特定事業所・福祉専門職員配置等加算を意識する。
- 増収目安は判定エンジンが計算済みの値があればそれを尊重し、独自に上書きしない。`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '300〜500字の総合所見（決定的判定の結論を踏まえる）' },
    estimated_total_revenue_increase: {
      type: 'string',
      description: '取得候補が成立した場合の月次/年次の概算（判定エンジンの「取得可能性が高い加算」セクションを集計）',
    },
    top_actions: {
      type: 'array',
      description: '優先順位付きで最大5件のアクション',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'why', 'steps'],
      },
    },
    candidates: {
      type: 'array',
      description: '取得候補・優先確認候補の加算',
      items: {
        type: 'object',
        properties: {
          kasan_key: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', description: 'ready / waiting / blocked / unknown のいずれか' },
          unit: { type: 'string' },
          requirement_summary: { type: 'string' },
          missing_info: { type: 'array', items: { type: 'string' } },
          recommended_actions: { type: 'array', items: { type: 'string' } },
          revenue_estimate: { type: 'string' },
        },
        required: ['name', 'status', 'requirement_summary', 'recommended_actions'],
      },
    },
    cautions: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'top_actions', 'candidates', 'cautions'],
};

function judgementsToPromptLines(result) {
  const lines = [];
  const j = result.judgements || {};
  const buckets = ['clear', 'waiting', 'currently_claimed', 'claimed_but_requirements_unknown', 'not_clear', 'unknown'];
  for (const bucket of buckets) {
    const items = Object.entries(j).filter(([, v]) => v.algorithm_judgement === bucket);
    if (!items.length) continue;
    lines.push(`【${bucket}】`);
    for (const [k, v] of items.slice(0, 25)) {
      const reasons = Object.entries(v.requirements_judgement || {})
        .map(([rk, rj]) => `${rk}=${rj.status}${rj.reason ? `(${rj.reason})` : ''}`)
        .join('; ');
      lines.push(`- ${v.name} [${k}] ${reasons || '(要件未記載)'}`);
    }
    if (items.length > 25) lines.push(`  ... 他 ${items.length - 25} 件`);
  }
  if (result.evidence_applied && result.evidence) {
    lines.push('【PDF evidence】');
    const counts = result.evidence.current_kasan_counts || {};
    for (const [k, c] of Object.entries(counts).slice(0, 20)) {
      lines.push(`- ${k}: ${c}件`);
    }
    if (result.evidence.yokaigo_3plus_ratio != null) {
      lines.push(`- yokaigo_3plus_ratio: ${(result.evidence.yokaigo_3plus_ratio * 100).toFixed(1)}%`);
    }
  }
  return lines.join('\n');
}

function buildUserPrompt({ judgeResult, master, officeInfo, freeText, attachments }) {
  const masterSummary = summarizeKasansForPrompt(master);
  const sd = judgeResult.service_def || {};
  const judgeLines = judgementsToPromptLines(judgeResult);
  const attachmentText =
    attachments && attachments.length
      ? attachments
          .map((a, i) => `--- 添付${i + 1}: ${a.filename}（${a.kind}, ${a.size_bytes}B）---\n${a.text_excerpt}`)
          .join('\n\n')
      : '（添付なし）';

  return `# 分析対象サービス
- ${sd.display_name}（service_key: ${judgeResult.service}）
- ドメイン: ${sd.domain} / 支払者: ${sd.payer}
- マスタ版: ${(judgeResult.master_meta || {}).version || '?'} / 改定タグ: ${(judgeResult.master_meta || {}).revision_tag || '?'}

# 事業所基本情報（フォーム入力）
${formatOfficeInfo(officeInfo)}

# 自由記述
${freeText || '（記載なし）'}

# 添付ファイルからの抜粋テキスト
${attachmentText}

# 決定的判定エンジンの結果（既に確定値）
${judgeLines || '（判定対象加算なし）'}

# 加算マスタ
${masterSummary}

# 出力指示
- 上記の決定的判定を出発点に、不足情報・代替ルート・取得手順を提案してください。
- candidates の status は ready/waiting/blocked/unknown のいずれかを使用。
- 月次/年次の増収見込みは判定エンジン側のヒントを尊重し、独自計算を断定しない。
- 障害福祉対象の場合は処遇改善・福祉専門職員配置・目標工賃達成指導員・ピアサポート・特定事業所等にも触れる。`;
}

function formatOfficeInfo(info = {}) {
  if (!info || !Object.keys(info).length) return '（未入力）';
  return Object.entries(info)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

export async function analyzeOffice({
  service,
  office,
  officeInfo,
  freeText,
  attachments,
  pdfFile,
  tenantStatusFile,
  staffFile,
  userSummaryFile,
  useGemini = true,
}) {
  // 1. PDF があればその場で evidence を作る（保存はしない）
  let inlineEvidence = null;
  if (pdfFile) {
    const r = await runExtraction({
      office: office || 'unknown',
      service,
      pdfBuffer: pdfFile.buffer,
      sourceName: pdfFile.originalname,
    });
    inlineEvidence = r.evidence;
  }

  // 2. 一時 JSON ファイルを使わずに、tenantStatus / staff / user_summary は inline で渡せる経路を持たせる
  const inlineFiles = {
    tenantStatus: tenantStatusFile ? JSON.parse(tenantStatusFile.buffer.toString('utf-8')) : null,
    staff: staffFile ? JSON.parse(staffFile.buffer.toString('utf-8')) : null,
    userSummary: userSummaryFile ? JSON.parse(userSummaryFile.buffer.toString('utf-8')) : null,
  };

  // 3. 判定エンジンを実行
  const judgeResult = await runJudge({
    service,
    office,
    applyEvidence: Boolean(inlineEvidence),
    inlineEvidence,
    // inline JSON は executive helper を介して評価
  });

  // 4. inline tenant_status / staff / user_summary を後付けで反映（DSL facts のみ）
  if (inlineFiles.tenantStatus || inlineFiles.staff || inlineFiles.userSummary) {
    const { evaluateRequirementLogic, buildFactsFromEvidence, mergeDemoTenantFacts,
      buildFactsFromStaffData, buildFactsFromUserSummary, mergeRequirementFacts,
      buildStaffSummaryDisplay, buildUserSummaryDisplay,
      loadEvidenceLabels, buildEvidenceChecklist,
    } = await import('./dsl.js');

    let facts = buildFactsFromEvidence(judgeResult.evidence, judgeResult.tenant_status);
    if (inlineFiles.tenantStatus) facts = mergeDemoTenantFacts(facts, inlineFiles.tenantStatus);
    const staffFacts = inlineFiles.staff ? buildFactsFromStaffData(inlineFiles.staff, service) : {};
    const userFacts = inlineFiles.userSummary ? buildFactsFromUserSummary(inlineFiles.userSummary, service) : {};
    facts = mergeRequirementFacts(facts, staffFacts, userFacts);

    const master = await loadServiceMaster(service);
    const kasans = master.master?.kasans || {};
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
    judgeResult.dsl_results = dslResults;
    judgeResult.staff_summary_display = buildStaffSummaryDisplay(staffFacts, service);
    judgeResult.user_summary_display = buildUserSummaryDisplay(userFacts, service);
    judgeResult.staff_data_loaded = Boolean(inlineFiles.staff);
    judgeResult.user_summary_loaded = Boolean(inlineFiles.userSummary);
    judgeResult.demo_tenant_status_loaded = Boolean(inlineFiles.tenantStatus);

    const labelConfig = await loadEvidenceLabels();
    judgeResult.evidence_checklist = buildEvidenceChecklist(dslResults, judgeResult.judgements, labelConfig);
  }

  // 5. Markdown レポートを生成
  const markdown = renderMarkdown(judgeResult);

  // 6. Gemini で augment
  let geminiResult = null;
  let geminiError = null;
  if (useGemini) {
    try {
      const master = await loadServiceMaster(service);
      const userPrompt = buildUserPrompt({ judgeResult, master, officeInfo, freeText, attachments });
      const { json, text, parseError } = await generateAnalysis({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        responseSchema: RESPONSE_SCHEMA,
      });
      geminiResult = { model: getModelName(), analysis: json, raw_text: json ? null : text, parse_error: parseError ?? null };
    } catch (err) {
      geminiError = err.message || String(err);
    }
  }

  return {
    service: {
      key: service,
      display_name: judgeResult.service_def?.display_name,
      domain: judgeResult.service_def?.domain,
      payer: judgeResult.service_def?.payer,
      revision_tag: judgeResult.master_meta?.revision_tag,
      master_version: judgeResult.master_meta?.version,
    },
    judge: judgeResult,
    markdown,
    gemini: geminiResult,
    gemini_error: geminiError,
  };
}
