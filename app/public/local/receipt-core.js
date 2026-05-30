// 介護給付費明細書テキスト → evidence の純ロジック（プラットフォーム非依存・依存なし）。
//
// ブラウザのローカル前処理エンジン（/local-import）と、サーバの receipt-pdf.js の
// 双方から import される共有モジュール。node:fs 等のランタイム依存を一切持たないため、
// ブラウザ（WASM/pdf.js でテキスト抽出後）でもそのまま動く。
//
// PDF/ファイル I/O を伴う関数（extractFromPdf / runExtraction 等）は
// app/src/services/receipt-pdf.js 側に残す。

// Python 版との互換性: extraction_version でランタイムを識別する。
export const EXTRACTION_VERSION = 'v2026.05.06-alpha.4.4-nodejs';

export const SERVICE_CODE_MAPPING_STATUS = {
  tsusho_kaigo: {
    status: 'pattern_based_unverified',
    source: '社内資料 skills/regulatory/TSUSHO_KAIGO.md + DEMO fixture',
    note: '通所介護のサービスコードは社内資料・大臣基準告示に基づくが、公式サービスコード表との完全一致は未検証。帳票形式により抽出精度が変動する。',
  },
  houmon_kaigo: {
    status: 'pattern_based_unverified',
    source: '社内資料 skills/regulatory/HOUMON_KAIGO.md + DEMO fixture',
    note: '訪問介護のサービスコードは社内資料に基づくが、公式サービスコード表との完全一致は未検証。帳票形式により抽出精度が変動する。',
  },
  kyotaku_shien: {
    status: 'pattern_based_unverified',
    source: '社内資料 skills/regulatory/KYOTAKU_SHIEN.md + 加算マスタ kyotaku_shien.json + DEMO fixture',
    note: '居宅介護支援のサービスコードは社内マスタに基づくが、公式サービスコード表との完全一致は未検証。特定事業所加算(I)の40%要件は地域包括紹介除外などPDFのみでは確定できない。帳票形式により抽出精度が変動する。',
  },
  houmon_kango_kaigo: {
    status: 'pattern_based_unverified',
    source: '社内資料 skills/regulatory/HOUMON_KANGO.md + 加算マスタ houmon_kango_kaigo.json + DEMO fixture',
    note: '訪問看護（介護保険）のサービスコードは社内マスタに基づくが、公式サービスコード表との完全一致は未検証。介護保険版のみ対応・医療保険版（訪問看護療養費）は別管理。帳票形式により抽出精度が変動する。',
  },
  sogoubu_tsusho: {
    status: 'municipal_variant_unmapped',
    source: '総合事業（介護予防・日常生活支援総合事業）の通所型独自サービス。市町村ごとにコード体系が異なるため、共通の加算マスタは持たない。',
    note: '加算名（処遇改善加算・提供体制加算・科学的介護推進体制加算 等）の本文一致で算定中加算を集計する。要支援1/2/事業対象者の区別はサービスコードからは推定できない。詳細な要件判定は無料のローカル版では非対応（高精度版で対応予定）。',
  },
};

const ZENKAKU_DIGITS = '０１２３４５６７８９';
export function z2h(s) {
  let out = '';
  for (const ch of s) {
    const idx = ZENKAKU_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

const TSUSHO_KASAN_PATTERNS = [
  ['kobetsu_kinou_I_i', '個別機能訓練加算Ⅰ(イ)', '155051', '個別機能訓練加算Ⅰ1'],
  ['kobetsu_kinou_I_ro', '個別機能訓練加算Ⅰ(ロ)', '155053', '個別機能訓練加算Ⅰ2'],
  ['kobetsu_kinou_II_life', '個別機能訓練加算Ⅱ', '155052', '個別機能訓練加算Ⅱ'],
  ['nyuyoku_I', '入浴介助加算Ⅰ', '155301', '入浴介助加算Ⅰ'],
  ['nyuyoku_II', '入浴介助加算Ⅱ', '155302', '入浴介助加算Ⅱ'],
  ['koukuu_kinou_I', '口腔機能向上加算Ⅰ', '155501', '口腔機能向上'],
  ['eiyou_assessment', '栄養アセスメント加算', '156116', '栄養アセスメント'],
  ['eiyou_kaizen', '栄養改善加算', '156112', '栄養改善'],
  ['kagakuteki_kaigo', '科学的介護推進体制加算', '156361', '科学的介護推進'],
  ['chujudosha_care_taisei', '中重度者ケア体制加算', '156271', '中重度者ケア体制加算'],
  ['ninchi_kasan', '認知症加算', '156274', '認知症加算'],
  ['adl_iji', 'ADL維持等加算', '156275', 'ADL維持'],
];

const HOUMON_KASAN_PATTERNS = [
  ['shokai_kasan', '初回加算', '116200', '初回加算'],
  ['seikatsu_kinou_renkei_I', '生活機能向上連携加算(I)', '116301', '生活機能向上連携加算Ⅰ'],
  ['seikatsu_kinou_renkei_II', '生活機能向上連携加算(II)', '116302', '生活機能向上連携加算Ⅱ'],
  ['ninchi_senmon_care_I', '認知症専門ケア加算(I)', '116401', '認知症専門ケア加算Ⅰ'],
  ['ninchi_senmon_care_II', '認知症専門ケア加算(II)', '116402', '認知症専門ケア加算Ⅱ'],
  ['kinkyu_houmon', '緊急時訪問介護加算', '116500', '緊急時訪問介護加算'],
  ['koukuu_renkei_kyouka', '口腔連携強化加算', '116600', '口腔連携強化加算'],
  ['tokutei_jigyousho_I', '特定事業所加算(I)', '116100', '特定事業所加算Ⅰ'],
  ['tokutei_jigyousho_II', '特定事業所加算(II)', '116101', '特定事業所加算Ⅱ'],
  ['tokutei_jigyousho_III', '特定事業所加算(III)', '116102', '特定事業所加算Ⅲ'],
  ['tokutei_jigyousho_IV', '特定事業所加算(IV)', '116103', '特定事業所加算Ⅳ'],
  ['tokutei_jigyousho_V', '特定事業所加算(V)', '116104', '特定事業所加算Ⅴ'],
  ['shougu_kaizen_kasan', '介護職員処遇改善加算', null, '処遇改善加算'],
];

const HOUMON_SERVICE_CATEGORIES = [
  ['shintai_kaigo', '身体介護', /身体[0-9]/],
  ['seikatsu_enjyo', '生活援助', /生活[0-9]/],
  ['shintai_seikatsu', '身体生活', /身体生活|身生/],
  ['tsuuin_jouko', '通院等乗降介助', /通院乗降|乗降介助/],
  ['futari_kaigo', '2人介護', /2人介護|二人介護|複数訪問/],
];

const HOUMON_TIME_BANDS = [
  ['soucho', '早朝(6:00-8:00)', /早朝/],
  ['yakan', '夜間(18:00-22:00)', /夜間/],
  ['shinya', '深夜(22:00-6:00)', /深夜/],
];

const HOUMON_KANGO_KAIGO_KASAN_PATTERNS = [
  ['kinkyu_houmon_kango_kasan_I', '緊急時訪問看護加算(I)', '136100', '緊急時訪問看護加算Ⅰ'],
  ['kinkyu_houmon_kango_kasan_II', '緊急時訪問看護加算(II)', '136101', '緊急時訪問看護加算Ⅱ'],
  ['tokubetsu_kanri_kasan_I', '特別管理加算(I)', '136200', '特別管理加算Ⅰ'],
  ['tokubetsu_kanri_kasan_II', '特別管理加算(II)', '136201', '特別管理加算Ⅱ'],
  ['terminal_care_kasan', 'ターミナルケア加算', '136300', 'ターミナルケア加算'],
  ['kango_taisei_kyouka_kasan_I', '看護体制強化加算(I)', '136400', '看護体制強化加算Ⅰ'],
  ['kango_taisei_kyouka_kasan_II', '看護体制強化加算(II)', '136401', '看護体制強化加算Ⅱ'],
  ['service_taisei_kyouka_kasan_I', 'サービス提供体制強化加算(I)', '136500', 'サービス提供体制強化加算Ⅰ'],
  ['service_taisei_kyouka_kasan_II', 'サービス提供体制強化加算(II)', '136501', 'サービス提供体制強化加算Ⅱ'],
  ['taiin_kyoudou_shidou_kasan', '退院時共同指導加算', '136600', '退院時共同指導加算'],
  ['kango_kaigo_renkei_kyouka_kasan', '看護・介護職員連携強化加算', '136700', '看護・介護職員連携強化加算'],
  ['koukuu_renkei_kyouka_kasan', '口腔連携強化加算', '136800', '口腔連携強化加算'],
  ['kagakuteki_kaigo_suishin_kasan', '科学的介護推進体制加算', '136900', '科学的介護推進体制加算'],
  ['shokai_kasan_I', '初回加算(I)', '131000', '初回加算Ⅰ'],
  ['shokai_kasan_II', '初回加算(II)', '131001', '初回加算Ⅱ'],
  ['shougu_kaizen_kasan_2026_06', '介護職員等処遇改善加算', null, '処遇改善加算'],
  ['fukusu_mei_houmon_kango_kasan', '複数名訪問看護加算（介護保険版・要根拠確認）', null, '複数名訪問看護加算'],
  ['chouji_kan_houmon_kango_kasan', '長時間訪問看護加算（介護保険版・要根拠確認）', null, '長時間訪問看護加算'],
  ['ninchi_senmon_care_kasan', '認知症専門ケア加算（訪問看護版・要根拠確認）', null, '認知症専門ケア加算'],
];

const KYOTAKU_SHIEN_KASAN_PATTERNS = [
  ['kyotaku_shien_I', '居宅介護支援費(I)', '431001', '居宅介護支援費Ⅰ'],
  ['kyotaku_shien_II', '居宅介護支援費(II)', '432001', '居宅介護支援費Ⅱ'],
  ['shokai_kasan', '初回加算', '438700', '初回加算'],
  ['nyuin_jouhou_renkei_I', '入院時情報連携加算(I)', '438200', '入院時情報連携加算Ⅰ'],
  ['nyuin_jouhou_renkei_II', '入院時情報連携加算(II)', '438201', '入院時情報連携加算Ⅱ'],
  ['taiin_taisho_kasan_I_i', '退院・退所加算(I)イ', '438301', '退院・退所加算Ⅰイ'],
  ['taiin_taisho_kasan_I_ro', '退院・退所加算(I)ロ', '438302', '退院・退所加算Ⅰロ'],
  ['taiin_taisho_kasan_II_i', '退院・退所加算(II)イ', '438303', '退院・退所加算Ⅱイ'],
  ['taiin_taisho_kasan_II_ro', '退院・退所加算(II)ロ', '438304', '退院・退所加算Ⅱロ'],
  ['taiin_taisho_kasan_III', '退院・退所加算(III)', '438305', '退院・退所加算Ⅲ'],
  ['tsuuin_jouhou_renkei', '通院時情報連携加算', '438400', '通院時情報連携加算'],
  ['kinkyu_kyotaku_conference', '緊急時等居宅カンファレンス加算', '438500', '緊急時等居宅カンファレンス加算'],
  ['terminal_care_management', 'ターミナルケアマネジメント加算', '438600', 'ターミナルケアマネジメント加算'],
  ['tokutei_jigyousho_I', '特定事業所加算(I)', '438100', '特定事業所加算Ⅰ'],
  ['tokutei_jigyousho_II', '特定事業所加算(II)', '438101', '特定事業所加算Ⅱ'],
  ['tokutei_jigyousho_III', '特定事業所加算(III)', '438102', '特定事業所加算Ⅲ'],
  ['tokutei_jigyousho_IV', '特定事業所加算(IV)', '438103', '特定事業所加算Ⅳ'],
  ['tokutei_jigyousho_A', '特定事業所加算(A)', '438104', '特定事業所加算A'],
  ['tokutei_jigyousho_iryou_kaigo', '特定事業所医療介護連携加算', '438800', '特定事業所医療介護連携加算'],
  ['shougu_kaizen_kasan_2026_06', '処遇改善加算（R8.6新規対象）', null, '処遇改善加算'],
];

// 総合事業（介護予防・日常生活支援総合事業）の通所型独自サービス。
// コード A6xxxx は市町村ごとに体系が異なるため、kasan_patterns はコード非依存（matchName 一致のみ）。
const SOGOUBU_TSUSHO_KASAN_PATTERNS = [
  ['sogoubu_tsusho_shougu_kaizen', '通所型独自サービス処遇改善加算', null, '処遇改善加算'],
  ['sogoubu_tsusho_taisei_kyouka', '通所型独自サービス提供体制加算', null, '提供体制加算'],
  ['sogoubu_tsusho_kagakuteki', '通所型独自サービス科学的介護推進体制加算', null, '科学的介護推進体制加算'],
  ['sogoubu_tsusho_kobetsu_kinou', '通所型独自サービス個別機能訓練加算', null, '個別機能訓練加算'],
  ['sogoubu_tsusho_nyuyoku', '通所型独自サービス入浴介助加算', null, '入浴介助加算'],
  ['sogoubu_tsusho_koukuu', '通所型独自サービス口腔機能向上加算', null, '口腔機能向上加算'],
  ['sogoubu_tsusho_eiyou_kaizen', '通所型独自サービス栄養改善加算', null, '栄養改善加算'],
  ['sogoubu_tsusho_eiyou_assessment', '通所型独自サービス栄養アセスメント加算', null, '栄養アセスメント'],
];

export const SERVICE_PATTERNS = {
  tsusho_kaigo: {
    kasan_patterns: TSUSHO_KASAN_PATTERNS,
    care_level_regex: /通所介護[ⅠⅡ]([1-9])([1-5])(?!\d)/,
    service_name_keyword: '通所介護',
  },
  houmon_kaigo: {
    kasan_patterns: HOUMON_KASAN_PATTERNS,
    service_categories: HOUMON_SERVICE_CATEGORIES,
    time_bands: HOUMON_TIME_BANDS,
    service_code_prefix: '11',
    care_level_regex: /訪問介護[ⅠⅡⅢ]?([1-9])([1-5])?(?!\d)/,
    service_name_keyword: '訪問介護',
  },
  kyotaku_shien: {
    kasan_patterns: KYOTAKU_SHIEN_KASAN_PATTERNS,
    service_code_prefix: '43',
    care_level_regex: /居宅介護支援費[ⅠⅡ]([1-9])([1-5])(?!\d)/,
    service_name_keyword: '居宅介護支援',
  },
  houmon_kango_kaigo: {
    kasan_patterns: HOUMON_KANGO_KAIGO_KASAN_PATTERNS,
    service_code_prefix: '13',
    care_level_regex: /訪問看護[ⅠⅡⅢ]?([1-9])([1-5])?(?!\d)/,
    service_name_keyword: '訪問看護',
  },
  sogoubu_tsusho: {
    kasan_patterns: SOGOUBU_TSUSHO_KASAN_PATTERNS,
    service_code_prefix: 'A6',
    service_name_keyword: '通所型独自サービス',
    care_level_inference: 'yoshien_sogoubu', // A-prefix 検出時に「要支援/事業対象者」とみなす
    service_code_codes_unmapped: true, // 市町村ごとにコード体系が異なるため、未マッピングコードは "unknown" 扱いしない
  },
};

export function analyzeText(text, serviceKey) {
  if (!(serviceKey in SERVICE_PATTERNS)) {
    return {
      warnings: [
        `service_key=${serviceKey}はalpha.4.4ではPDF取込未対応。tsusho_kaigo / houmon_kaigo / kyotaku_shien / houmon_kango_kaigoのみ対応。医療保険版（houmon_kango_iryo）は別管理で準備中。`,
      ],
      current_kasan_counts: {},
      current_kasan_ratios: {},
      detected_service_codes: [],
      care_level_distribution: {},
      yokaigo_3plus_ratio: null,
      raw_yokaigo_3plus_ratio: null,
      total_users_estimated: 0,
      service_category_counts: {},
      time_band_counts: {},
      unknown_service_codes: [],
    };
  }

  const config = SERVICE_PATTERNS[serviceKey];
  const patterns = config.kasan_patterns;
  let pages = text.split(/\f|=== ?PAGE ?\d+ ?===/g).filter((p) => p.trim());
  if (pages.length === 0) pages = [text];

  const careLevels = [];
  const kasanCounter = new Map();
  const detectedCodes = new Set();
  const serviceCategoryCounter = new Map();
  const timeBandCounter = new Map();
  const unknownCodes = new Set();
  const warnings = [];

  const careLevelRegex = config.care_level_regex;
  const codePrefix = config.service_code_prefix;
  const serviceCategories = config.service_categories || [];
  const timeBands = config.time_bands || [];

  // 要介護状態区分欄の選択肢列ラベル（フォームテンプレート由来）。
  // 選択された値ではなく「全選択肢の見出し」がテキスト抽出に混入するため、
  // テキストベースの fallback 検出ではここを先に除去する。
  const LABEL_LIST_PATTERNS = [
    /事業対象者\s*[・･]?\s*要支援\s*1\s*[・･]?\s*要支援\s*2/g,
    /要介護\s*1\s*[・･]?\s*要介護\s*2\s*[・･]?\s*要介護\s*3\s*[・･]?\s*要介護\s*4\s*[・･]?\s*要介護\s*5/g,
  ];

  const escapedPrefix = codePrefix
    ? codePrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    : null;
  // (?<![A-Za-z\d])PREFIX\d{4}(?![\d]): 事業所番号(10桁等) の一部や、英字の続きを service code と
  // 誤検出しないようガード。textZ2H（空白含む）に対して走らせるので、隣接する単位数値とも区別できる。
  const codeRegex = escapedPrefix ? new RegExp(`(?<![A-Za-z\\d])${escapedPrefix}\\d{4}(?![\\d])`, 'g') : null;
  const skipUnknown = Boolean(config.service_code_codes_unmapped);

  for (const pageText of pages) {
    const textZ2H = z2h(pageText);
    const textNoSpace = textZ2H.replace(/\s/g, '');

    // === care_level 抽出：3段階のフォールバック ===
    let careLevelForPage = null;
    // (1) サービスコード由来の正規表現（例: 通所介護Ⅰ31 → 要介護1）
    if (careLevelRegex) {
      const m = textZ2H.match(careLevelRegex);
      if (m && m[2]) careLevelForPage = `要介護${m[2]}`;
    }
    // (2) 総合事業推定：A-prefix コードがあれば要支援/事業対象者とみなす
    if (!careLevelForPage && config.care_level_inference === 'yoshien_sogoubu') {
      // textZ2H（空白含む）に対して letter/digit 境界を確認
      if (/(?<![A-Za-z\d])A\d{5}(?![\d])/.test(textZ2H)) {
        careLevelForPage = '要支援';
      }
    }
    // (3) テキスト直接マッチ（ラベル列除去後）
    if (!careLevelForPage) {
      let debiased = textZ2H;
      for (const pat of LABEL_LIST_PATTERNS) debiased = debiased.replace(pat, '');
      if (/事業対象者/.test(debiased)) careLevelForPage = '事業対象者';
      else {
        const ys = debiased.match(/要支援\s*([12])/);
        const yk = debiased.match(/要介護\s*([1-5])/);
        if (ys) careLevelForPage = `要支援${ys[1]}`;
        else if (yk) careLevelForPage = `要介護${yk[1]}`;
      }
    }
    if (careLevelForPage) careLevels.push(careLevelForPage);

    // === 加算名マッチ ===
    for (const [kasanKey, , code, matchName] of patterns) {
      if (textNoSpace.includes(matchName)) {
        kasanCounter.set(kasanKey, (kasanCounter.get(kasanKey) || 0) + 1);
        if (code && textNoSpace.includes(code)) detectedCodes.add(code);
      }
    }

    for (const [catKey, , regex] of serviceCategories) {
      if (regex.test(textZ2H)) {
        serviceCategoryCounter.set(catKey, (serviceCategoryCounter.get(catKey) || 0) + 1);
      }
    }

    for (const [bandKey, , regex] of timeBands) {
      if (regex.test(textZ2H)) {
        timeBandCounter.set(bandKey, (timeBandCounter.get(bandKey) || 0) + 1);
      }
    }

    // === サービスコード収集（境界保護つき・textZ2H 上で走らせて隣接する単位数値と区別） ===
    if (codeRegex) {
      let cm;
      while ((cm = codeRegex.exec(textZ2H)) !== null) {
        const code = cm[0];
        const known = patterns.some((p) => p[2] === code);
        if (known || skipUnknown) {
          detectedCodes.add(code);
        } else if (!detectedCodes.has(code)) {
          unknownCodes.add(code);
        }
      }
    }
  }

  const total = pages.length;
  const careLevelDist = {};
  for (const lv of careLevels) careLevelDist[lv] = (careLevelDist[lv] || 0) + 1;
  const yokaigo3plus =
    (careLevelDist['要介護3'] || 0) + (careLevelDist['要介護4'] || 0) + (careLevelDist['要介護5'] || 0);
  const yokaigo3plusRatio = total ? Math.round((yokaigo3plus / total) * 10000) / 10000 : null;

  if (total === 0) warnings.push('pages=0: 抽出対象テキストが空');
  if (!careLevels.length && total > 0)
    warnings.push(
      'care_level: 要介護度・要支援度を1件も抽出できず（PDFのフォーマット要確認 / フォーム内に要介護状態区分の選択肢列ラベルのみで選択値が伝わらない形式の可能性）',
    );
  if (!kasanCounter.size && total > 0)
    warnings.push('kasan: 算定中加算を1件も抽出できず（PDFフォーマット要確認）');
  if (unknownCodes.size) {
    const sorted = [...unknownCodes].sort();
    const CAP = 10;
    const display = sorted.slice(0, CAP);
    const remaining = sorted.length - display.length;
    const formatted = `[${display.map((c) => `'${c}'`).join(', ')}${remaining > 0 ? `, ...+${remaining}件` : ''}]`;
    warnings.push(`unknown_service_code: 既知パターン外のサービスコードを検出 ${formatted}`);
  }

  const isKyotakuShien = serviceKey === 'kyotaku_shien';
  if (isKyotakuShien) {
    warnings.push(
      'kyotaku_shien: 特定事業所加算(I)の40%要件は地域包括紹介除外などPDFのみで確定できない。raw_yokaigo_3plus_ratioは参考値。',
    );
  }
  if (serviceKey === 'sogoubu_tsusho') {
    warnings.push(
      'sogoubu_tsusho: 総合事業（市町村独自サービス）はコード体系が地域ごとに異なります。要支援1/要支援2/事業対象者の区別はサービスコードからは推定できません。詳細な要件判定（高精度版）は有料プランで対応予定です。',
    );
  }

  const kasanCountsObj = Object.fromEntries(kasanCounter);
  const kasanRatiosObj = total
    ? Object.fromEntries(
        [...kasanCounter.entries()].map(([k, v]) => [k, Math.round((v / total) * 10000) / 10000]),
      )
    : {};

  return {
    warnings,
    current_kasan_counts: kasanCountsObj,
    current_kasan_ratios: kasanRatiosObj,
    detected_service_codes: [...detectedCodes].sort(),
    care_level_distribution: careLevelDist,
    yokaigo_3plus_ratio: isKyotakuShien ? null : yokaigo3plusRatio,
    raw_yokaigo_3plus_ratio: yokaigo3plusRatio,
    total_users_estimated: total,
    service_category_counts: Object.fromEntries(serviceCategoryCounter),
    time_band_counts: Object.fromEntries(timeBandCounter),
    unknown_service_codes: [...unknownCodes].sort(),
  };
}

export function calculateConfidence(extracted) {
  const total = extracted.total_users_estimated || 0;
  if (total === 0) return 'none';
  const cl = extracted.care_level_distribution || {};
  const kasanCount = Object.keys(extracted.current_kasan_counts || {}).length;
  const clTotal = Object.values(cl).reduce((a, b) => a + b, 0);
  const clCoverage = total ? clTotal / total : 0;
  if (clCoverage >= 0.8 && kasanCount >= 3) return 'high';
  if (clCoverage >= 0.5) return 'medium';
  return 'low';
}

function isoNoMs(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

export function buildEvidence(office, service, tenant, extracted, sourceFileName) {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const evidenceId = `receipt_pdf_${office}_${ts}`;
  const mapping = SERVICE_CODE_MAPPING_STATUS[service] || {
    status: 'source_required',
    source: 'unknown',
    note: 'サービスコードマッピング未登録',
  };
  return {
    _meta: {
      schema: 'evidence',
      schema_version: '1.2',
      office_code: office,
      tenant_id: tenant || 'unknown',
      updated: isoNoMs(now),
    },
    evidence: [
      {
        evidence_id: evidenceId,
        tenant_id: tenant || 'unknown',
        office_code: office,
        service_key: service,
        source_type: 'receipt_pdf',
        source_file_name: sourceFileName,
        extracted_at: isoNoMs(now),
        extraction_version: EXTRACTION_VERSION,
        detected_claim_status: 'detected_in_receipt_pdf',
        detection_scope: 'aggregated_claim_items_only',
        not_detected_policy:
          'PDF未検出は未算定を意味しない。サービスコード未収載・帳票形式違い・OCR不可等の要因がある。',
        requirement_policy: 'PDF検出は算定中の推定であり、要件充足確認は別途必要。',
        pii_policy: {
          保存しない項目: ['被保険者番号', '氏名', 'カナ氏名', '住所', '電話番号', '生年月日'],
          保存する項目: ['要介護度分布(集計値)', '算定中加算の件数(集計値)', 'サービスコード'],
          policy_note: '個人を特定できる情報は意図的に抽出・保存しない設計。集計値・統計値のみを残す。',
        },
        total_pages: extracted.total_users_estimated || 0,
        total_users_estimated: extracted.total_users_estimated || 0,
        care_level_distribution: extracted.care_level_distribution || {},
        yokaigo_3plus_ratio: extracted.yokaigo_3plus_ratio,
        current_kasan_counts: extracted.current_kasan_counts || {},
        current_kasan_ratios: extracted.current_kasan_ratios || {},
        detected_service_codes: extracted.detected_service_codes || [],
        service_category_counts: extracted.service_category_counts || {},
        time_band_counts: extracted.time_band_counts || {},
        unknown_service_codes: extracted.unknown_service_codes || [],
        raw_yokaigo_3plus_ratio: extracted.raw_yokaigo_3plus_ratio,
        warnings: extracted.warnings || [],
        extraction_confidence: calculateConfidence(extracted),
        service_code_mapping_status: mapping.status,
        service_code_mapping_source: mapping.source,
        pattern_confidence_note: mapping.note,
      },
    ],
  };
}
