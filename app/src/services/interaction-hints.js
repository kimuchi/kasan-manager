// 加算同士の連動（chain bonuses）のヒント生成。
//
// 介護報酬には「処遇改善加算」「特定処遇改善加算」「ベースアップ等支援加算」のように
// 介護報酬本体（基本サービス費 + 各種加算）の総額に対して一定%が上乗せされる加算がある。
// PoC として、これらの「乗算系加算」を判定結果から検出し、
// 候補加算の「実際の上乗せ効果」をパーセントで提示する。
//
// なお実装は単純化しており、加算本体ごとの「処遇改善加算 対象/対象外」を厳密には判別しない。
// すべての加算が同じ multiplier の対象と仮定。実運用では適用範囲を厳密化する必要がある。

// 乗算系加算（介護報酬本体に対する % 上乗せ）の概算値。
// kasan_key 毎の rate は告示によって異なり、サービス・区分でも違うので「概算」。
const MULTIPLICATIVE_KASAN_RATES = {
  shoguu_kaizen_I: 0.137, // 通所介護 13.7% など。サービスで差異あり
  shoguu_kaizen_II: 0.1,
  shoguu_kaizen_III: 0.055,
  tokutei_shoguu_I: 0.027,
  tokutei_shoguu_II: 0.012,
  base_up_shien: 0.022,
};

// judgement の状態が「取得済（実取得 or 要件クリア）」かどうか
function isActiveJudgement(jud) {
  return jud?.algorithm_judgement === 'currently_claimed' || jud?.algorithm_judgement === 'clear';
}

// judgeResult から、現在算定中／クリア済の「乗算系加算」の合計%を返す
export function aggregateMultiplicativeBonus(judgeResult) {
  if (!judgeResult?.judgements) return { rate: 0, applied_kasans: [] };
  const applied = [];
  let rate = 0;
  for (const [key, rateFor] of Object.entries(MULTIPLICATIVE_KASAN_RATES)) {
    const jud = judgeResult.judgements[key];
    if (jud && isActiveJudgement(jud)) {
      rate += rateFor;
      applied.push({ kasan_key: key, kasan_name: jud.name || key, rate: rateFor });
    }
  }
  return { rate: Math.round(rate * 10000) / 10000, applied_kasans: applied };
}

// 候補加算 1 つに対する連動ヒントを返す。
// - 候補自身が乗算系なら「× N% の影響範囲」を説明する
// - 候補が乗算対象なら「処遇改善連動で実質 +X 円/月」を説明する
export function buildInteractionHint({ kasanKey, baseRevenuePerMonth, judgeResult }) {
  if (MULTIPLICATIVE_KASAN_RATES[kasanKey] != null) {
    // この候補自体が乗算系。基本サービス費総額がわからないと正確な金額は出せない。
    const rate = MULTIPLICATIVE_KASAN_RATES[kasanKey];
    return {
      type: 'multiplicative_self',
      rate,
      label: `この加算は介護報酬全体に約 ${(rate * 100).toFixed(1)}% を上乗せします`,
      bonus_yen_per_month: null,
    };
  }
  const agg = aggregateMultiplicativeBonus(judgeResult);
  if (agg.rate === 0 || !baseRevenuePerMonth) return null;
  const bonus = Math.round(baseRevenuePerMonth * agg.rate);
  return {
    type: 'chained_uplift',
    rate: agg.rate,
    applied_kasans: agg.applied_kasans,
    label: `処遇改善系の連動で実質 +${(agg.rate * 100).toFixed(1)}% （≈ ${bonus.toLocaleString('ja-JP')} 円/月 上乗せ）`,
    bonus_yen_per_month: bonus,
  };
}
