// 地域単価（級地）対応。
//
// 仕組み:
//   - regulatory_master/regional_unit_prices.json から級地別の上乗せ率と
//     サービス別人件費割合を読み込み
//   - yen/単位 = 10 × (1 + 上乗せ率 × 人件費割合)
//
// 利用箇所:
//   - portfolio.js: 月額収益見積もりで yen_per_unit として使う
//   - 他、加算の実取得額を概算するすべての箇所
//
// 入力:
//   - serviceKey: 'tsusho_kaigo' など
//   - grade:      '1' | '2' | '3' | '4' | '5' | '6' | '7' | 'other'
//
// 出力: number （yen/単位）。未知サービスは _default 人件費割合で計算。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TABLE_PATH = path.resolve(
  __dirname,
  '../../../regulatory_master/regional_unit_prices.json',
);

let cached = null;

function loadTable() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(TABLE_PATH, 'utf-8');
    cached = JSON.parse(raw);
  } catch (err) {
    console.warn(`[regional-pricing] load failed: ${err.message}`);
    cached = {
      grades: { other: { label: 'その他', upper_rate: 0 } },
      service_labor_ratios: { _default: 0.45 },
    };
  }
  return cached;
}

export function listGrades() {
  const t = loadTable();
  return Object.entries(t.grades || {}).map(([key, g]) => ({
    grade: key,
    label: g.label,
    upper_rate: g.upper_rate,
    example_regions: g.example_regions || null,
  }));
}

// 級地は string で受け取る（フロントから "1" "2" ... "other"）
// 不明値は 'other' にフォールバック。
export function normalizeGrade(grade) {
  if (grade == null) return 'other';
  const s = String(grade).trim().toLowerCase().replace(/級地$/, '');
  if (s === '' || s === 'other' || s === 'その他') return 'other';
  if (/^[1-7]$/.test(s)) return s;
  return 'other';
}

export function laborRatio(serviceKey) {
  const t = loadTable();
  const ratios = t.service_labor_ratios || {};
  const v = ratios[serviceKey];
  if (typeof v === 'number') return v;
  return typeof ratios._default === 'number' ? ratios._default : 0.45;
}

export function yenPerUnit(serviceKey, grade) {
  const t = loadTable();
  const g = normalizeGrade(grade);
  const upper = t.grades?.[g]?.upper_rate ?? 0;
  const labor = laborRatio(serviceKey);
  // 10 × (1 + 上乗せ率 × 人件費割合) を小数点 2 桁で丸める
  const yen = 10 * (1 + upper * labor);
  return Math.round(yen * 100) / 100;
}

export function describeGrade(grade) {
  const t = loadTable();
  const g = normalizeGrade(grade);
  return t.grades?.[g] || t.grades?.other || { label: 'その他', upper_rate: 0 };
}
