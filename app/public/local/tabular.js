// 表形式（Excel/CSV）からの加算集計値の抽出（依存なし）。
//
// 入力は SheetJS 等でパース済みの { header: string[], rows: any[][] }。
// 方針: 「必要な列だけを読む」ホワイトリスト方式。氏名・被保険者番号などの列は
// そもそも読まないため、個別値は出力に一切入らない。個別行は集計後に破棄する。

import { isPiiHeader } from './pii.js';

const ZENKAKU_DIGITS = '０１２３４５６７８９';
function z2h(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const idx = ZENKAKU_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[\s　]/g, '').replace(/[（）()【】\[\]]/g, '');
}

// 列ヘッダ → 役割の判定（ホワイトリスト）
const COL_ROLE_RULES = [
  ['care_level', ['要介護度', '介護度', '要介護/要支援', '認定区分', '要介護・要支援']],
  ['ninchi', ['認知症高齢者の日常生活自立度', '認知症自立度', '日常生活自立度', '認知症高齢者']],
  ['qualification', ['保有資格', '資格', '職種', '職名']],
  ['fte', ['常勤換算', '常勤換算数', 'fte', '換算数']],
];

function classifyColumn(header) {
  const n = normalize(header);
  if (!n) return null;
  for (const [role, keywords] of COL_ROLE_RULES) {
    if (keywords.some((kw) => n.includes(normalize(kw)))) return role;
  }
  return null;
}

// セル値 → 要介護度キー（youkaigo_3 等）。該当なしは null。
export function parseCareLevel(cell) {
  const s = z2h(String(cell ?? '')).replace(/[\s　]/g, '');
  let m = s.match(/要介護\s*([1-5])/);
  if (m) return `youkaigo_${m[1]}`;
  m = s.match(/要支援\s*([12])/);
  if (m) return `youshien_${m[1]}`;
  // 「介護3」「支援1」など省略表記
  m = s.match(/(?:^|[^支])護\s*([1-5])/);
  if (m) return `youkaigo_${m[1]}`;
  return null;
}

const PROFESSION_KEYWORDS = [
  // より具体的なキーワードを先に（部分一致の取り違え防止: 准看護師⊃看護師, 主任〜⊃介護支援専門員）
  ['assistant_nurse', ['准看護師', '准看']],
  ['nurse', ['看護師', '正看護師', '正看']],
  ['care_worker', ['介護福祉士']],
  ['physical_therapist', ['理学療法士', 'pt']],
  ['occupational_therapist', ['作業療法士', 'ot']],
  ['speech_therapist', ['言語聴覚士', 'st']],
  ['chief_care_manager', ['主任介護支援専門員', '主任ケアマネ']],
  ['care_manager', ['介護支援専門員', 'ケアマネ']],
  ['registered_dietitian', ['管理栄養士']],
  ['dietitian', ['栄養士']],
  ['dental_hygienist', ['歯科衛生士']],
];

// セル値 → 職種キー（nurse 等）。該当なしは null。
export function parseProfession(cell) {
  const n = normalize(cell);
  if (!n) return null;
  for (const [key, keywords] of PROFESSION_KEYWORDS) {
    if (keywords.some((kw) => n.includes(normalize(kw)))) return key;
  }
  return null;
}

function toNumber(cell) {
  const n = Number(z2h(String(cell ?? '')).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// メイン: { type, header, rows } → { userSummary?, staffSummary?, readColumns, droppedColumns }
export function extractTabular({ type, header = [], rows = [] } = {}) {
  const cols = header.map((h, i) => ({ index: i, name: String(h ?? ''), role: classifyColumn(h), pii: isPiiHeader(h) }));
  const readColumns = [];
  const droppedColumns = cols
    .filter((c) => !c.role)
    .map((c) => ({ name: c.name, pii: c.pii }));

  const result = { readColumns, droppedColumns };

  if (type === 'user_roster') {
    const careCol = cols.find((c) => c.role === 'care_level');
    const ninchiCol = cols.find((c) => c.role === 'ninchi');
    const distribution = {};
    const ninchiDist = {};
    let counted = 0;
    for (const row of rows) {
      if (careCol) {
        const key = parseCareLevel(row[careCol.index]);
        if (key) {
          distribution[key] = (distribution[key] || 0) + 1;
          counted += 1;
        }
      }
      if (ninchiCol) {
        const raw = z2h(String(row[ninchiCol.index] ?? '')).replace(/[\s　]/g, '');
        if (raw) ninchiDist[raw] = (ninchiDist[raw] || 0) + 1;
      }
    }
    if (careCol) {
      readColumns.push(careCol.name);
      const care3plus =
        (distribution.youkaigo_3 || 0) + (distribution.youkaigo_4 || 0) + (distribution.youkaigo_5 || 0);
      result.userSummary = {
        activeUserCount: counted,
        careLevelDistribution: distribution,
        care3PlusCount: care3plus,
        care3PlusRatio: counted > 0 ? Math.round((care3plus / counted) * 10000) / 10000 : null,
      };
      if (ninchiCol && Object.keys(ninchiDist).length) {
        readColumns.push(ninchiCol.name);
        result.userSummary.ninchiJiritsudoDistribution = ninchiDist;
      }
    }
  }

  if (type === 'staff_roster') {
    const qualCol = cols.find((c) => c.role === 'qualification');
    const fteCol = cols.find((c) => c.role === 'fte');
    const counts = {};
    const fte = {};
    if (qualCol) {
      readColumns.push(qualCol.name);
      if (fteCol) readColumns.push(fteCol.name);
      for (const row of rows) {
        const prof = parseProfession(row[qualCol.index]);
        if (!prof) continue;
        counts[prof] = (counts[prof] || 0) + 1;
        if (fteCol) fte[prof] = Math.round(((fte[prof] || 0) + toNumber(row[fteCol.index])) * 10000) / 10000;
      }
      result.staffSummary = {
        qualifiedPersonCountByProfession: counts,
        fteByProfession: fteCol ? fte : {},
        hasExternalPtOtSt: false,
      };
    }
  }

  return result;
}
