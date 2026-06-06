// In-process Fake CPOS — テスト用の最小モック。
//
// 本物の CPOS が無くてもスモークテストで CPOS 連携の挙動を一通り検証できるよう、
// CposClient と同じインターフェイスを **必要な分だけ** 持つ。
//
// 永続化はプロセス内 Map。トランザクションは無い（テスト・開発用途）。
// アプリ側コードは _setAppCposClient(new FakeCpos(...)) で注入する。

import { randomUUID } from 'node:crypto';

const ts = () => new Date().toISOString();

export class FakeCpos {
  constructor({
    organizationId = 'org_demo',
    user = { id: 'user_demo', email: 'demo@example.com', name: 'Demo', role: 'admin' },
    allowedFacilityIds = null,
  } = {}) {
    this.organizationId = organizationId;
    this.user = user;
    this.allowedFacilityIds = allowedFacilityIds;
    // appId -> resource -> Map(id -> doc)
    this.appData = new Map();
    // organizationId -> { id, type, displayName, createdAt }
    this.organizations = new Map([[organizationId, { id: organizationId, type: 'cpos', displayName: 'Demo Org', createdAt: ts() }]]);
    // organizationId -> Map(userId -> user)
    this.users = new Map([[organizationId, new Map([[user.id, { ...user, organizationId, createdAt: ts(), lastLoginAt: ts() }]])]]);
    // 短期 one-time codes (B1)
    this.connectCodes = new Map();
  }

  // ---- 既存 API（最低限のスタブ） ----
  async getMe() {
    return {
      user: this.user,
      organization: { id: this.organizationId, type: this.organizations.get(this.organizationId)?.type || 'cpos' },
      app: { id: 'kasan', clientId: 'fake-client' },
      token: {
        scopes: ['app-data:kasan:read', 'app-data:kasan:write', 'users:read', 'facilities:read'],
        allowedFacilityIds: this.allowedFacilityIds,
        authMethod: 'app_token',
        expiresAt: null,
      },
    };
  }
  async getAuthMe() {
    return { user: this.user, organizationId: this.organizationId };
  }
  // ゲートウェイ方式（cpos_session cookie 転送）の本人確認。実 CPOS /api/auth/me 互換の形で返す。
  async getAuthMeWithCookie(cookieHeader) {
    if (!cookieHeader) {
      const e = new Error('cpos_session cookie がありません');
      e.statusCode = 401;
      throw e;
    }
    return {
      ok: true,
      authMethod: 'session',
      organizationId: this.organizationId,
      user: {
        id: this.user.id,
        email: this.user.email || null,
        name: this.user.name || null,
        role: this.user.role || 'staff',
      },
      allowedFacilityIds: this.allowedFacilityIds,
    };
  }
  async getPlatformFacilities() {
    return {
      facilities: [{ id: 'fac_a', name: 'デイサービスほっと（Fake）', serviceTypeCodes: ['15'] }],
    };
  }
  async getBootstrap() {
    return { facilities: (await this.getPlatformFacilities()).facilities };
  }
  // analysis-source の最小フィクスチャ（通所介護・集計値のみ）
  async getAnalysisSource({ facilityId, serviceMonth } = {}) {
    return {
      schemaVersion: '1.0',
      organizationId: this.organizationId,
      facility: { id: facilityId || 'fac_a', name: 'デイサービスほっと（Fake）', serviceTypeCodes: ['15'], regionClass: null },
      serviceMonth: serviceMonth || '2026-04',
      privacy: { includePii: false, userIdentifierType: 'anonymousUserKey' },
      userSummary: { activeUserCount: 40, careLevelDistribution: { care3: 12, care4: 8, care5: 7 }, care3PlusCount: 27, care3PlusRatio: 0.675 },
      staffSummary: { qualifiedPersonCountByProfession: { care_worker: 6, nurse: 1 }, fteByProfession: {} },
      claimSummary: { currentAddOnCounts: {} },
      dataCompleteness: { facility: 'complete', users: 'partial', staffing: 'partial', billing: 'missing' },
      warnings: ['FakeCpos analysis-source'],
    };
  }
  async getKasanExport() {
    const e = new Error('not_found');
    e.statusCode = 404;
    throw e;
  }

  // ---- app-data ----
  _rmap(appId, resource) {
    if (!this.appData.has(appId)) this.appData.set(appId, new Map());
    const byRes = this.appData.get(appId);
    if (!byRes.has(resource)) byRes.set(resource, new Map());
    return byRes.get(resource);
  }
  async createAppData(appId, resource, body = {}) {
    const id = body.id || randomUUID();
    const now = ts();
    const doc = {
      id,
      appId,
      resource,
      organizationId: body.organizationId || this.organizationId,
      status: body.status || 'draft',
      data: body.data || {},
      createdAt: now,
      updatedAt: now,
      createdBy: body.createdBy || this.user.id,
      revision: 1,
    };
    this._rmap(appId, resource).set(id, doc);
    return doc;
  }
  async listAppData(appId, resource, params = {}) {
    const list = [...this._rmap(appId, resource).values()].filter((d) => {
      if (params.organizationId && d.organizationId !== params.organizationId) return false;
      if (params.facilityId && d.data?.facilityId !== params.facilityId) return false;
      if (params.serviceMonth && d.data?.serviceMonth !== params.serviceMonth) return false;
      if (params.status && d.status !== params.status) return false;
      if (params.createdBy && d.createdBy !== params.createdBy) return false;
      if (params.from && new Date(d.createdAt) < new Date(params.from)) return false;
      if (params.to && new Date(d.createdAt) > new Date(params.to)) return false;
      return true;
    });
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    return { items: list.slice(0, limit), nextCursor: null };
  }
  async getAppData(appId, resource, id) {
    const d = this._rmap(appId, resource).get(id);
    if (!d) {
      const e = new Error('not_found');
      e.statusCode = 404;
      throw e;
    }
    return d;
  }
  async updateAppData(appId, resource, id, body = {}) {
    const cur = this._rmap(appId, resource).get(id);
    if (!cur) {
      const e = new Error('not_found');
      e.statusCode = 404;
      throw e;
    }
    const upd = { ...cur, ...body, id: cur.id, updatedAt: ts(), revision: (cur.revision || 1) + 1 };
    if (body.data) upd.data = { ...(cur.data || {}), ...body.data };
    this._rmap(appId, resource).set(id, upd);
    return upd;
  }
  async deleteAppData(appId, resource, id) {
    const map = this._rmap(appId, resource);
    if (!map.delete(id)) {
      const e = new Error('not_found');
      e.statusCode = 404;
      throw e;
    }
    return null;
  }
  async aggregateAppData(appId, resource, params = {}) {
    // テストでは集計エンドポイントは未実装相当（501）として扱い、呼び出し側で list 集計フォールバックさせる。
    const e = new Error('not-implemented');
    e.statusCode = 501;
    throw e;
  }

  // ---- B1: ユーザー受け渡し（テスト用ヘルパ込み）----
  _issueConnectCode({ user = this.user, organizationId = this.organizationId } = {}) {
    const code = `cn_${randomUUID()}`;
    this.connectCodes.set(code, { user, organizationId, expiresAt: Date.now() + 60_000 });
    return code;
  }
  async exchangeAppSessionCode(appId, code) {
    const e = this.connectCodes.get(code);
    if (!e) {
      const err = new Error('invalid_code');
      err.statusCode = 400;
      throw err;
    }
    if (e.expiresAt < Date.now()) {
      this.connectCodes.delete(code);
      const err = new Error('invalid_code');
      err.statusCode = 400;
      throw err;
    }
    this.connectCodes.delete(code); // 一度きり
    return {
      user: e.user,
      organizationId: e.organizationId,
      allowedFacilityIds: this.allowedFacilityIds,
      expiresIn: 600,
    };
  }

  // ---- B2: 組織プロビジョニング ----
  async createOrganization(payload = {}) {
    const id = `org_${randomUUID()}`;
    const org = { id, type: payload.type || 'cpos', displayName: payload.displayName || id, createdAt: ts() };
    this.organizations.set(id, org);
    const adminUserId = `user_${randomUUID()}`;
    const adminUser = {
      id: adminUserId,
      organizationId: id,
      email: payload.admin?.email || null,
      name: payload.admin?.name || null,
      role: 'admin',
      createdAt: ts(),
    };
    this.users.set(id, new Map([[adminUserId, adminUser]]));
    return { organizationId: id, type: org.type, adminUserId, invite: { method: 'email', status: 'sent' } };
  }
  async addOrganizationUser(organizationId, payload = {}) {
    if (!this.organizations.has(organizationId)) {
      const e = new Error('not_found');
      e.statusCode = 404;
      throw e;
    }
    const id = `user_${randomUUID()}`;
    const u = {
      id,
      organizationId,
      email: payload.email || null,
      name: payload.name || null,
      role: payload.role || 'staff',
      createdAt: ts(),
    };
    if (!this.users.has(organizationId)) this.users.set(organizationId, new Map());
    this.users.get(organizationId).set(id, u);
    return { userId: id, invite: { method: 'email', status: 'sent' } };
  }
  async getOrganization(organizationId) {
    const org = this.organizations.get(organizationId);
    if (!org) {
      const e = new Error('not_found');
      e.statusCode = 404;
      throw e;
    }
    return org;
  }

  // ---- B3: ユーザー一覧 ----
  async listPlatformUsers(params = {}) {
    const orgId = params.organizationId || this.organizationId;
    const m = this.users.get(orgId) || new Map();
    return {
      users: [...m.values()].slice(0, Math.max(1, Math.min(1000, Number(params.limit) || 200))),
      nextCursor: null,
    };
  }
}
