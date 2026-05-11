/* eslint-env browser */

const $ = (sel) => document.querySelector(sel);

const STATUS_LABEL = {
  ready: '✅ 取得可能',
  waiting: '⏸ 確認待ち',
  blocked: '❌ 要件未充足',
  unknown: '❔ 情報不足',
};

const ALG_LABEL = {
  clear: '✅ 取得済/要件クリア',
  waiting: '⏸ 確認待ち',
  not_clear: '❌ 対象外/不可',
  unknown: '❔ 情報不足',
  currently_claimed: '💰 算定中（要件クリア）',
  claimed_but_requirements_unknown: '💰❔ 算定中（要件未確認）',
  not_applicable: '🚫 当サービスでは算定対象外',
};

const DOMAIN_LABEL = {
  kaigo: '介護保険',
  medical: '医療保険',
  disability: '障害福祉',
};

// /api/health で取得した設定を保持（reCAPTCHA / レート制限 / CPOS / CSRF / Auth）
const appConfig = {
  recaptcha_enabled: false,
  recaptcha_site_key: null,
  recaptcha_loaded: false,
  cpos_panel_visible: false,
  cpos_ready: false,
  cpos_not_ready_message: null,
  cpos_default_url: null,
  csrf_header_name: 'x-csrf-token',
  csrf_token: null,
  // Firebase Auth
  firebase_enabled: false,
  firebase_web_config: null,
  firebase_loaded: false,
  // ログイン状態キャッシュ
  current_user: null, // { uid, email, planTier, isAdmin, ... } | null
  current_id_token: null,
};

// Firebase Auth の SDK は遅延ロード（ESM CDN）
async function loadFirebaseSdk() {
  if (appConfig.firebase_loaded) return window.__kasanFirebase;
  if (!appConfig.firebase_web_config) throw new Error('Firebase 設定が読み込まれていません');
  const [{ initializeApp }, authMod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js'),
  ]);
  const app = initializeApp(appConfig.firebase_web_config);
  const auth = authMod.getAuth(app);
  authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
  const mod = {
    app,
    auth,
    GoogleAuthProvider: authMod.GoogleAuthProvider,
    signInWithPopup: authMod.signInWithPopup,
    signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
    createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
    signOut: authMod.signOut,
    onAuthStateChanged: authMod.onAuthStateChanged,
  };
  window.__kasanFirebase = mod;
  appConfig.firebase_loaded = true;
  return mod;
}

// CSRF / Firebase ID トークン付きで JSON を送る fetch ラッパー
async function jsonFetch(url, { method = 'GET', body = null, headers = {} } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
  };
  if (body != null) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (method !== 'GET' && appConfig.csrf_token) {
    opts.headers[appConfig.csrf_header_name] = appConfig.csrf_token;
  }
  // ログイン済なら Firebase ID トークンを Authorization に付与
  const idToken = await getFreshIdToken();
  if (idToken) {
    opts.headers['authorization'] = `Bearer ${idToken}`;
  }
  const res = await fetch(url, opts);
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  return { res, payload };
}

async function getFreshIdToken() {
  if (!appConfig.firebase_loaded) return null;
  const fb = window.__kasanFirebase;
  if (!fb || !fb.auth.currentUser) return null;
  try {
    return await fb.auth.currentUser.getIdToken();
  } catch {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await initStatusPill();
  initServices();
  initFileInputs();
  initAnalyzeButtons();
  if (appConfig.firebase_enabled) {
    initAuthPanel();
  }
  // CPOS 折りたたみパネルは閉じた状態で表示（ready のときのみ）。
  // 未設定なら main 末尾に控えめな notice。
  if (appConfig.cpos_panel_visible && appConfig.cpos_ready) {
    show('#cpos-section');
    await initCposPanel();
    initCposNavLink();
  } else if (appConfig.cpos_panel_visible && !appConfig.cpos_ready) {
    show('#cpos-not-ready-notice');
  }
}

function initCposNavLink() {
  const link = $('#cpos-nav-link');
  if (!link) return;
  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    const sec = $('#cpos-section');
    if (!sec) return;
    sec.open = true;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function initStatusPill() {
  const pill = $('#status-pill');
  const text = $('#status-text');
  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    if (json.gemini_configured) {
      pill.classList.add('ok');
      text.textContent = `Gemini 接続OK（${json.model}）`;
    } else {
      pill.classList.add('error');
      text.textContent = 'Gemini API キー未設定（判定エンジンのみ利用可）';
    }
    // reCAPTCHA 設定を保存し、必要ならスクリプトをロード
    if (json.recaptcha?.enabled && json.recaptcha?.site_key) {
      appConfig.recaptcha_enabled = true;
      appConfig.recaptcha_site_key = json.recaptcha.site_key;
      $('#recaptcha-notice').classList.remove('hidden');
      loadRecaptchaScript(json.recaptcha.site_key);
    }
    // CSRF トークン保持
    if (json.csrf?.token) {
      appConfig.csrf_token = json.csrf.token;
      appConfig.csrf_header_name = json.csrf.header_name || 'x-csrf-token';
    }
    // CPOS の表示判断は initApp に任せる（panel_visible+ready でパネル、未設定なら控えめ notice）
    if (json.cpos?.panel_visible) {
      appConfig.cpos_panel_visible = true;
      appConfig.cpos_ready = Boolean(json.cpos.ready);
      appConfig.cpos_default_url = json.cpos.default_base_url || null;
      appConfig.cpos_not_ready_message = json.cpos.not_ready_message || null;
    }
    // Firebase Auth 設定（クライアント設定が来ていれば有効）
    if (json.auth?.firebase_enabled && json.auth?.web_config) {
      appConfig.firebase_enabled = true;
      appConfig.firebase_web_config = json.auth.web_config;
    }
  } catch (err) {
    pill.classList.add('error');
    text.textContent = '接続エラー';
  }
}

function loadRecaptchaScript(siteKey) {
  if (appConfig.recaptcha_loaded) return;
  appConfig.recaptcha_loaded = true;
  const s = document.createElement('script');
  s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

async function getRecaptchaToken(action) {
  if (!appConfig.recaptcha_enabled) return null;
  // grecaptcha が読み込まれるまで最大 10 秒待つ
  for (let i = 0; i < 50; i += 1) {
    if (window.grecaptcha && window.grecaptcha.execute) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!window.grecaptcha || !window.grecaptcha.execute) {
    throw new Error('reCAPTCHA を読み込めませんでした。ページを再読込してから再度お試しください。');
  }
  return new Promise((resolve, reject) => {
    window.grecaptcha.ready(() => {
      window.grecaptcha
        .execute(appConfig.recaptcha_site_key, { action })
        .then(resolve)
        .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}

async function initServices() {
  const select = $('#service');
  const hint = $('#service-hint');
  try {
    const res = await fetch('/api/services');
    const { services } = await res.json();
    select.innerHTML = '<option value="">— サービスを選択 —</option>';
    const grouped = {
      kaigo: { label: '介護保険', items: [] },
      medical: { label: '医療保険', items: [] },
      disability: { label: '障害福祉', items: [] },
    };
    for (const s of services) {
      (grouped[s.domain] || (grouped[s.domain] = { label: s.domain_label, items: [] })).items.push(s);
    }
    for (const [, group] of Object.entries(grouped)) {
      if (!group.items.length) continue;
      const og = document.createElement('optgroup');
      og.label = `【${group.label}】`;
      for (const s of group.items) {
        const opt = document.createElement('option');
        opt.value = s.service_key;
        // status はアイコン化して短く（実装済み = 何もつけない、それ以外は控えめに注釈）
        const badge =
          s.status === 'implemented' ? '' :
          s.status === 'draft' ? '（β）' :
          s.status === 'planned' ? '（準備中）' : '';
        opt.textContent = `${s.display_name}${badge}`;
        opt.title = s.status_label || s.status; // hover で詳細
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    const implementedCount = services.filter((s) => s.status === 'implemented').length;
    const draftCount = services.filter((s) => s.status === 'draft').length;
    hint.textContent =
      `全 ${services.length} サービス対応 ` +
      `（本番判定 ${implementedCount} 種・AI 補完のみ ${draftCount} 種）。` +
      `「（β）」が付くサービスは要件マスタ整備中で、AI による制度知識ベースの提案が中心になります。`;
  } catch (err) {
    hint.textContent = `サービスの取得に失敗しました: ${err.message}`;
  }
}

function initFileInputs() {
  const updates = [
    ['#pdf', '#pdf-name'],
    ['#tenant_status_json', '#tenant-name'],
    ['#staff_json', '#staff-name'],
    ['#user_summary_json', '#user-name'],
  ];
  for (const [inputSel, labelSel] of updates) {
    $(inputSel).addEventListener('change', () => {
      const f = $(inputSel).files[0];
      $(labelSel).textContent = f ? `${f.name}（${humanFileSize(f.size)}）` : '未選択';
    });
  }

  const input = $('#attachments');
  const list = $('#file-list');
  input.addEventListener('change', () => {
    list.innerHTML = '';
    for (const file of input.files) {
      const li = document.createElement('li');
      li.textContent = `${file.name}（${humanFileSize(file.size)}）`;
      list.appendChild(li);
    }
  });
}

function humanFileSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function initAnalyzeButtons() {
  $('#analyze-btn').addEventListener('click', () => runAnalyze({ includeGemini: true }));
  $('#judge-btn').addEventListener('click', () => runAnalyze({ includeGemini: false }));
}

function buildFormData(includeAttachments = true) {
  const formData = new FormData();
  formData.append('service', $('#service').value);
  formData.append('office_name', $('#office_name').value);
  formData.append('office_code', $('#office_code').value);
  formData.append('region', $('#region').value);
  formData.append('staff_summary', $('#staff_summary').value);
  formData.append('user_summary', $('#user_summary').value);
  formData.append('current_kasans', $('#current_kasans').value);
  formData.append('concerns', $('#concerns').value);
  formData.append('free_text', '');

  const pdf = $('#pdf').files[0];
  const tenantStatus = $('#tenant_status_json').files[0];
  const staff = $('#staff_json').files[0];
  const userSummary = $('#user_summary_json').files[0];
  if (pdf) formData.append('pdf', pdf);
  if (tenantStatus) formData.append('tenant_status_json', tenantStatus);
  if (staff) formData.append('staff_json', staff);
  if (userSummary) formData.append('user_summary_json', userSummary);

  if (includeAttachments) {
    for (const f of $('#attachments').files) formData.append('attachments', f);
  }
  return formData;
}

async function runAnalyze({ includeGemini }) {
  if (!$('#service').value) {
    alert('対象サービスを選択してください。');
    return;
  }
  hide('#error-section');
  hide('#result-section');
  hide('#judge-section');

  const btn = includeGemini ? $('#analyze-btn') : $('#judge-btn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  $('#analyze-btn').disabled = true;
  $('#judge-btn').disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span>${
    appConfig.recaptcha_enabled ? '安全確認中…' : (includeGemini ? '判定 + AI 分析中…' : '判定中…')
  }</span>`;

  const action = includeGemini ? 'analyze' : 'judge';
  const endpoint = includeGemini ? '/api/analyze' : '/api/judge';
  try {
    let recaptchaToken = null;
    if (appConfig.recaptcha_enabled) {
      try {
        recaptchaToken = await getRecaptchaToken(action);
      } catch (err) {
        throw new Error(`reCAPTCHA トークンの取得に失敗しました: ${err.message}`);
      }
    }
    btn.innerHTML = `<span class="spinner"></span><span>${includeGemini ? '判定 + AI 分析中…' : '判定中…'}</span>`;

    const formData = buildFormData(includeGemini);
    if (recaptchaToken) formData.append('recaptcha_token', recaptchaToken);

    const headers = {};
    if (appConfig.csrf_token) headers[appConfig.csrf_header_name] = appConfig.csrf_token;
    const res = await fetch(endpoint, { method: 'POST', body: formData, headers, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(formatApiError(res.status, json));
    }

    if (includeGemini) {
      renderJudge(json.judge, json.markdown, json.service);
      if (json.gemini && json.gemini.analysis) {
        renderGeminiResult(json.gemini, json.service);
      } else if (json.gemini_error) {
        showError(`Gemini 補完に失敗しました: ${json.gemini_error}`);
      } else if (json.gemini && !json.gemini.analysis) {
        $('#result-summary').textContent = 'Gemini 応答を JSON として解釈できませんでした。';
        show('#result-section');
      }
    } else {
      renderJudge(json.judge, json.markdown, json.judge.service_def);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    $('#analyze-btn').disabled = false;
    $('#judge-btn').disabled = false;
    btn.innerHTML = originalLabel;
  }
}

function showError(msg) {
  $('#error-text').textContent = msg;
  show('#error-section');
  $('#error-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatApiError(status, json) {
  const code = json && json.error;
  const message = json && json.message;
  if (status === 429 && code === 'rate_limit_exceeded') {
    const retry = json.retry_after_seconds ? `（約 ${json.retry_after_seconds} 秒後に再試行可能）` : '';
    return `アクセス回数の上限に達しました。${retry} ${message || ''}`.trim();
  }
  if (status === 403 && code === 'recaptcha_low_score') {
    return `自動アクセスの可能性が高いと判定されました（スコア: ${json.score?.toFixed(2) ?? '-'}）。少し時間をおいて再度お試しください。`;
  }
  if (status === 403 && code && code.startsWith('recaptcha_')) {
    return `reCAPTCHA 検証に失敗しました（${code}）。ページを再読込してから再度お試しください。`;
  }
  if (status === 400 && code === 'recaptcha_missing') {
    return 'reCAPTCHA トークンが送信できませんでした。ページを再読込してから再度お試しください。';
  }
  if (status === 503 && code === 'recaptcha_unavailable') {
    return '人間判定サービスに接続できませんでした。しばらくしてから再度お試しください。';
  }
  return message || (json && json.error) || `HTTP ${status}`;
}

// /api/analyze/from-cpos のエラー表示専用フォーマッタ。
// not_connected (本アプリの cookie 切れ) と cpos_upstream_error (CPOS が返した 401/403 等) を区別する。
function formatCposAnalyzeError(status, payload) {
  const code = payload?.error;
  if (status === 401 && code === 'not_connected') {
    return 'CPOS 接続情報が見つかりません。PAT を再入力して接続してください。';
  }
  if (code === 'cpos_upstream_error') {
    const upstream = payload.upstream_status_code;
    const upstreamMsg = payload.message ? `CPOS応答: ${payload.message}` : '';
    if (upstream === 401) {
      return [
        'CPOS が分析 API の PAT 認証を受け付けませんでした。',
        '考えられる原因: PAT の期限切れ・失効、または CPOS 側の分析 API で Bearer 認証が通っていない可能性があります。',
        upstreamMsg,
      ].filter(Boolean).join('\n');
    }
    if (upstream === 403) {
      return [
        'CPOS PAT の権限が不足しているか、この事業所へのアクセスが許可されていません。',
        'PAT に kasan:read / kasan-export:read / claims:read / benefits:read / service-actuals:read のいずれかが付与されているか確認してください。',
        upstreamMsg,
      ].filter(Boolean).join('\n');
    }
    if (upstream === 404) {
      return [
        'CPOS の分析エンドポイントが見つかりません（/api/kasan/v1/analysis-source も /api/platform/kasan/export も 404）。',
        'CPOS 側の分析 API 実装状況を管理者に確認してください。',
        upstreamMsg,
      ].filter(Boolean).join('\n');
    }
    return `CPOS API エラー: ${payload.message || `upstream HTTP ${upstream}`}`;
  }
  if (status === 403 && code === 'forbidden_facility') {
    return 'この事業所はあなたの PAT の allowedFacilityIds に含まれていません。CPOS で対象事業所を含めた PAT を再発行してください。';
  }
  return formatApiError(status, payload);
}

function renderJudge(judge, markdown, service) {
  show('#judge-section');
  const metaEl = $('#judge-meta');
  const sd = judge.service_def || service || {};
  const mm = judge.master_meta || {};
  metaEl.innerHTML = `
    <div>
      <strong>${escapeHtml(sd.display_name || service?.display_name || '?')}</strong>
      ${domainTag(sd.domain || service?.domain)}
      <span class="status-tag">マスタ版 ${escapeHtml(mm.version || '-')}</span>
      <span class="status-tag">改定 ${escapeHtml(mm.revision_tag || '-')}</span>
      ${judge.evidence_applied ? '<span class="status-tag implemented">📄 PDF反映済</span>' : ''}
      ${judge.staff_data_loaded ? '<span class="status-tag implemented">👥 staff.json反映済</span>' : ''}
      ${judge.user_summary_loaded ? '<span class="status-tag implemented">🧑 user_summary反映済</span>' : ''}
    </div>
  `;

  const s = judge.summary || {};
  $('#judge-summary').innerHTML = `
    <div class="summary-grid">
      ${summaryTile('✅ 取得済/要件クリア', (s.clear || []).length, 'ok')}
      ${summaryTile('⏸ 確認待ち', (s.waiting || []).length, 'warn')}
      ${summaryTile('❌ 対象外/不可', (s.not_clear || []).length, 'err')}
      ${summaryTile('❔ 情報不足', (s.unknown || []).length, 'mute')}
      ${(s.currently_claimed || []).length ? summaryTile('💰 算定中（クリア）', (s.currently_claimed || []).length, 'ok') : ''}
      ${(s.claimed_but_requirements_unknown || []).length ? summaryTile('💰❔ 算定中（未確認）', (s.claimed_but_requirements_unknown || []).length, 'warn') : ''}
    </div>
    <p class="hint">全${judge.kasan_count}加算中、取得可能性が高い加算は <strong>${(s.waiting || []).length + (s.clear || []).length}件</strong></p>
  `;

  const tableEl = $('#judge-table-wrap');
  const rows = Object.entries(judge.judgements || {}).map(([k, j]) => {
    const algLabel = ALG_LABEL[j.algorithm_judgement] || j.algorithm_judgement;
    const dsl = (judge.dsl_results || {})[k] || {};
    const dslLabel = dslStatusLabel(dsl.status);
    const route = (dsl.satisfied_route || []).join(' / ') || '-';
    const missing = (dsl.missing_evidence || []).join(', ') || '-';
    return `
      <tr>
        <td><strong>${escapeHtml(j.name)}</strong><br><code>${escapeHtml(k)}</code></td>
        <td>${escapeHtml(algLabel)}</td>
        <td>${escapeHtml(unitText(j))}</td>
        <td>${escapeHtml(dslLabel)}</td>
        <td>${escapeHtml(route)}</td>
        <td>${escapeHtml(missing)}</td>
      </tr>
    `;
  }).join('');

  tableEl.innerHTML = `
    <table class="judge-table">
      <thead>
        <tr><th>加算</th><th>判定</th><th>単位</th><th>DSL評価</th><th>達成ルート</th><th>不足証跡</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6">対象加算なし</td></tr>'}</tbody>
    </table>
  `;

  const checklist = judge.evidence_checklist || [];
  $('#judge-checklist').innerHTML = checklist.length
    ? `<ul class="checklist">${checklist
        .map((c) => `
          <li>
            <span class="priority ${escapeHtml(priorityClass(c.priority))}">${escapeHtml(c.priority || '中')}</span>
            <strong>${escapeHtml(c.kasan_name)}</strong>: ${escapeHtml(c.label)}
            <div class="hint">推奨資料: ${(c.recommended_documents || []).map(escapeHtml).join('・') || '-'}</div>
            <div class="hint">次アクション: ${escapeHtml(c.next_action || '-')}</div>
          </li>`)
        .join('')}</ul>`
    : '<p class="hint">不足証跡はありません（または DSL ロジック未実装）。</p>';

  $('#judge-markdown').textContent = markdown || '(markdown 未生成)';
  $('#judge-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function summaryTile(label, count, kind) {
  return `
    <div class="summary-tile ${kind}">
      <div class="summary-count">${count}</div>
      <div class="summary-label">${escapeHtml(label)}</div>
    </div>
  `;
}

function unitText(j) {
  if (j.unit_per_month) return `${j.unit_per_month}単位/月`;
  if (j.unit_per_day) return `${j.unit_per_day}単位/日`;
  if (j.unit_per_visit) return `${j.unit_per_visit}単位/回`;
  if (j.rate != null) return `所定単位×${Math.round(j.rate * 100)}%`;
  return '-';
}

function dslStatusLabel(s) {
  switch (s) {
    case 'clear': return '✅ clear';
    case 'not_clear': return '❌ not_clear';
    case 'partially_clear': return '🟡 partially_clear';
    case 'blocked_by_missing_evidence': return '📭 不足証跡あり';
    case 'blocked_by_unverified_mapping': return '🔒 mapping保留';
    case 'not_evaluated_source_required': return '⏳ 根拠未確認';
    case 'not_evaluated_logic_unchecked': return '⏳ ロジック未確認';
    case 'not_applicable': return '🚫 対象外';
    case 'unknown': return '❔ unknown';
    default: return s || '-';
  }
}

function priorityClass(p) {
  if (p === '高' || p === 'High') return 'high';
  if (p === '低' || p === 'Low') return 'low';
  return 'mid';
}

function renderGeminiResult(gemini, service) {
  show('#result-section');
  const meta = $('#result-meta');
  const svc = service || {};
  meta.innerHTML = `
    <div>
      <strong>${escapeHtml(svc.display_name || '?')}</strong>
      ${domainTag(svc.domain)}
      <span class="status-tag">model: ${escapeHtml(gemini.model || '-')}</span>
    </div>
  `;
  const a = gemini.analysis;
  if (!a) {
    $('#result-summary').textContent = 'Gemini 応答を JSON として解釈できませんでした。生レスポンスを参照してください。';
    $('#result-revenue').textContent = '';
    $('#result-actions').innerHTML = '';
    $('#result-candidates').innerHTML = '';
    $('#result-cautions').innerHTML = '';
    $('#result-assumptions').innerHTML = '';
  } else {
    $('#result-summary').textContent = a.summary || '（要約なし）';
    $('#result-revenue').textContent = a.estimated_total_revenue_increase
      ? `💰 増収見込み: ${a.estimated_total_revenue_increase}`
      : '';
    $('#result-actions').innerHTML = (a.top_actions || [])
      .map(
        (act) => `
      <div class="action-item">
        <h4>${escapeHtml(act.title || '')}</h4>
        <div class="why">${escapeHtml(act.why || '')}</div>
        <ol>${(act.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      </div>`,
      )
      .join('') || '<p>アクション提案がありません。</p>';
    $('#result-candidates').innerHTML = (a.candidates || [])
      .map((c) => candidateBlock(c))
      .join('') || '<p>取得候補が見つかりませんでした。</p>';
    $('#result-cautions').innerHTML = (a.cautions || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join('') || '<li>（特になし）</li>';
    $('#result-assumptions').innerHTML = (a.assumptions || [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join('') || '<li>（前提なし）</li>';
  }
  $('#result-raw').textContent = JSON.stringify(gemini, null, 2);
}

function candidateBlock(c) {
  const status = (c.status || 'unknown').toLowerCase();
  const label = STATUS_LABEL[status] || STATUS_LABEL.unknown;
  return `
    <div class="candidate-item">
      <div class="candidate-head">
        <div class="candidate-name">${escapeHtml(c.name || '?')}</div>
        <span class="status-badge ${status}">${escapeHtml(label)}</span>
      </div>
      <div class="candidate-meta">
        ${c.kasan_key ? `<code>${escapeHtml(c.kasan_key)}</code> · ` : ''}
        ${c.unit ? `単位: ${escapeHtml(c.unit)} · ` : ''}
        ${c.revenue_estimate ? `増収: ${escapeHtml(c.revenue_estimate)}` : ''}
      </div>
      <div class="candidate-req">${escapeHtml(c.requirement_summary || '')}</div>
      ${
        c.recommended_actions && c.recommended_actions.length
          ? `<div class="candidate-block-title">▶ 取るためのアクション</div>
             <ul class="candidate-actions">${c.recommended_actions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
          : ''
      }
      ${
        c.missing_info && c.missing_info.length
          ? `<div class="candidate-block-title">❔ 追加で必要な情報</div>
             <ul class="candidate-missing">${c.missing_info.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
          : ''
      }
    </div>
  `;
}

function domainTag(domain) {
  const cls = ['kaigo', 'medical', 'disability'].includes(domain) ? domain : '';
  const label = DOMAIN_LABEL[domain] || domain || '';
  return `<span class="domain-tag ${cls}">${escapeHtml(label)}</span>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function show(sel) { $(sel).classList.remove('hidden'); }
function hide(sel) { $(sel).classList.add('hidden'); }

// ─────────────────────────────────────────────────────────
// CPOS PAT 連携パネル
// ─────────────────────────────────────────────────────────
async function initCposPanel() {
  $('#cpos-disconnected-panel').classList.remove('hidden');
  // PAT デフォルト URL の充填
  if (appConfig.cpos_default_url) {
    $('#cpos_base_url').value = appConfig.cpos_default_url;
  }
  updateCposIssueLink();
  $('#cpos_base_url').addEventListener('input', updateCposIssueLink);
  // 当月を初期値に
  const now = new Date();
  $('#cpos_month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // PAT 表示/非表示トグル
  $('#cpos_pat_toggle').addEventListener('click', () => {
    const inp = $('#cpos_pat');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#cpos_pat_toggle').textContent = inp.type === 'password' ? '表示' : '隠す';
  });

  // 各種ボタン
  $('#cpos-connect-btn').addEventListener('click', () => connectCpos());
  $('#cpos-disconnect-btn').addEventListener('click', () => disconnectCpos());
  $('#cpos-test-btn').addEventListener('click', () => testCposConnection());
  $('#cpos-analyze-btn').addEventListener('click', () => runCposAnalyze());

  // 接続状態の取得
  await refreshCposStatus();
}

async function refreshCposStatus() {
  const { res, payload } = await jsonFetch('/api/cpos-token/status');
  if (!res.ok || !payload?.connected) {
    showCposDisconnected();
    return;
  }
  showCposConnected(payload);
  await loadCposFacilities();
}

function showCposDisconnected(message = '') {
  $('#cpos-disconnected-panel').classList.remove('hidden');
  $('#cpos-connected-panel').classList.add('hidden');
  const hint = $('#cpos-connect-hint');
  if (message) {
    hint.textContent = message;
    hint.style.color = '#b3261e';
  } else {
    hint.textContent = '';
  }
}

// CPOS URL から PAT 発行ページの URL を組み立てて、ステップ 1 のリンクを動的に有効化
function updateCposIssueLink() {
  const link = $('#cpos-issue-link');
  if (!link) return;
  const raw = $('#cpos_base_url').value.trim();
  if (!raw || !/^https?:\/\//.test(raw)) {
    link.href = '#';
    link.classList.add('disabled');
    link.title = 'まず CPOS URL を入力してください';
    return;
  }
  const base = raw.replace(/\/+$/, '');
  // CPOS 最新の PAT 管理画面（docs/PERSONAL_ACCESS_TOKEN.md 仕様）。
  link.href = `${base}/personal-access-tokens`;
  link.classList.remove('disabled');
  link.title = `${link.href} を新しいタブで開く`;
}

// エラー時にユーザに見せる詳細情報を組み立てる
function renderCposErrorHint(payload) {
  const status = payload?.status_code;
  const code = payload?.error;
  if (status === 401) {
    return [
      '🔐 CPOS が PAT を受け付けませんでした。考えられる原因:',
      '  ・PAT がまだ発行されていない／期限切れ／取り消し済み',
      '  ・ステップ 1 のリンクから CPOS にログインして PAT を発行してください',
      '  ・CPOS の「設定 → API トークン」画面でアクティブな PAT があるか確認してください',
      '  ・CPOS 側で `/api/platform/me` の Bearer 認証実装が完了しているか管理者に確認してください',
    ].join('\n');
  }
  if (status === 403) {
    return '🚫 PAT は有効ですが、scope または事業所アクセス権が不足しています。CPOS 管理者に scope 追加を依頼してください。';
  }
  if (status === 404 || status === 0) {
    return '🌐 CPOS への接続自体ができませんでした。CPOS URL（https の有無含む）が正しいか確認してください。';
  }
  if (code === 'invalid_base_url') {
    return '⚠️ CPOS URL が許可されていません（本番では https のみ／allowlist 対象外）。';
  }
  if (code === 'bad_token_format') {
    return '⚠️ PAT は cpos_pat_ で始まる文字列です。コピー漏れ・空白混入がないか確認してください。';
  }
  return null;
}

function showCposConnected(view) {
  $('#cpos-disconnected-panel').classList.add('hidden');
  $('#cpos-connected-panel').classList.remove('hidden');
  $('#cpos-connected-summary').textContent =
    `接続中: ${view.user?.name || '-'} / ${view.user?.email || '-'} （${view.cposBaseUrl}）`;
  $('#cpos-token-preview').textContent = view.token?.tokenPreview || '-';
  $('#cpos-token-scopes').textContent = (view.token?.scopes || []).join(', ') || '（指定なし）';
  $('#cpos-token-facilities').textContent =
    Array.isArray(view.token?.allowedFacilityIds)
      ? view.token.allowedFacilityIds.length
        ? view.token.allowedFacilityIds.join(', ')
        : '（全事業所）'
      : '（全事業所）';
  $('#cpos-token-expires').textContent = view.token?.expiresAt || '（期限なし）';
}

async function connectCpos() {
  const baseUrl = $('#cpos_base_url').value.trim();
  const token = $('#cpos_pat').value.trim();
  const hint = $('#cpos-connect-hint');
  hint.textContent = '';
  if (!baseUrl) {
    hint.textContent = 'CPOS URL を入力してください';
    hint.style.color = '#b3261e';
    return;
  }
  if (!token) {
    hint.textContent = 'CPOS API トークンを入力してください';
    hint.style.color = '#b3261e';
    return;
  }
  const btn = $('#cpos-connect-btn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>CPOS で検証中…</span>';
  try {
    const { res, payload } = await jsonFetch('/api/cpos-token', {
      method: 'POST',
      body: { cposBaseUrl: baseUrl, token },
    });
    if (!res.ok || !payload?.ok) {
      const e = new Error(payload?.message || payload?.error || `HTTP ${res.status}`);
      e._cposPayload = { status: res.status, ...payload };
      throw e;
    }
    // 入力欄をクリア（PAT を画面に残さない）
    $('#cpos_pat').value = '';
    $('#cpos_pat').type = 'password';
    $('#cpos_pat_toggle').textContent = '表示';
    showCposConnected(payload);
    await loadCposFacilities();
  } catch (err) {
    renderCposConnectError(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function renderCposConnectError(err) {
  const hint = $('#cpos-connect-hint');
  const detail = err._cposPayload || null;
  const guidance = detail ? renderCposErrorHint(detail) : null;
  hint.style.color = '#b3261e';
  hint.innerHTML = '';

  const summary = document.createElement('div');
  summary.textContent = `CPOS 接続失敗: ${err.message}`;
  hint.appendChild(summary);

  if (guidance) {
    const det = document.createElement('details');
    det.className = 'cpos-error-detail';
    det.open = true;
    const sm = document.createElement('summary');
    sm.textContent = '対処方法（クリックで開く）';
    det.appendChild(sm);
    const pre = document.createElement('pre');
    pre.textContent = guidance;
    det.appendChild(pre);
    hint.appendChild(det);
  }

  // 診断セクション: CPOS の URL・応答・ヘッダ
  const diag = detail?.diagnostics;
  if (diag) {
    const raw = document.createElement('details');
    raw.className = 'cpos-error-detail';
    const sm = document.createElement('summary');
    sm.textContent = 'CPOS の応答（管理者へ伝える診断情報）';
    raw.appendChild(sm);
    const lines = [];
    if (diag.request_url) lines.push(`リクエスト先: ${diag.request_url}`);
    if (detail.status_code != null) lines.push(`ステータス: HTTP ${detail.status_code}`);
    if (diag.response_headers) {
      lines.push('応答ヘッダ:');
      for (const [k, v] of Object.entries(diag.response_headers)) {
        lines.push(`  ${k}: ${v}`);
      }
    }
    if (diag.response_body != null) {
      lines.push('応答ボディ:');
      const body =
        typeof diag.response_body === 'string'
          ? diag.response_body
          : JSON.stringify(diag.response_body, null, 2);
      lines.push(body);
    }
    const pre = document.createElement('pre');
    pre.textContent = lines.join('\n');
    raw.appendChild(pre);
    hint.appendChild(raw);
  }
}

async function disconnectCpos() {
  const { res } = await jsonFetch('/api/cpos-token', { method: 'DELETE' });
  if (res.ok) showCposDisconnected('接続を解除しました');
}

async function testCposConnection() {
  const { res, payload } = await jsonFetch('/api/cpos-token/test', { method: 'POST' });
  if (res.ok && payload?.ok) {
    alert(`CPOS 接続 OK: ${payload.me?.email || '-'} / 事業所 ${payload.facilityCount} 件`);
  } else {
    alert(`CPOS 接続テスト失敗: ${payload?.message || res.status}`);
    if (res.status === 401) showCposDisconnected('セッションが切れました。再接続してください。');
  }
}

async function loadCposFacilities() {
  const select = $('#cpos_facility');
  try {
    const { res, payload } = await jsonFetch('/api/cpos/facilities');
    if (!res.ok) {
      select.innerHTML = `<option value="">— 取得失敗: ${(payload && payload.message) || res.status} —</option>`;
      return;
    }
    const facilities = payload?.facilities || [];
    select.innerHTML = '<option value="">— 事業所を選択 —</option>';
    for (const f of facilities) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.name || f.id}（${(f.serviceTypeCodes || []).join(',') || '-'}）`;
      select.appendChild(opt);
    }
    if (!facilities.length) {
      select.innerHTML = '<option value="">— アクセス可能な事業所がありません —</option>';
    }
  } catch (err) {
    select.innerHTML = `<option value="">— 取得失敗: ${err.message} —</option>`;
  }
}

async function runCposAnalyze() {
  const facilityId = $('#cpos_facility').value;
  const serviceMonth = $('#cpos_month').value;
  if (!facilityId) { alert('CPOS の事業所を選択してください。'); return; }
  if (!serviceMonth) { alert('対象月（YYYY-MM）を入力してください。'); return; }

  hide('#error-section');
  hide('#result-section');
  hide('#judge-section');

  const btn = $('#cpos-analyze-btn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span>${appConfig.recaptcha_enabled ? '安全確認中…' : 'CPOS から取得中…'}</span>`;

  try {
    let recaptchaToken = null;
    if (appConfig.recaptcha_enabled) {
      try {
        recaptchaToken = await getRecaptchaToken('cpos_analyze');
      } catch (err) {
        throw new Error(`reCAPTCHA トークンの取得に失敗しました: ${err.message}`);
      }
    }
    btn.innerHTML = `<span class="spinner"></span><span>CPOS 連携で判定中…</span>`;

    const body = { facilityId, serviceMonth };
    if (recaptchaToken) body.recaptcha_token = recaptchaToken;

    const { res, payload } = await jsonFetch('/api/analyze/from-cpos', { method: 'POST', body });
    if (!res.ok || !payload?.ok) {
      // 加算マネージャ自身のセッション切れ
      if (res.status === 401 && payload?.error === 'not_connected') {
        showCposDisconnected(formatCposAnalyzeError(res.status, payload));
        return;
      }
      const message = formatCposAnalyzeError(res.status, payload || {});
      const e = new Error(message);
      e._cposPayload = { status: res.status, ...(payload || {}) };
      throw e;
    }
    const judge = payload.resultJson;
    renderJudge(judge, payload.reportMarkdown, judge?.service_def);
  } catch (err) {
    if (err._cposPayload) {
      // 接続パネルではなくエラーセクションに、診断詳細つきで表示
      showCposAnalyzeError(err);
    } else {
      showError(err.message);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// 分析ボタン押下時のエラー表示（診断詳細つき）
function showCposAnalyzeError(err) {
  const detail = err._cposPayload || {};
  const errSec = $('#error-section');
  const errText = $('#error-text');
  errText.innerHTML = '';

  // 主メッセージ
  const main = document.createElement('div');
  main.style.whiteSpace = 'pre-line';
  main.textContent = err.message;
  errText.appendChild(main);

  // 診断詳細
  const diag = detail.diagnostics;
  if (diag) {
    const det = document.createElement('details');
    det.className = 'cpos-error-detail';
    det.style.marginTop = '12px';
    const sm = document.createElement('summary');
    sm.textContent = 'CPOS の応答（管理者へ伝える診断情報）';
    det.appendChild(sm);
    const lines = [];
    if (diag.request_url) lines.push(`リクエスト先: ${diag.request_url}`);
    if (detail.upstream_status_code != null) {
      lines.push(`CPOS ステータス: HTTP ${detail.upstream_status_code}（本アプリは ${detail.status} で応答）`);
    } else if (detail.status != null) {
      lines.push(`ステータス: HTTP ${detail.status}`);
    }
    if (diag.response_headers) {
      lines.push('応答ヘッダ:');
      for (const [k, v] of Object.entries(diag.response_headers)) {
        lines.push(`  ${k}: ${v}`);
      }
    }
    if (diag.response_body != null) {
      lines.push('応答ボディ:');
      lines.push(
        typeof diag.response_body === 'string' ? diag.response_body : JSON.stringify(diag.response_body, null, 2),
      );
    }
    const pre = document.createElement('pre');
    pre.textContent = lines.join('\n');
    det.appendChild(pre);
    errText.appendChild(det);
  }

  errSec.classList.remove('hidden');
  errSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =====================================================================
// 認証パネル（Firebase Auth + プラン + アクセスコード）
// =====================================================================
async function initAuthPanel() {
  const panel = $('#auth-panel');
  const openBtn = $('#auth-open-btn');
  if (!panel || !openBtn) return;
  panel.classList.remove('hidden');
  openBtn.addEventListener('click', () => {
    panel.open = true;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let fb;
  try {
    fb = await loadFirebaseSdk();
  } catch (err) {
    $('#auth-signin-hint').textContent = `Firebase 読み込み失敗: ${err.message}`;
    return;
  }

  // ログインボタン
  $('#auth-google-btn')?.addEventListener('click', async () => {
    setAuthHint('Google サインインを実行中…');
    try {
      await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
    } catch (err) {
      setAuthHint(`サインイン失敗: ${err.message}`);
    }
  });
  $('#auth-email-signin-btn')?.addEventListener('click', async () => {
    const email = $('#auth_email').value.trim();
    const pw = $('#auth_password').value;
    if (!email || !pw) return setAuthHint('メールとパスワードを入力してください');
    setAuthHint('ログイン中…');
    try {
      await fb.signInWithEmailAndPassword(fb.auth, email, pw);
    } catch (err) {
      setAuthHint(`ログイン失敗: ${err.message}`);
    }
  });
  $('#auth-email-signup-btn')?.addEventListener('click', async () => {
    const email = $('#auth_email').value.trim();
    const pw = $('#auth_password').value;
    if (!email || !pw) return setAuthHint('メールとパスワード（6 文字以上）を入力してください');
    setAuthHint('新規登録中…');
    try {
      await fb.createUserWithEmailAndPassword(fb.auth, email, pw);
    } catch (err) {
      setAuthHint(`登録失敗: ${err.message}`);
    }
  });
  $('#auth-signout-btn')?.addEventListener('click', async () => {
    await fb.signOut(fb.auth);
  });
  $('#auth-redeem-btn')?.addEventListener('click', redeemAccessCode);
  $('#admin-code-issue-btn')?.addEventListener('click', issueAccessCodeAdmin);

  // 状態監視
  fb.onAuthStateChanged(fb.auth, async (user) => {
    if (!user) {
      appConfig.current_user = null;
      renderAuthState(null);
      return;
    }
    // ログイン直後: /api/me で plan_tier を取得して状態反映
    try {
      const idToken = await user.getIdToken();
      appConfig.current_id_token = idToken;
      const { res, payload } = await jsonFetch('/api/me');
      if (res.ok && payload?.authenticated) {
        appConfig.current_user = payload;
        renderAuthState(payload);
        if (payload.planTier === 'paid') refreshHistory();
        if (payload.isAdmin) refreshAdminCodes();
      } else {
        renderAuthState({ uid: user.uid, email: user.email, planTier: 'free', isAdmin: false });
      }
    } catch (err) {
      setAuthHint(`プロフィール読み込み失敗: ${err.message}`);
    }
  });
}

function setAuthHint(text) {
  const el = $('#auth-signin-hint');
  if (el) el.textContent = text || '';
}

function setRedeemHint(text) {
  const el = $('#auth-redeem-hint');
  if (el) el.textContent = text || '';
}

function setAdminCodeHint(text) {
  const el = $('#admin-code-hint');
  if (el) el.textContent = text || '';
}

function renderAuthState(user) {
  const signin = $('#auth-signin-panel');
  const profile = $('#auth-profile-panel');
  const pill = $('#auth-pill');
  const status = $('#auth-status');
  const openBtn = $('#auth-open-btn');
  if (!user) {
    signin?.classList.remove('hidden');
    profile?.classList.add('hidden');
    if (status) status.textContent = '未ログイン';
    if (openBtn) openBtn.textContent = 'ログイン';
    pill?.classList.remove('signed-in', 'paid');
    return;
  }
  signin?.classList.add('hidden');
  profile?.classList.remove('hidden');
  $('#auth-display-name').textContent = user.displayName || user.email || user.uid;
  $('#auth-email-display').textContent = user.email || '-';
  const badge = $('#auth-plan-badge');
  if (user.planTier === 'paid') {
    badge.textContent = '有料プラン';
    badge.classList.add('paid');
    pill?.classList.add('paid');
  } else {
    badge.textContent = '無料';
    badge.classList.remove('paid');
    pill?.classList.remove('paid');
  }
  $('#auth-plan-expires').textContent = user.planExpiresAt
    ? new Date(user.planExpiresAt).toLocaleString('ja-JP')
    : '-';
  if (status) status.textContent = user.email || 'ログイン中';
  if (openBtn) openBtn.textContent = user.planTier === 'paid' ? 'プラン管理' : 'アクセスコード';
  pill?.classList.add('signed-in');
  $('#auth-history-section')?.classList.toggle('hidden', user.planTier !== 'paid');
  $('#auth-admin-section')?.classList.toggle('hidden', !user.isAdmin);
}

async function redeemAccessCode() {
  const codeInput = $('#auth-code-input');
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return setRedeemHint('コードを入力してください');
  setRedeemHint('適用中…');
  const { res, payload } = await jsonFetch('/api/access-codes/redeem', {
    method: 'POST',
    body: { code },
  });
  if (res.ok && payload?.ok) {
    setRedeemHint(`✅ 適用しました。有効期限: ${new Date(payload.planExpiresAt).toLocaleString('ja-JP')}`);
    codeInput.value = '';
    // /api/me を読み直して状態更新
    const me = await jsonFetch('/api/me');
    if (me.payload?.authenticated) {
      appConfig.current_user = me.payload;
      renderAuthState(me.payload);
      refreshHistory();
    }
  } else {
    setRedeemHint(`❌ ${payload?.message || payload?.error || `エラー HTTP ${res.status}`}`);
  }
}

async function refreshHistory() {
  const list = $('#auth-history-list');
  if (!list) return;
  list.textContent = '読み込み中…';
  const { res, payload } = await jsonFetch('/api/analyses?limit=50');
  if (!res.ok || !payload?.ok) {
    list.textContent = `履歴取得失敗: ${payload?.error || res.status}`;
    return;
  }
  if (!payload.jobs?.length) {
    list.textContent = '（まだ履歴はありません。判定を実行すると保存されます）';
    return;
  }
  list.innerHTML = '';
  for (const job of payload.jobs) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const date = job.created_at ? new Date(job.created_at).toLocaleString('ja-JP') : '-';
    const counts = job.summary_counts || {};
    row.innerHTML = `
      <div class="history-meta">
        <span class="history-date">${date}</span>
        <span class="history-service">${escapeHtml(job.service || '-')}</span>
        <span class="history-source">${escapeHtml(job.source_type || '-')}</span>
        <span class="history-review">${escapeHtml(job.review_status || 'draft')}</span>
      </div>
      <div class="history-summary">
        clear=${counts.clear ?? 0} / waiting=${counts.waiting ?? 0} / not_clear=${counts.not_clear ?? 0} /
        unknown=${counts.unknown ?? 0}
      </div>
      <div class="history-actions">
        <button type="button" data-analysis-id="${job.analysis_id}" class="ghost-btn history-view-btn">詳細</button>
        <button type="button" data-analysis-id="${job.analysis_id}" data-decision="approved" class="ghost-btn history-review-btn">承認</button>
        <button type="button" data-analysis-id="${job.analysis_id}" data-decision="returned" class="ghost-btn history-review-btn">差戻し</button>
      </div>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('.history-view-btn').forEach((b) =>
    b.addEventListener('click', () => openAnalysisDetail(b.dataset.analysisId)),
  );
  list.querySelectorAll('.history-review-btn').forEach((b) =>
    b.addEventListener('click', () => submitReview(b.dataset.analysisId, b.dataset.decision)),
  );
}

async function openAnalysisDetail(id) {
  const { res, payload } = await jsonFetch(`/api/analyses/${encodeURIComponent(id)}`);
  if (!res.ok || !payload?.ok) {
    alert(`取得失敗: ${payload?.error || res.status}`);
    return;
  }
  if (payload.report) {
    const w = window.open('', '_blank', 'noopener');
    if (w) {
      w.document.write(`<pre style="white-space:pre-wrap;font:14px/1.6 monospace;padding:20px">${escapeHtml(payload.report)}</pre>`);
      w.document.title = `解析 ${id}`;
    }
  } else {
    alert(`レポートが保存されていません（id=${id}）`);
  }
}

async function submitReview(id, decision) {
  const comment = prompt(`${decision === 'approved' ? '承認' : '差戻し'} のコメント（任意）`);
  const { res, payload } = await jsonFetch(`/api/analyses/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: { decision, comment: comment || null },
  });
  if (res.ok && payload?.ok) {
    refreshHistory();
  } else {
    alert(`登録失敗: ${payload?.error || res.status}`);
  }
}

async function issueAccessCodeAdmin() {
  const days = Number($('#admin-code-duration').value) || 30;
  const note = $('#admin-code-note').value.trim() || null;
  setAdminCodeHint('発行中…');
  const { res, payload } = await jsonFetch('/api/admin/access-codes', {
    method: 'POST',
    body: { durationDays: days, note },
  });
  if (res.ok && payload?.ok) {
    setAdminCodeHint(`✅ 発行: ${payload.code.code}（${payload.code.durationDays} 日）`);
    $('#admin-code-note').value = '';
    refreshAdminCodes();
  } else {
    setAdminCodeHint(`❌ ${payload?.error || res.status}`);
  }
}

async function refreshAdminCodes() {
  const list = $('#admin-code-list');
  if (!list) return;
  const { res, payload } = await jsonFetch('/api/admin/access-codes?limit=200');
  if (!res.ok || !payload?.ok) {
    list.textContent = `一覧取得失敗: ${payload?.error || res.status}`;
    return;
  }
  if (!payload.codes?.length) {
    list.textContent = '（発行済みコードはまだありません）';
    return;
  }
  list.innerHTML = '';
  for (const c of payload.codes) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <div class="history-meta">
        <code>${escapeHtml(c.code)}</code>
        <span>${c.durationDays}日</span>
        <span class="history-review">${escapeHtml(c.status)}</span>
        <span>${c.issuedAt ? new Date(c.issuedAt).toLocaleDateString('ja-JP') : '-'}</span>
      </div>
      <div class="history-summary">
        ${c.note ? escapeHtml(c.note) : ''}
        ${c.redeemedByEmail ? `<br>redeemed by ${escapeHtml(c.redeemedByEmail)}` : ''}
      </div>
      <div class="history-actions">
        ${c.status === 'issued' ? `<button type="button" data-code="${escapeHtml(c.code)}" class="ghost-btn revoke-btn">失効</button>` : ''}
      </div>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('.revoke-btn').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`コード ${b.dataset.code} を失効しますか？`)) return;
      const r = await jsonFetch(`/api/admin/access-codes/${encodeURIComponent(b.dataset.code)}`, {
        method: 'DELETE',
      });
      if (r.res.ok) refreshAdminCodes();
      else alert(`失効失敗: ${r.payload?.error || r.res.status}`);
    }),
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}
