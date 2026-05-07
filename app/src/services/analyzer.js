import { generateAnalysis, getModelName } from './gemini.js';
import { loadMaster, summarizeKasansForPrompt } from './regulator.js';

const SYSTEM_PROMPT = `あなたは日本の介護保険・障害福祉に精通した加算（報酬加算）分析の専門家です。
事業所が提供する情報（職員構成・利用者構成・現状の体制・アップロード資料の抜粋など）と、与えられる加算マスタを照合して、
「取り漏れている可能性が高い加算」「すぐに整備すれば取得できる加算」「現状要件を満たしていない加算」を仕分けして提案します。

重要な姿勢:
- 「取れない」で終わらせず、「どうすれば取れるか」を必ず示す。
- 法令上の OR 条件・代替資格・外部連携ルートを意識する（例: 機能訓練指導員は PT/OT/ST だけでなく看護師・柔整師等でも可）。
- 公開情報の範囲で答え、最終確認は自治体・社労士に委ねる旨を明記する（推測を断定として書かない）。
- 数値（利用者数・職員数）は与えられた範囲で計算し、不明な場合は assumption に明示する。
- 障害福祉では「処遇改善」「福祉専門職員配置」「ピアサポート」「目標工賃達成指導員」など独特の加算に配慮する。
- 必ず JSON 形式で返す。日本語で記述し、固有名詞や法令名は省略しない。`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '事業所の状況を踏まえた総合所見（300〜500字程度）',
    },
    estimated_total_revenue_increase: {
      type: 'string',
      description: '取得候補が全て成立した場合の月次/年次の概算増収（例: 「月+約25万円 / 年+約300万円」）',
    },
    top_actions: {
      type: 'array',
      description: 'すぐ着手すべきアクションを優先順に最大5つ',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '短いアクション名' },
          why: { type: 'string', description: 'なぜ重要か（1〜2文）' },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: '具体的な着手ステップ',
          },
        },
        required: ['title', 'why', 'steps'],
      },
    },
    candidates: {
      type: 'array',
      description: '取得可能性が高い加算',
      items: {
        type: 'object',
        properties: {
          kasan_key: { type: 'string', description: 'マスタ上のキー（不明なら空文字）' },
          name: { type: 'string' },
          status: {
            type: 'string',
            description: 'ready / waiting / blocked / unknown のいずれか',
          },
          unit: { type: 'string', description: '単位数と単位タイプ（例: 45単位/日）' },
          requirement_summary: { type: 'string' },
          missing_info: {
            type: 'array',
            items: { type: 'string' },
            description: '判定に追加で必要な情報',
          },
          recommended_actions: {
            type: 'array',
            items: { type: 'string' },
          },
          revenue_estimate: {
            type: 'string',
            description: '月次/年次の増収見込み（不明なら「不明」）',
          },
        },
        required: ['name', 'status', 'requirement_summary', 'recommended_actions'],
      },
    },
    cautions: {
      type: 'array',
      items: { type: 'string' },
      description: '注意事項・前提条件・確認すべき法令や自治体ルール',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: '入力情報の不足を補うために置いた前提',
    },
  },
  required: ['summary', 'top_actions', 'candidates', 'cautions'],
};

function buildUserPrompt({ service, master, officeInfo, freeText, attachments }) {
  const serviceLabel = master.display_name || service;
  const masterMeta = master?.master?._meta || {};
  const masterSummary = summarizeKasansForPrompt(master);

  const attachmentText =
    attachments && attachments.length
      ? attachments
          .map(
            (a, i) =>
              `--- 添付${i + 1}: ${a.filename}（${a.kind}, ${a.size_bytes}B）---\n${a.text_excerpt}`,
          )
          .join('\n\n')
      : '（添付なし）';

  return `# 分析対象サービス
- サービス: ${serviceLabel}（service_key: ${service}）
- ドメイン: ${master.domain} / 支払者: ${master.payer}
- マスタ版: ${masterMeta.version || '?'} / 改定タグ: ${masterMeta.revision_tag || '?'}
- マスタ状況: ${master.status}（${masterMeta.source_status || ''}）

# 事業所基本情報（フォーム入力）
${formatOfficeInfo(officeInfo)}

# 利用者から記載された自由記述・気になっている加算
${freeText || '（記載なし）'}

# 添付ファイルからの抜粋テキスト
${attachmentText}

# 加算マスタ（このサービスで主に対象となる加算）
${masterSummary}

# 出力指示
- 上記の情報のみから判断できる範囲で、JSON スキーマに従った構造化レポートを返してください。
- candidates には可能な限り kasan_key を上記マスタからコピーしてください（マスタにない場合は空文字）。
- 「unknown」「missing_info」を恥ずかしがらず使い、根拠が薄い断定は避けてください。
- 月次・年次の増収見込みは可能な範囲で計算（地域単価が不明な場合は10円/単位と仮定し、その旨を assumptions に記載）。
- 障害福祉サービスの場合は処遇改善加算・福祉専門職員配置加算・地域加算・ピアサポート等の検討を必ず含めてください。`;
}

function formatOfficeInfo(info = {}) {
  if (!info || Object.keys(info).length === 0) return '（未入力）';
  return Object.entries(info)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

export async function analyzeOffice({ service, officeInfo, freeText, attachments }) {
  const master = await loadMaster(service);
  const userPrompt = buildUserPrompt({ service, master, officeInfo, freeText, attachments });
  const { json, text, parseError } = await generateAnalysis({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: RESPONSE_SCHEMA,
  });
  return {
    model: getModelName(),
    service: {
      key: service,
      display_name: master.display_name,
      domain: master.domain,
      payer: master.payer,
      revision_tag: master?.master?._meta?.revision_tag,
      master_version: master?.master?._meta?.version,
    },
    analysis: json,
    raw_text: json ? null : text,
    parse_error: parseError ?? null,
  };
}
