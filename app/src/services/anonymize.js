// サーバ側の匿名化・要約レイヤ（多層防御）。
//
// 設計方針:
//   プロモードで受け取ったデータを「サーバ側でも必ず匿名化・要約してから保存する」。
//   ブラウザ側（public/local/*）で一次スクラブ済みでも、サーバを最終防衛線とする。
//   - 氏名・カナ・被保険者番号・住所・電話など PII を含むキーは丸ごと破棄
//   - 文字列値は scrubText で被保険者番号/電話/メール等を伏字化
//   - 個人単位レコードは「件数・比率・職種別集計」へ要約してから保存
//   - 保存直前に assertNoPii で最終チェック
//
// 既存のブラウザ純ロジック（pii.js / tabular.js）を import して同じ規則を共有する。

import { scrubText, isPiiHeader, findPii } from '../../public/local/pii.js';
import { parseProfession } from '../../public/local/tabular.js';

const MAX_STRING_LEN = 2000;
const MAX_ARRAY_LEN = 500;

// 職種キー → 表示ラベル（行識別の自動生成用。氏名は使わない）
const PROFESSION_LABELS = {
  nurse: '看護師',
  assistant_nurse: '准看護師',
  care_worker: '介護福祉士',
  physical_therapist: '理学療法士',
  occupational_therapist: '作業療法士',
  speech_therapist: '言語聴覚士',
  chief_care_manager: '主任ケアマネ',
  care_manager: 'ケアマネ',
  registered_dietitian: '管理栄養士',
  dietitian: '栄養士',
  dental_hygienist: '歯科衛生士',
};

// 明示的に破棄する個人識別キー（isPiiHeader の補完）。
const EXPLICIT_DROP_KEYS = [
  'name',
  'fullname',
  'full_name',
  'kana',
  'furigana',
  'firstname',
  'lastname',
  'givenname',
  'familyname',
  'birth',
  'birthday',
  'birthdate',
  'dob',
  'address',
  'tel',
  'phone',
  'email',
  'mail',
  'insurednumber',
  'hihokensha',
  'mynumber',
  'ssn',
];

function shouldDropKey(key, extraDropKeys = []) {
  if (!key) return false;
  const norm = String(key)
    .toLowerCase()
    .replace(/[\s_\-]/g, '');
  if (EXPLICIT_DROP_KEYS.includes(norm)) return true;
  if (extraDropKeys.some((k) => norm === String(k).toLowerCase().replace(/[\s_\-]/g, ''))) return true;
  // 日本語の氏名/住所/電話/被保険者番号などのヘッダ名はブラウザ規則を流用
  return isPiiHeader(key);
}

export function scrubString(s) {
  const scrubbed = scrubText(s);
  if (scrubbed.length <= MAX_STRING_LEN) return scrubbed;
  return `${scrubbed.slice(0, MAX_STRING_LEN)}…[truncated]`;
}

// 任意オブジェクトを保存用に再帰サニタイズ：PII キー破棄 + 文字列スクラブ + サイズ上限。
export function summarizeForStorage(value, { dropKeys = [], depth = 0 } = {}) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 12) return null; // 異常に深い構造は打ち切り
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LEN).map((v) => summarizeForStorage(v, { dropKeys, depth: depth + 1 }));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (shouldDropKey(k, dropKeys)) continue;
      out[k] = summarizeForStorage(v, { dropKeys, depth: depth + 1 });
    }
    return out;
  }
  return null;
}

// 従業員名簿（個人単位）→ 匿名集計。
// 入力 entries: [{ label?, role?, profession?, qualification?|qualifications?, fte?, joukin?, kinzokuYears?, shuninCm? }]
// 出力: 個人は識別できない構造化エントリ + 職種別集計。
export function anonymizeStaffRoster(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const qualifiedPersonCountByProfession = {};
  const fteByProfession = {};
  let headcount = 0;
  let joukinCount = 0;
  const sanitized = [];
  const seqByProfession = {};

  for (const raw of list.slice(0, MAX_ARRAY_LEN)) {
    if (!raw || typeof raw !== 'object') continue;
    headcount += 1;
    // 資格テキスト（配列 or 単一）から職種キーを推定
    const qualsRaw = Array.isArray(raw.qualifications)
      ? raw.qualifications
      : [raw.qualification, raw.role, raw.profession].filter(Boolean);
    const quals = qualsRaw.map((q) => scrubString(String(q))).filter(Boolean);
    let professionKey = null;
    for (const q of qualsRaw) {
      const p = parseProfession(String(q));
      if (p) {
        professionKey = p;
        break;
      }
    }
    const fte = Number.isFinite(Number(raw.fte)) ? Math.max(0, Math.min(2, Number(raw.fte))) : null;
    const joukin = raw.joukin === true || raw.isJoukin === true;
    if (joukin) joukinCount += 1;
    if (professionKey) {
      qualifiedPersonCountByProfession[professionKey] =
        (qualifiedPersonCountByProfession[professionKey] || 0) + 1;
      if (fte != null) {
        fteByProfession[professionKey] =
          Math.round(((fteByProfession[professionKey] || 0) + fte) * 10000) / 10000;
      }
    }
    // 氏名・自由ラベルは保存しない。行の識別は「職種 + 連番」で自動生成（PII を含み得ない）。
    const pkey = professionKey || 'staff';
    seqByProfession[pkey] = (seqByProfession[pkey] || 0) + 1;
    const label = `${PROFESSION_LABELS[professionKey] || '職員'}#${seqByProfession[pkey]}`;
    sanitized.push({
      label,
      professionKey,
      qualifications: quals.slice(0, 8),
      fte,
      joukin,
      kinzokuYears: Number.isFinite(Number(raw.kinzokuYears)) ? Number(raw.kinzokuYears) : null,
      shuninCm: raw.shuninCm === true,
    });
  }

  return {
    headcount,
    joukinCount,
    qualifiedPersonCountByProfession,
    fteByProfession,
    entries: sanitized,
  };
}

// 解析結果（judge result）を保存用に匿名化。
// judge result は元々ほぼ集計値だが、自由記述が紛れ込む余地のあるフィールドを破棄し、
// 文字列はスクラブする。
export function anonymizeAnalysisResult(judgeResult) {
  if (!judgeResult || typeof judgeResult !== 'object') return judgeResult;
  return summarizeForStorage(judgeResult, {
    dropKeys: ['office_name', 'concerns', 'free_text', 'freeText', 'staff_summary_text', 'user_summary_text'],
  });
}

// 保存直前の最終チェック：strict PII が残っていれば throw。
export function assertStorageSafe(obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const hits = findPii(json, { strict: true });
  if (hits.length) {
    const sample = hits.slice(0, 3).map((h) => h.key).join(', ');
    throw new Error(`保存対象に PII が残存（${hits.length}件: ${sample}）。保存を中止しました。`);
  }
  return true;
}
