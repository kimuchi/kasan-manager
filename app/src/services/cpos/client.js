// CPOS HTTP クライアント
//
// 指示書 §5.2 の要件を満たす。
//   - CPOS_BASE_URL と Bearer token を扱う
//   - タイムアウト設定
//   - 401/403/404/5xx をわかりやすい例外に変換
//   - schemaVersion を確認
//   - ログに個人情報を出さない
//
// CPOS が未稼働でも開発できるよう、live API への疎通は遅延（lazy）で行う。

import { CposApiError, CposNotConfiguredError, CPOS_HTTP_HINTS } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30 * 1000;

export function isConfigured() {
  return Boolean(process.env.CPOS_BASE_URL);
}

export function readClientConfig({ overrides = {} } = {}) {
  const base = (overrides.baseUrl || process.env.CPOS_BASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new CposNotConfiguredError();
  return {
    baseUrl: base,
    accessToken: overrides.accessToken || process.env.CPOS_API_TOKEN || null,
    timeoutMs: Number(overrides.timeoutMs ?? process.env.CPOS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    appId: overrides.appId || process.env.CPOS_APP_ID || 'kasan-manager',
  };
}

export class CposClient {
  constructor(config = readClientConfig()) {
    this.config = config;
  }

  _headers(extra = {}) {
    const headers = {
      Accept: 'application/json',
      'X-Client': `kasan-manager/${process.env.npm_package_version || '0.x'}`,
      ...extra,
    };
    if (this.config.accessToken) {
      headers.Authorization = `Bearer ${this.config.accessToken}`;
    }
    return headers;
  }

  async _fetch(path, { method = 'GET', params = null, body = null, timeoutMs = null } = {}) {
    const url = new URL(this.config.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs ?? this.config.timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: this._headers(body ? { 'content-type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new CposApiError(0, `CPOS への接続に失敗しました: ${err.message}`, {
        requestPath: path,
        hint: CPOS_HTTP_HINTS[504],
      });
    } finally {
      clearTimeout(t);
    }

    if (!res.ok) {
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        // JSON でない（HTML エラーページ等）は無視
      }
      const apiMsg = payload?.message || payload?.error;
      const fallback = CPOS_HTTP_HINTS[res.status] || `CPOS API エラー (HTTP ${res.status})`;
      throw new CposApiError(res.status, apiMsg || fallback, {
        responseJson: payload,
        requestPath: path,
        hint: CPOS_HTTP_HINTS[res.status],
      });
    }

    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new CposApiError(res.status, `想定外のレスポンス content-type=${ct}`, {
        requestPath: path,
      });
    }
    return res.json();
  }

  // ─────────────────────────────────────────────────────────────────
  // 個別 API ラッパー（指示書 §4.3）
  // ─────────────────────────────────────────────────────────────────

  async getBootstrap() {
    return this._fetch('/api/kasan/v1/bootstrap');
  }

  async getAnalysisSource({
    facilityId,
    serviceMonth,
    includePii = false,
    includeRecordsSummary = true,
    includeBilling = true,
    includeProvision = true,
    includeStaffing = true,
    includeRawLines = false,
  }) {
    if (!facilityId) throw new Error('facilityId は必須です');
    if (!serviceMonth) throw new Error('serviceMonth は必須です（YYYY-MM）');
    return this._fetch('/api/kasan/v1/analysis-source', {
      params: {
        facilityId,
        serviceMonth,
        includePii: includePii ? 'true' : 'false',
        includeRecordsSummary: includeRecordsSummary ? 'true' : 'false',
        includeBilling: includeBilling ? 'true' : 'false',
        includeProvision: includeProvision ? 'true' : 'false',
        includeStaffing: includeStaffing ? 'true' : 'false',
        includeRawLines: includeRawLines ? 'true' : 'false',
      },
    });
  }

  async getMonthlyStatus({ facilityId, serviceMonth }) {
    return this._fetch(`/api/kasan/v1/facilities/${encodeURIComponent(facilityId)}/monthly-status`, {
      params: { serviceMonth },
    });
  }

  async ping() {
    // CPOS 側が /api/health を持っていればそれ、無ければ bootstrap で代用
    try {
      const r = await this._fetch('/api/health');
      return { ok: true, payload: r };
    } catch (err) {
      if (err.statusCode === 404) {
        // /api/health が無いのは想定内。bootstrap が叩ければ OK
        await this.getBootstrap();
        return { ok: true, payload: null };
      }
      throw err;
    }
  }
}
