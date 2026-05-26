// マスタ整合性レビューパケットのロード（alpha.5.9 〜 alpha.5.13）。
//
// Python の generate_alpha5_9..13 スクリプト群が `out/internal/` 配下に出力した
// 静的アーティファクト（CSV / Markdown / マニフェスト）を Node.js から読み取り、
// API および UI に流す。
//
// 設計:
//   - 読み取り専用。master JSON や out/ を一切書き換えない
//   - 起動時にメモリにロードし、in-memory で索引化（kasan_key → recommended_decision など）
//   - 公開しないアーティファクト（public release に含めない）はサーバ側だけで保持
//
// 公開する主な API:
//   listPackets()                          — 全パケットのメタ情報
//   getPriorityMatrix()                    — alpha5_13 の REVIEW_PRIORITY_MATRIX 全行
//   getFirstReviewBatch()                  — alpha5_13 の FIRST_REVIEW_BATCH（初回 10 件以下）
//   getSafeDefaultDecisions()              — Markdown 本体（safe default の説明）
//   getCioDecisionBrief()                  — CIO 30 分用 brief
//   getRecommendedDecisionFor(service, k)  — 加算 1 件に対する初期推奨判断
//   summarizePerServiceWorkload()          — サービス × ロールでの推奨工数集計

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const OUT_INTERNAL = path.join(PROJECT_ROOT, 'out', 'internal');

const PACKETS = [
  'alpha5_9_master_review_packet',
  'alpha5_10_reviewer_decision_gate',
  'alpha5_11_reviewer_handoff_workbook',
  'alpha5_12_reviewer_workflow_hardening',
  'alpha5_12_kimura_cio_handoff',
  'alpha5_13_review_workload_reducer',
];

// CSV 行をデータとして返す（BOM 削除 + '#' で始まるコメント行と空行スキップ）
function parseCsv(text) {
  if (!text) return [];
  const noBom = text.replace(/^﻿/, '');
  const lines = noBom.split(/\r?\n/);
  const rows = [];
  let header = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    const fields = splitCsvLine(raw);
    if (!header) {
      header = fields;
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = (fields[i] ?? '').trim();
    rows.push(row);
  }
  return rows;
}

// 簡易 CSV パーサ（ダブルクオート escape 対応）
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else if (c === '"' && cur === '') {
      inQ = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJsonSafe(filePath) {
  const raw = readFileSafe(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[master-review] JSON parse failed for ${filePath}: ${err.message}`);
    return null;
  }
}

// パケットメタ情報をまとめてロード
let cachedPackets = null;
export function listPackets() {
  if (cachedPackets) return cachedPackets;
  const result = [];
  for (const dir of PACKETS) {
    const dirPath = path.join(OUT_INTERNAL, dir);
    if (!fs.existsSync(dirPath)) continue;
    const manifestPath = findManifest(dirPath);
    const manifest = manifestPath ? readJsonSafe(manifestPath) : null;
    const readme = readFileSafe(path.join(dirPath, 'README.md'));
    const files = fs.readdirSync(dirPath).filter((n) => !n.startsWith('.'));
    result.push({
      dir,
      manifest_path: manifestPath ? path.relative(PROJECT_ROOT, manifestPath) : null,
      manifest,
      readme_summary: readme ? readme.split('\n').slice(0, 12).join('\n') : null,
      files,
    });
  }
  cachedPackets = result;
  return result;
}

function findManifest(dirPath) {
  const candidates = fs.readdirSync(dirPath).filter((n) => /manifest\.json$/.test(n));
  if (!candidates.length) return null;
  return path.join(dirPath, candidates[0]);
}

// alpha5_13 priority matrix 全件
let cachedMatrix = null;
export function getPriorityMatrix() {
  if (cachedMatrix) return cachedMatrix;
  const csvPath = path.join(OUT_INTERNAL, 'alpha5_13_review_workload_reducer', 'REVIEW_PRIORITY_MATRIX.csv');
  cachedMatrix = parseCsv(readFileSafe(csvPath));
  return cachedMatrix;
}

let cachedBatch = null;
export function getFirstReviewBatch() {
  if (cachedBatch) return cachedBatch;
  const csvPath = path.join(OUT_INTERNAL, 'alpha5_13_review_workload_reducer', 'FIRST_REVIEW_BATCH.csv');
  cachedBatch = parseCsv(readFileSafe(csvPath));
  return cachedBatch;
}

export function getSafeDefaultDecisions() {
  return readFileSafe(path.join(OUT_INTERNAL, 'alpha5_13_review_workload_reducer', 'SAFE_DEFAULT_DECISIONS.md'));
}

export function getCioDecisionBrief() {
  return readFileSafe(path.join(OUT_INTERNAL, 'alpha5_13_review_workload_reducer', 'CIO_30MIN_DECISION_BRIEF.md'));
}

export function getDeferredItems() {
  return readFileSafe(path.join(OUT_INTERNAL, 'alpha5_13_review_workload_reducer', 'DEFERRED_ITEMS.md'));
}

export function getReviewWorkloadByRole() {
  return readFileSafe(path.join(OUT_INTERNAL, 'alpha5_13_review_workload_reducer', 'REVIEW_WORKLOAD_BY_ROLE.md'));
}

// (service, kasan_key) に対する推奨初期判断と詳細を取得
let indexByKey = null;
export function getRecommendedDecisionFor(service, kasanKey) {
  if (!indexByKey) {
    indexByKey = new Map();
    for (const row of getPriorityMatrix()) {
      const k = `${row.service}__${row.kasan_key}`;
      indexByKey.set(k, row);
    }
  }
  return indexByKey.get(`${service}__${kasanKey}`) || null;
}

// サービス × バケット × リスクレベル の集計（簡易ダッシュボード用）
export function summarizePerServiceWorkload() {
  const rows = getPriorityMatrix();
  const byService = {};
  for (const r of rows) {
    if (!byService[r.service]) {
      byService[r.service] = {
        service: r.service,
        total: 0,
        first_batch: 0,
        by_bucket: {},
        by_role: {},
        by_risk: {},
        by_effort: {},
      };
    }
    const s = byService[r.service];
    s.total += 1;
    if (r.can_be_first_batch === 'yes') s.first_batch += 1;
    s.by_bucket[r.review_bucket] = (s.by_bucket[r.review_bucket] || 0) + 1;
    s.by_role[r.recommended_reviewer_role] = (s.by_role[r.recommended_reviewer_role] || 0) + 1;
    s.by_risk[r.risk_level] = (s.by_risk[r.risk_level] || 0) + 1;
    s.by_effort[r.review_effort] = (s.by_effort[r.review_effort] || 0) + 1;
  }
  return Object.values(byService).sort((a, b) => a.service.localeCompare(b.service));
}

// master JSON 内の audit 情報を直接読む（service_code_audit / mapping_status）
export function getMasterAuditFor(service, kasanKey) {
  const candidates = [
    path.join(PROJECT_ROOT, 'regulatory_master', 'kaigo', `${service}.json`),
    path.join(PROJECT_ROOT, 'regulatory_master', 'disability', `${service}.json`),
    path.join(PROJECT_ROOT, 'regulatory_master', 'medical', `${service}.json`),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const data = readJsonSafe(candidate);
    const kasan = data?.kasans?.[kasanKey] || data?.master?.kasans?.[kasanKey];
    if (!kasan) continue;
    return {
      overall_mapping_status: kasan.overall_mapping_status || null,
      service_code_mapping_status: kasan.service_code_mapping_status || null,
      service_code_audit: kasan.service_code_audit || null,
    };
  }
  return null;
}
