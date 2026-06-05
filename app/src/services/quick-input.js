// PR-3: 10問のかんたん入力 → analysis_source 互換バンドル変換。
//
// ファイルが無い事業所でも「まず現状を取る」ための入口。入力は必ず低信頼度の仮データとして扱い、
// source_type='manual_quick_input' / confidence='low' / manual_quick_input=true を付ける。
// これだけで billable_now にはしない（result-classifier 側で請求OKに倒さないよう制御）。
// 主目的は「次に何を正式提出すれば判定が固まるか」を data-request として出すこと。

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// answers: 指示書 §6 の10問に対応するフラットなオブジェクト
export function quickInputToBundle(answers = {}) {
  const a = answers || {};
  const serviceKey = a.serviceKey || null;

  const activeUserCount = numOrNull(a.activeUserCount);
  const care3 = numOrNull(a.care3PlusCount);
  let userSummary;
  if (activeUserCount != null) {
    userSummary = { activeUserCount };
    if (care3 != null) {
      userSummary.care3PlusCount = care3;
      if (activeUserCount > 0) userSummary.care3PlusRatio = round4(care3 / activeUserCount);
    }
  }

  // 現在算定中の加算（kasan_key 配列）→ claimEvidence（件数は仮に1）
  const currentKasans = Array.isArray(a.currentKasans) ? a.currentKasans.filter(Boolean) : [];
  let claimEvidence;
  if (currentKasans.length) {
    claimEvidence = {
      _meta: { schema: 'evidence', schema_version: '1.2', source: 'manual_quick_input' },
      evidence: [
        {
          source_type: 'manual_quick_input',
          current_kasan_counts: Object.fromEntries(currentKasans.map((k) => [k, 1])),
          total_users_estimated: null,
          data_scope: { users: activeUserCount != null ? 'manual_quick_input' : 'not_included' },
          extraction_confidence: 'low',
          warnings: ['現在算定中の加算は手入力（自己申告）です。要件充足の確認には正式データが必要です。'],
        },
      ],
    };
  }

  // 自由記述的な現状メモ（LIFE・職種有無など）は warnings に残し、data_request の判断材料にする
  const notes = [];
  if (a.lifeSubmission) notes.push(`LIFE提出: ${a.lifeSubmission}${a.lifeLastMonth ? `（最終 ${a.lifeLastMonth}）` : ''}`);
  if (a.kinouKunren) notes.push(`機能訓練指導員: ${a.kinouKunren}`);
  if (a.kango) notes.push(`看護職員: ${a.kango}`);
  if (a.bathing) notes.push(`入浴: ${a.bathing}`);
  if (a.others) notes.push(`管理栄養士/歯科衛生士/外部連携: ${a.others}`);

  return {
    // schemaVersion は付けない（analysis_source schema の strict 検証を回避し、仮データとして通す）
    organizationId: 'manual-quick',
    serviceKey,
    serviceMonth: a.serviceMonth || null,
    facility: {
      id: a.facilityId || 'manual',
      name: a.facilityName || null,
      regionClass: a.regionGrade != null ? String(a.regionGrade) : null,
      serviceTypeCodes: Array.isArray(a.serviceTypeCodes) ? a.serviceTypeCodes : [],
    },
    userSummary,
    claimEvidence,
    // 低信頼度の仮データであることのフラグ（classifier / analyzeLocalBundle が参照）
    source_type: 'manual_quick_input',
    confidence: 'low',
    manual_quick_input: true,
    dataCompleteness: {
      facility: 'partial',
      users: userSummary ? 'partial' : 'missing',
      staffing: 'missing',
      billing: claimEvidence ? 'partial' : 'missing',
    },
    warnings: [
      '10問のかんたん入力による仮データ（低信頼度）です。確定判定には正式データの提出が必要です。',
      ...notes,
    ],
  };
}
