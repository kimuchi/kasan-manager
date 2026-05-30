// ローカル永続化フォールバック（Firestore 非設定環境向け）。
//
// Firebase / Firestore が設定されていない環境（ローカル開発・自前ホスティング・CI/テスト）でも、
// ユーザー・課金プラン・プロフィール・解析履歴を保存できるようにするための、
// 「Firestore 互換の最小サブセット」を実装する。
//
// 対応 API（services が実際に使う分だけ）:
//   db.collection(name).doc(id).get()/set()/update()/delete()
//   db.collection(name).add(obj)
//   db.collection(name).where(f,op,v).orderBy(f,dir).limit(n).get()
//   db.runTransaction(async (tx) => { tx.get(ref); tx.set(ref,obj); tx.update(ref,obj); })
//
// データ保持:
//   - KASAN_LOCAL_STORE_DIR=':memory:' → プロセス内メモリのみ（テスト用）
//   - それ以外 → 指定ディレクトリ（既定 <app>/.localstore）に collection ごとの JSON ファイル
//
// 注意: 単一プロセス前提の簡易実装。Firestore のトランザクション分離は持たない
// （関数を逐次実行するだけ）。本番でスケールアウトする場合は Firestore を設定すること。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');

// 値の deep clone（Date を ISO 文字列に正規化して保存と一致させる）
function clone(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(clone);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

// orderBy 比較用に Date/ISO文字列/数値を比較可能な数値へ
function comparableValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    return v;
  }
  return v;
}

class DocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = data !== null && data !== undefined;
  }
  data() {
    return this._data ? clone(this._data) : undefined;
  }
}

class DocRef {
  constructor(store, collection, id) {
    this._store = store;
    this._collection = collection;
    this.id = id;
  }
  async get() {
    const data = this._store._read(this._collection, this.id);
    return new DocSnapshot(this.id, data ?? null);
  }
  async set(obj) {
    this._store._write(this._collection, this.id, clone(obj));
  }
  async update(obj) {
    const cur = this._store._read(this._collection, this.id);
    if (!cur) throw new Error('not_found');
    this._store._write(this._collection, this.id, { ...cur, ...clone(obj) });
  }
  async delete() {
    this._store._delete(this._collection, this.id);
  }
}

class Query {
  constructor(store, collection) {
    this._store = store;
    this._collection = collection;
    this._filters = [];
    this._order = null;
    this._limit = null;
  }
  where(field, op, value) {
    this._filters.push({ field, op, value });
    return this;
  }
  orderBy(field, dir = 'asc') {
    this._order = { field, dir };
    return this;
  }
  limit(n) {
    this._limit = n;
    return this;
  }
  async get() {
    let rows = this._store._all(this._collection); // [{id, data}]
    for (const f of this._filters) {
      rows = rows.filter((r) => matchFilter(r.data?.[f.field], f.op, f.value));
    }
    if (this._order) {
      const { field, dir } = this._order;
      rows.sort((a, b) => {
        const av = comparableValue(a.data?.[field]);
        const bv = comparableValue(b.data?.[field]);
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = av < bv ? -1 : 1;
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    if (Number.isFinite(this._limit)) rows = rows.slice(0, this._limit);
    const docs = rows.map((r) => new DocSnapshot(r.id, r.data));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

function matchFilter(actual, op, value) {
  switch (op) {
    case '==':
      return actual === value;
    case '!=':
      return actual !== value;
    case 'in':
      return Array.isArray(value) && value.includes(actual);
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(value);
    case '>':
      return comparableValue(actual) > comparableValue(value);
    case '>=':
      return comparableValue(actual) >= comparableValue(value);
    case '<':
      return comparableValue(actual) < comparableValue(value);
    case '<=':
      return comparableValue(actual) <= comparableValue(value);
    default:
      return false;
  }
}

class CollectionRef extends Query {
  doc(id) {
    return new DocRef(this._store, this._collection, id || randomUUID());
  }
  async add(obj) {
    const id = randomUUID();
    this._store._write(this._collection, id, clone(obj));
    return new DocRef(this._store, this._collection, id);
  }
}

// トランザクション: 簡易（逐次実行・分離なし）
class LocalTransaction {
  constructor(store) {
    this._store = store;
  }
  async get(ref) {
    return ref.get();
  }
  set(ref, obj) {
    this._store._write(ref._collection, ref.id, clone(obj));
  }
  update(ref, obj) {
    const cur = this._store._read(ref._collection, ref.id);
    if (!cur) throw new Error('not_found');
    this._store._write(ref._collection, ref.id, { ...cur, ...clone(obj) });
  }
}

class LocalStore {
  constructor({ dir }) {
    this._memory = dir === ':memory:';
    this._dir = this._memory ? null : dir;
    this._data = new Map(); // collection -> Map(id -> data)
    if (!this._memory) this._loadAll();
  }

  collection(name) {
    return new CollectionRef(this, name);
  }

  async runTransaction(fn) {
    const tx = new LocalTransaction(this);
    return fn(tx);
  }

  _col(name) {
    if (!this._data.has(name)) this._data.set(name, new Map());
    return this._data.get(name);
  }

  _read(collection, id) {
    const c = this._data.get(collection);
    if (!c) return null;
    const v = c.get(id);
    return v ? clone(v) : null;
  }

  _write(collection, id, data) {
    this._col(collection).set(id, data);
    this._persist(collection);
  }

  _delete(collection, id) {
    const c = this._data.get(collection);
    if (c && c.delete(id)) this._persist(collection);
  }

  _all(collection) {
    const c = this._data.get(collection);
    if (!c) return [];
    return [...c.entries()].map(([id, data]) => ({ id, data: clone(data) }));
  }

  _fileFor(collection) {
    // collection 名を安全なファイル名に
    const safe = collection.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this._dir, `${safe}.json`);
  }

  _loadAll() {
    try {
      if (!fs.existsSync(this._dir)) fs.mkdirSync(this._dir, { recursive: true });
      for (const file of fs.readdirSync(this._dir)) {
        if (!file.endsWith('.json')) continue;
        const collection = file.slice(0, -5);
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(this._dir, file), 'utf-8'));
          const map = new Map(Object.entries(raw));
          this._data.set(collection, map);
        } catch {
          // 壊れたファイルは無視（空で開始）
        }
      }
    } catch (err) {
      console.warn(`[local-store] load 失敗: ${err.message}`);
    }
  }

  _persist(collection) {
    if (this._memory) return;
    try {
      if (!fs.existsSync(this._dir)) fs.mkdirSync(this._dir, { recursive: true });
      const c = this._data.get(collection) || new Map();
      const obj = Object.fromEntries(c.entries());
      fs.writeFileSync(this._fileFor(collection), JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[local-store] persist 失敗 (${collection}): ${err.message}`);
    }
  }

  // テスト用: 全消去
  _resetAll() {
    this._data.clear();
    if (!this._memory && fs.existsSync(this._dir)) {
      for (const file of fs.readdirSync(this._dir)) {
        if (file.endsWith('.json')) fs.rmSync(path.join(this._dir, file));
      }
    }
  }
}

let cached = null;
let cachedDir = null;

// ローカルストアが有効か（明示 off でなければ、Firestore 不在時に使う）
export function isLocalStoreEnabled() {
  const dir = process.env.KASAN_LOCAL_STORE_DIR;
  if (dir && dir.toLowerCase() === 'off') return false;
  return true;
}

export function getLocalStore() {
  if (!isLocalStoreEnabled()) return null;
  const dir = process.env.KASAN_LOCAL_STORE_DIR || path.join(APP_ROOT, '.localstore');
  if (cached && cachedDir === dir) return cached;
  cached = new LocalStore({ dir });
  cachedDir = dir;
  return cached;
}

// テスト用: キャッシュ破棄（KASAN_LOCAL_STORE_DIR を切り替えた後に呼ぶ）
export function _resetLocalStoreCache() {
  if (cached) cached._resetAll();
  cached = null;
  cachedDir = null;
}
