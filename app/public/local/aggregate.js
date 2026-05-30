// 抽出結果の集計（依存なし。receipt-core.js のみ利用）。
//
// - レセプト本文（複数ファイル）→ analyzeText/buildEvidence で kasan 件数 + evidence
// - 表形式の userSummary / staffSummary（複数ファイル）をマージ
// - 本文からサービス種別（service_key）を推定

import { SERVICE_PATTERNS, analyzeText, buildEvidence } from './receipt-core.js';

const ZENKAKU_DIGITS = '０１２３４５６７８９';
function z2h(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const idx = ZENKAKU_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

// レセプト本文からサービス種別を推定。最もヒットの多い service_key を返す（なければ null）。
// service_name_keyword（例: '通所型独自サービス'）を最優先に重み付け：これにより
// matchName が短い汎用名（'処遇改善加算' 等）でも、複数サービス間で正しく弁別できる。
export function detectServiceKeyFromText(text) {
  const raw = z2h(String(text ?? ''));
  const t = raw.replace(/\s/g, '');
  let best = null;
  let bestScore = 0;
  for (const [serviceKey, config] of Object.entries(SERVICE_PATTERNS)) {
    let score = 0;
    if (config.service_name_keyword && t.includes(config.service_name_keyword.replace(/\s/g, ''))) {
      score += 5;
    }
    if (config.care_level_regex && config.care_level_regex.test(raw)) score += 2;
    if (config.service_code_prefix) {
      const escaped = config.service_code_prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      // (?<![A-Za-z\d])…(?![\d]) で 10桁の事業所番号や英字に接続したコードを誤検出しない。
      // 走査対象は空白を保持した raw（隣接する単位数値とコードを境界で区別するため）。
      const re = new RegExp(`(?<![A-Za-z\\d])${escaped}\\d{4}(?![\\d])`, 'g');
      const m = raw.match(re);
      if (m) score += Math.min(m.length, 5);
    }
    for (const [, , code, matchName] of config.kasan_patterns) {
      if (matchName && t.includes(matchName.replace(/\s/g, ''))) score += 1;
      if (code && t.includes(code)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = serviceKey;
    }
  }
  return best;
}

// 複数のレセプト本文をまとめて 1 つの extracted + evidence にする。
// texts は各ファイルの抽出テキスト（既に PII スクラブ済みであること）。
export function aggregateReceiptTexts(texts, { serviceKey, office = 'local', sourceLabel = null } = {}) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => t && String(t).trim());
  // analyzeText はページ区切り（\f）で件数を数えるので、ファイル間も \f で連結する
  const combined = list.join('\f');
  const extracted = analyzeText(combined, serviceKey);
  const label = sourceLabel || `ローカル集計（${list.length}ファイル）`;
  const evidence = buildEvidence(office, serviceKey, null, extracted, label);
  return { extracted, evidence };
}

// 複数の userSummary（表抽出結果）を加算マージ
export function mergeUserSummaries(summaries) {
  const list = (summaries || []).filter(Boolean);
  if (!list.length) return null;
  const distribution = {};
  let total = 0;
  const ninchi = {};
  for (const s of list) {
    total += Number(s.activeUserCount || 0);
    for (const [k, v] of Object.entries(s.careLevelDistribution || {})) {
      distribution[k] = (distribution[k] || 0) + Number(v || 0);
    }
    for (const [k, v] of Object.entries(s.ninchiJiritsudoDistribution || {})) {
      ninchi[k] = (ninchi[k] || 0) + Number(v || 0);
    }
  }
  const care3plus =
    (distribution.youkaigo_3 || 0) + (distribution.youkaigo_4 || 0) + (distribution.youkaigo_5 || 0);
  const out = {
    activeUserCount: total,
    careLevelDistribution: distribution,
    care3PlusCount: care3plus,
    care3PlusRatio: total > 0 ? Math.round((care3plus / total) * 10000) / 10000 : null,
  };
  if (Object.keys(ninchi).length) out.ninchiJiritsudoDistribution = ninchi;
  return out;
}

// 複数の staffSummary（表抽出結果）を加算マージ
export function mergeStaffSummaries(summaries) {
  const list = (summaries || []).filter(Boolean);
  if (!list.length) return null;
  const counts = {};
  const fte = {};
  let hasExternal = false;
  for (const s of list) {
    for (const [k, v] of Object.entries(s.qualifiedPersonCountByProfession || {})) {
      counts[k] = (counts[k] || 0) + Number(v || 0);
    }
    for (const [k, v] of Object.entries(s.fteByProfession || {})) {
      fte[k] = Math.round(((fte[k] || 0) + Number(v || 0)) * 10000) / 10000;
    }
    if (s.hasExternalPtOtSt) hasExternal = true;
  }
  return { qualifiedPersonCountByProfession: counts, fteByProfession: fte, hasExternalPtOtSt: hasExternal };
}
