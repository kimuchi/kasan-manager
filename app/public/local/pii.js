// PII（個人情報）検出・除去（プラットフォーム非依存・依存なし）。
//
// 方針:
//   - 表形式（Excel/CSV）は tabular.js が「必要な列だけを読む」ホワイトリスト方式のため、
//     氏名・住所などの列はそもそも出力に入らない。isPiiHeader() は破棄列のラベル付け用。
//   - テキスト（PDF/OCR）由来の残存値は scrubText() で数値系 PII（被保険者番号・電話・
//     生年月日・郵便番号・メール・マイナンバー）を伏字化する。
//   - assertNoPii() は最終バンドルに数値系 PII が混入していないかの防御的チェック。
//     氏名・住所は正規表現で安定検出できないため、列ドロップ（tabular.js）で構造的に防ぐ。

// 数値・定型 PII の検出パターン。順序は伏字化の優先度。
export const PII_PATTERNS = [
  // メールアドレス
  { key: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // 元号つき生年月日（昭和63年4月1日 等）
  { key: 'birth_wareki', re: /(明治|大正|昭和|平成|令和)\s?\d{1,2}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日/g },
  // 西暦の年月日（2026年4月1日 / 2026-04-01 / 2026/04/01）
  { key: 'birth_seireki', re: /(?<!\d)(?:19|20)\d{2}[-/年]\s?\d{1,2}[-/月]\s?\d{1,2}\s?日?(?!\d)/g },
  // 電話番号（ハイフンあり）
  { key: 'phone_hyphen', re: /(?<!\d)0\d{1,4}-\d{1,4}-\d{3,4}(?!\d)/g },
  // 郵便番号
  { key: 'postal', re: /〒?\s?(?<!\d)\d{3}-\d{4}(?!\d)/g },
  // マイナンバー（12桁）
  { key: 'mynumber', re: /(?<!\d)\d{12}(?!\d)/g },
  // 被保険者番号（10桁）
  { key: 'hihokensha', re: /(?<!\d)\d{10}(?!\d)/g },
  // 電話番号（ハイフンなし・10〜11桁で 0 始まり）
  { key: 'phone_plain', re: /(?<!\d)0\d{9,10}(?!\d)/g },
];

// PII を含む可能性が高い列ヘッダ（表形式で「読まずに破棄」する列の判定）
const PII_HEADER_KEYWORDS = [
  '氏名', '名前', 'なまえ', 'フリガナ', 'ふりがな', 'カナ', 'かな', '氏名カナ',
  '利用者名', '利用者氏名', '職員名', '担当者', '担当者名', 'お名前',
  '被保険者番号', '被保番', '保険者番号', '受給者番号', '受給者証番号', '利用者番号', '整理番号',
  '住所', '現住所', '所在地', '連絡先', '電話', 'tel', '携帯', 'メール', 'mail', 'email',
  '生年月日', '生年', '個人番号', 'マイナンバー',
];

function normalizeHeader(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[（）()【】\[\]]/g, '');
}

// 列ヘッダが PII 列かどうか
export function isPiiHeader(header) {
  const n = normalizeHeader(header);
  if (!n) return false;
  return PII_HEADER_KEYWORDS.some((kw) => n.includes(normalizeHeader(kw)));
}

// assertNoPii 用の厳格サブセット。構造化バンドルに入り得る正規の値
// （ISO 日付 / serviceMonth=YYYY-MM / 6桁サービスコード / 件数）で誤検知しないものだけ。
// 日付パターンは ISO タイムスタンプと衝突するため assertNoPii からは除外し、scrubText 専用とする。
const STRICT_KEYS = new Set(['email', 'phone_hyphen', 'phone_plain', 'postal', 'mynumber', 'hihokensha']);

// テキストから検出した PII の一覧を返す（{ key, value } の配列）
// strict=true のときは STRICT_KEYS のパターンのみ（構造化データの最終チェック用）。
export function findPii(text, { strict = false } = {}) {
  const s = String(text ?? '');
  const hits = [];
  for (const { key, re } of PII_PATTERNS) {
    if (strict && !STRICT_KEYS.has(key)) continue;
    const rx = new RegExp(re.source, re.flags);
    let m;
    while ((m = rx.exec(s)) !== null) {
      hits.push({ key, value: m[0] });
      if (m.index === rx.lastIndex) rx.lastIndex += 1;
    }
  }
  return hits;
}

// テキスト中の PII を伏字化する（OCR/PDF 由来の自由テキスト用。全パターン適用）
export function scrubText(text) {
  let s = String(text ?? '');
  for (const { key, re } of PII_PATTERNS) {
    const rx = new RegExp(re.source, re.flags);
    s = s.replace(rx, `［除去:${key}］`);
  }
  return s;
}

// バンドル（オブジェクト）に PII が混入していないか検査（送信前の防御線）。
// 構造化データの正規値で誤検知しないよう厳格サブセットで走査する。混入時は Error。
export function assertNoPii(obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const hits = findPii(json, { strict: true });
  if (hits.length) {
    const sample = hits.slice(0, 3).map((h) => h.key).join(', ');
    throw new Error(
      `PII らしき値がアップロード対象に含まれています（${hits.length}件: ${sample} 等）。送信を中止しました。`,
    );
  }
  return true;
}
