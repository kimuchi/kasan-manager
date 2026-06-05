import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const REGULATORY_ROOT = path.join(PROJECT_ROOT, 'regulatory_master');
const REGISTRY_PATH = path.join(REGULATORY_ROOT, 'service_registry.json');

let cachedRegistry = null;
const cachedMasters = new Map();

export async function loadRegistry() {
  if (cachedRegistry) return cachedRegistry;
  const raw = await readFile(REGISTRY_PATH, 'utf-8');
  cachedRegistry = JSON.parse(raw);
  return cachedRegistry;
}

export async function listServices() {
  const registry = await loadRegistry();
  return registry.services.map((s) => ({
    service_key: s.service_key,
    display_name: s.display_name,
    domain: s.domain,
    domain_label: registry.domains?.[s.domain]?.display_name ?? s.domain,
    payer: s.payer,
    status: s.status,
    status_label: registry.statuses?.[s.status] ?? s.status,
    revision_tag: s.revision_tag,
    effective_from: s.effective_from,
  }));
}

export async function findService(serviceKey) {
  const registry = await loadRegistry();
  return registry.services.find((s) => s.service_key === serviceKey) || null;
}

export async function loadMaster(serviceKey) {
  if (cachedMasters.has(serviceKey)) return cachedMasters.get(serviceKey);
  const service = await findService(serviceKey);
  if (!service) {
    throw new Error(`サービスキーが見つかりません: ${serviceKey}`);
  }
  const masterPath = path.join(PROJECT_ROOT, service.master_file);
  if (!existsSync(masterPath)) {
    throw new Error(`マスタファイルが存在しません: ${masterPath}`);
  }
  const raw = await readFile(masterPath, 'utf-8');
  const master = JSON.parse(raw);
  const enriched = { ...service, master };
  cachedMasters.set(serviceKey, enriched);
  return enriched;
}

export function summarizeKasansForPrompt(master) {
  const kasans = master?.master?.kasans || {};
  const entries = Object.entries(kasans);
  if (entries.length === 0) {
    return '（この区分は加算マスタが未整備です。一般的な制度知識から提案してください）';
  }
  return entries
    .map(([key, k]) => {
      const reqText = formatRequirements(k.requirements || {});
      const unit = k.unit_per_day ?? k.unit ?? k.unit_per_month ?? '?';
      const unitType = k.unit_type ?? '単位';
      const tips = Array.isArray(k.tips) ? k.tips.join(' / ') : '';
      const lines = [
        `- [${key}] ${k.name}（${unit} ${unitType}）`,
        `  要件: ${reqText}`,
      ];
      // PR-5: 公式根拠未確認の項目は AI に具体値・職種・配置時間・頻度を断定させない
      if (k.source_status && k.source_status !== 'checked') {
        lines.push(`  ⚠️ 根拠未確認(source_status=${k.source_status}): 具体的な配置時間・頻度・職種・割合を断定しないこと`);
      }
      if (k.ai_output_policy) lines.push(`  ⚠️ AI出力ポリシー: ${k.ai_output_policy}`);
      if (k.official_interpretation_note) lines.push(`  注記: ${k.official_interpretation_note}`);
      if (k.eligible_evaluator_roles && k.eligible_evaluator_roles.source_status === 'needs_review') {
        lines.push(`  注記: 評価者の職種は未確定（${k.eligible_evaluator_roles.note || '公式通知確認後に確定'}）`);
      }
      if (tips) lines.push(`  ヒント: ${tips}`);
      if (k.hourei_konkyo) lines.push(`  根拠: ${k.hourei_konkyo}`);
      return lines.join('\n');
    })
    .join('\n');
}

function formatRequirements(req) {
  if (!req || typeof req !== 'object') return '（要件未記載）';
  const parts = [];
  for (const [k, v] of Object.entries(req)) {
    if (typeof v === 'string') parts.push(`${k}=${v}`);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`);
    else if (Array.isArray(v)) parts.push(`${k}=[${v.slice(0, 4).join(',')}${v.length > 4 ? '…' : ''}]`);
    else if (v && typeof v === 'object') {
      const sub = Object.entries(v)
        .filter(([sk]) => !sk.startsWith('_'))
        .slice(0, 3)
        .map(([sk, sv]) => `${sk}:${typeof sv === 'object' ? JSON.stringify(sv).slice(0, 60) : sv}`)
        .join('; ');
      parts.push(`${k}{${sub}}`);
    }
  }
  return parts.join(' / ') || '（要件未記載）';
}
