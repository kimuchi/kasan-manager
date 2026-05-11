#!/usr/bin/env node
// JSON Schema バリデーション CLI
//
// 使い方:
//   npm run validate:json -- --kind staff --input path/to/staff.json
//   npm run validate:json -- --schema schemas/staff.schema.json --input path/to/staff.json
//
// --kind 対応:
//   tenant_status / staff / user / user_summary / evidence / regulatory_master / cpos_export_bundle

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const SCHEMAS_DIR = path.join(PROJECT_ROOT, 'schemas');

const KIND_TO_SCHEMA = {
  tenant_status: 'tenant_status.schema.json',
  staff: 'staff.schema.json',
  user: 'user.schema.json',
  user_summary: 'user_summary.schema.json',
  evidence: 'evidence.schema.json',
  regulatory_master: 'regulatory_master.schema.json',
  cpos_export_bundle: 'cpos_export_bundle.schema.json',
  analysis_source: 'analysis_source.schema.json',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] !== undefined) {
      out[m[1]] = m[2];
    } else {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        out[m[1]] = next;
        i += 1;
      } else {
        out[m[1]] = true;
      }
    }
  }
  return out;
}

function fail(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(
      [
        '使い方:',
        '  npm run validate:json -- --kind <kind> --input <path>',
        '  npm run validate:json -- --schema <schema-path> --input <path>',
        '',
        '--kind 対応値:',
        ...Object.keys(KIND_TO_SCHEMA).map((k) => `  - ${k}`),
      ].join('\n'),
    );
    process.exit(0);
  }
  if (!args.input) fail('--input <JSON ファイルパス> は必須です');
  let schemaPath;
  if (args.schema) {
    schemaPath = path.resolve(String(args.schema));
  } else if (args.kind) {
    const file = KIND_TO_SCHEMA[String(args.kind)];
    if (!file) {
      fail(`--kind=${args.kind} は対応外です。--help で対応値を確認してください。`);
    }
    schemaPath = path.join(SCHEMAS_DIR, file);
  } else {
    fail('--kind か --schema のいずれかは必須です');
  }
  if (!existsSync(schemaPath)) fail(`スキーマファイルが見つかりません: ${schemaPath}`);
  if (!existsSync(String(args.input))) fail(`入力ファイルが見つかりません: ${args.input}`);

  const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));
  const data = JSON.parse(await readFile(String(args.input), 'utf-8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (ok) {
    console.log(`✅ valid: ${args.input} は ${path.basename(schemaPath)} に適合しています`);
    process.exit(0);
  }
  console.error(`❌ invalid: ${args.input}`);
  for (const err of validate.errors || []) {
    console.error(`  - ${err.instancePath || '$'}: ${err.message}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
