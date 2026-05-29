// ファイル種別判定（規則ベース・依存なし）。
//
// ファイル名・本文テキスト・表ヘッダのキーワードをスコアリングして書類種別を返す。
// 確信度が低い場合は、ブラウザ側で小型 LLM による補助判定にフォールバックできる
// （LLM 連携は local-import.js 側のオプション。本モジュールは決定的な規則のみ）。

export const DOC_TYPES = ['receipt', 'user_roster', 'staff_roster', 'tenant_status', 'unknown'];

// type ごとの判定キーワード（本文/ヘッダ/ファイル名を連結した正規化文字列に対して部分一致）
const RULES = {
  receipt: [
    '介護給付費明細', '給付費明細', '明細書', 'サービスコード', '単位数', 'レセプト',
    '請求明細', '国保連', '保険請求額', '公費請求額',
  ],
  user_roster: [
    '利用者一覧', '利用者台帳', '受給者台帳', '要介護度', '要介護', '要支援', '介護度',
    '認定有効期間', '認知症高齢者', '日常生活自立度', '利用者番号', '被保険者一覧',
  ],
  staff_roster: [
    '勤務形態一覧', '勤務表', '職員名簿', '従業者', '常勤換算', '常勤', '非常勤',
    '資格', '看護師', '介護福祉士', '理学療法士', '勤務時間', 'シフト', '雇用形態',
  ],
  tenant_status: [
    '体制等状況一覧', '体制届', '加算届', '届出書', '体制届出', '介護給付費算定に係る体制',
    '受理通知', '届出受理', '算定に係る届出',
  ],
};

function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[\s　]/g, '');
}

// { fileName, text, headers } を受け取り { type, confidence, signals } を返す
export function classifyDocument({ fileName = '', text = '', headers = [] } = {}) {
  const headerStr = (Array.isArray(headers) ? headers : []).join(' ');
  // ファイル名・ヘッダは種別語が出やすいので重み付け（×3 / ×2）
  const haystack = normalize(`${fileName} ${fileName} ${fileName} ${headerStr} ${headerStr} ${text}`);

  const scores = {};
  const matched = {};
  for (const [type, keywords] of Object.entries(RULES)) {
    let score = 0;
    const hits = [];
    for (const kw of keywords) {
      if (haystack.includes(normalize(kw))) {
        score += 1;
        hits.push(kw);
      }
    }
    scores[type] = score;
    matched[type] = hits;
  }

  // 表ヘッダの構造ヒント（列名が確実な手がかりになる）
  const normHeaders = (Array.isArray(headers) ? headers : []).map(normalize);
  const hasHeader = (kw) => normHeaders.some((h) => h.includes(normalize(kw)));
  if (hasHeader('要介護') || hasHeader('介護度') || hasHeader('認定区分')) scores.user_roster += 2;
  if (hasHeader('資格') || hasHeader('職種') || hasHeader('常勤換算') || hasHeader('勤務形態')) {
    scores.staff_roster += 2;
  }

  let bestType = 'unknown';
  let bestScore = 0;
  for (const type of Object.keys(RULES)) {
    if (scores[type] > bestScore) {
      bestScore = scores[type];
      bestType = type;
    }
  }

  let confidence = 'none';
  if (bestScore >= 3) confidence = 'high';
  else if (bestScore === 2) confidence = 'medium';
  else if (bestScore === 1) confidence = 'low';

  if (bestScore === 0) bestType = 'unknown';

  return { type: bestType, confidence, signals: { scores, matched } };
}
