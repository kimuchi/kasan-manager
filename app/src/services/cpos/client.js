// CPOS HTTP クライアント
//
// 指示書 §0 で「PAT は加算マネージャ DB / ファイル / ログ / env に永続保存しない」が方針。
// よって CposClient は **per-request トークン**を受け取って動く。env (.env) からの token 注入は
// 開発時の utility だけにし、本番リクエストではブラウザから sealed cookie で復号した PAT を使う。

import { CposApiError, CposNotConfiguredError, CPOS_HTTP_HINTS } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_BASE_URL_ENV = 'KASAN_DEFAULT_CPOS_BASE_URL';

// CPOS が公開している base URL（フロントが選択肢として表示するときの推奨値）
export function defaultBaseUrl() {
  return (process.env[DEFAULT_BASE_URL_ENV] || process.env.CPOS_BASE_URL || '').replace(/\/+$/, '') || null;
}

export function isAllowedBaseUrl(url) {
  // 本番セキュリティ: https のみ。許可リストを設けたい場合は KASAN_CPOS_ALLOWLIST=host1,host2 を参照
  if (!url || typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return false;
  const allow = (process.env.KASAN_CPOS_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(parsed.host)) return false;
  return true;
}

export function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return url.replace(/\/+$/, '');
}

export class CposClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  CPOS のベース URL（末尾 / なし）
   * @param {string} opts.token    Bearer に使う PAT
   * @param {number} [opts.timeoutMs]
   */
  constructor({ baseUrl, token, timeoutMs }) {
    if (!baseUrl) throw new CposNotConfiguredError();
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token || null;
    this.timeoutMs = timeoutMs || Number(process.env.CPOS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  }

  _headers(extra = {}) {
    const headers = {
      Accept: 'application/json',
      'X-Client': `kasan-manager/${process.env.npm_package_version || '0.x'}`,
      ...extra,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async _fetch(path, { method = 'GET', params = null, body = null, timeoutMs = null } = {}) {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs ?? this.timeoutMs);
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
      // 詳細なデバッグ情報を捕捉する。
      // CPOS が JSON を返さない場合（HTML エラーページ等）も生のテキストとして残す。
      const ct = res.headers.get('content-type') || '';
      let payload = null;
      let bodyText = null;
      if (ct.includes('application/json')) {
        try {
          payload = await res.json();
        } catch {}
      } else {
        try {
          bodyText = await res.text();
          if (bodyText && bodyText.length > 4000) bodyText = `${bodyText.slice(0, 4000)}…(切り捨て)`;
        } catch {}
      }
      // 関連性が高いヘッダのみピックアップ（漏えいリスクを減らすため、全件は出さない）
      const interestingHeaders = {};
      for (const k of ['www-authenticate', 'x-request-id', 'content-type', 'x-cpos-version']) {
        const v = res.headers.get(k);
        if (v) interestingHeaders[k] = v;
      }
      const apiMsg = payload?.message || payload?.error || bodyText;
      const fallback = CPOS_HTTP_HINTS[res.status] || `CPOS API エラー (HTTP ${res.status})`;
      throw new CposApiError(res.status, apiMsg || fallback, {
        responseJson: payload,
        responseBodyText: bodyText,
        responseHeaders: Object.keys(interestingHeaders).length ? interestingHeaders : null,
        requestPath: path,
        requestUrl: url.toString(),
        hint: CPOS_HTTP_HINTS[res.status],
      });
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new CposApiError(res.status, `想定外のレスポンス content-type=${ct}`, { requestPath: path });
    }
    return res.json();
  }

  // ─────────────────────────────────────────
  // 個別 API
  // ─────────────────────────────────────────

  // 指示書 §4.1 の PAT 検証で叩く
  async getMe() {
    return this._fetch('/api/platform/me');
  }

  async getPlatformFacilities() {
    return this._fetch('/api/platform/facilities');
  }

  // 加算分析向けの集約 API（指示書 §4.6）
  async getKasanExport({ facilityId, serviceMonth, serviceKey }) {
    return this._fetch('/api/platform/kasan/export', {
      params: {
        facilityId,
        serviceMonth,
        serviceKey: serviceKey || undefined,
      },
    });
  }

  // 旧 kasan v1 ルート（CPOS 側が提供している場合）
  async getBootstrap() {
    return this._fetch('/api/kasan/v1/bootstrap');
  }

  async getAnalysisSource({ facilityId, serviceMonth, includePii = false }) {
    return this._fetch('/api/kasan/v1/analysis-source', {
      params: {
        facilityId,
        serviceMonth,
        includePii: includePii ? 'true' : 'false',
      },
    });
  }
}
