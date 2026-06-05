// Gemini を使った augmented 分析。
// 既存の `judge` エンジンが返す決定的レポート（JSON / Markdown）に Gemini で
// 「取り方アクション」「不足情報の補完案」「アップロード追加資料からの示唆」を加える。

import { generateAnalysis, getModelName } from './gemini.js';
import { run as runJudge } from './judge.js';
import { renderMarkdown } from './markdown-report.js';
import { runExtraction } from './receipt-pdf.js';
import { summarizeKasansForPrompt, loadMaster as loadServiceMaster } from './regulator.js';
import { attachResultClassification } from './result-classifier.js';
import { attachDataRequests } from './data-request.js';
import { guardGeminiAnalysis } from './gemini-guard.js';

const SYSTEM_PROMPT = `あなたは日本の介護保険・障害福祉に精通した加算（報酬加算）分析の専門家です。
ただしあなたの役割は「決定的判定エンジンの結論を上書きすること」ではなく、
不足データの提案・取得手順の整理・代替ルートの示唆に限定されます。最終的な請求可否は決定的判定が決めます。

【厳守する禁止事項】
- 決定的判定が unknown / 情報不足 の加算を「取得可能」「算定可能」「請求できる」と書かない。
- 「算定中だが要件未確認（claimed_but_requirements_unknown）」を「エビデンスあり」「確認済み」と書かない。
- 利用者集計が未取得のとき、要介護3以上割合などの割合を 0.0%（や具体的数値）と書かない。「未取得」とする。
- 増収見込みは、対象者数・単位数・算定日数・地域単価のいずれかが欠ける場合は金額を出さず「未算出」とする。
- AIの一般知識に基づく提案は can_bill_now=false とし、「請求判断には使えない」と明示する。
- マスタに「根拠未確認(source_status=needs_review 等)」「AI出力ポリシー」が付いた加算は、配置時間・LIFE提出頻度・
  評価者の職種・割合などの具体値を断定しない（「公式通知で確認が必要」と表現する）。

【姿勢】
- 決定的判定が「あと一歩 / 追加データ必要」とした加算には、判定を固めるために提出すべき具体的データ
  （勤務形態一覧表・利用者集計・LIFE送信履歴・計画書・居宅訪問記録など）を missing_data_requests に列挙する。
- 公開情報の範囲で答え、最終確認は自治体・社労士に委ねる旨を明記する。
- 各候補には basis_level（deterministic / inferred / general_knowledge）を必ず付け、根拠の強さを正直に示す。`;

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
      description: '取得候補・優先確認候補の加算（請求可否は決定的判定に従属）',
      items: {
        type: 'object',
        properties: {
          kasan_key: { type: 'string' },
          name: { type: 'string' },
          status: {
            type: 'string',
            description:
              'deterministic_clear / claimed_evidence_risk / needs_data / ai_general_candidate / not_recommended のいずれか',
          },
          basis_level: {
            type: 'string',
            description: 'deterministic（決定的判定）/ inferred（推測）/ general_knowledge（一般知識）',
          },
          can_bill_now: { type: 'boolean', description: '請求してよいか。決定的に確認できた場合のみ true' },
          must_not_bill_reason: { type: 'string', description: 'can_bill_now=false の理由（請求してはいけない理由）' },
          unit: { type: 'string' },
          requirement_summary: { type: 'string' },
          missing_data_requests: {
            type: 'array',
            description: '判定を固めるために提出すべきデータ',
            items: {
              type: 'object',
              properties: {
                data_label: { type: 'string' },
                why_needed: { type: 'string' },
                acceptable_sources: { type: 'array', items: { type: 'string' } },
              },
              required: ['data_label', 'why_needed'],
            },
          },
          recommended_actions: { type: 'array', items: { type: 'string' } },
          revenue_estimate: {
            type: 'object',
            properties: {
              amount_text: { type: 'string' },
              calculation_formula: { type: 'string', description: '単位×対象者数×日数×地域単価。無ければ空' },
              assumptions: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'string', description: 'high / medium / low / not_calculable' },
            },
            required: ['amount_text', 'confidence'],
          },
        },
        required: ['name', 'status', 'basis_level', 'can_bill_now', 'requirement_summary', 'recommended_actions'],
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

  // P0-1: 実務向けの安全な分類を付与（UI/AI/Markdown 前に必ず実施）
  attachResultClassification(judgeResult);
  // PR-2: 不足データ提案を付与
  await attachDataRequests(judgeResult);

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
      // P0-3: Gemini 出力を決定的判定に従属させる（請求可否・増収断定の矯正）
      const guarded = json
        ? guardGeminiAnalysis(json, {
            classification: judgeResult.classification,
            classificationSummary: judgeResult.classification_summary,
          })
        : json;
      geminiResult = {
        model: getModelName(),
        analysis: guarded,
        raw_text: guarded ? null : text,
        parse_error: parseError ?? null,
      };
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
